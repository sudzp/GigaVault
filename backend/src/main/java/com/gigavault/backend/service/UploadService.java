package com.gigavault.backend.service;

import com.gigavault.backend.dto.CompleteResponse;
import com.gigavault.backend.dto.InitUploadRequest;
import com.gigavault.backend.dto.InitUploadResponse;
import com.gigavault.backend.dto.ResumeResponse;
import com.gigavault.backend.dto.UploadPartResponse;
import com.gigavault.backend.dto.UploadedPartDto;
import com.gigavault.backend.exception.UploadException;
import com.gigavault.backend.model.UploadPart;
import com.gigavault.backend.model.UploadSession;
import com.gigavault.backend.repository.UploadPartRepository;
import com.gigavault.backend.repository.UploadSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.AbortMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.CompleteMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.CompletedMultipartUpload;
import software.amazon.awssdk.services.s3.model.CompletedPart;
import software.amazon.awssdk.services.s3.model.CreateMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.CreateMultipartUploadResponse;
import software.amazon.awssdk.services.s3.model.ListPartsRequest;
import software.amazon.awssdk.services.s3.model.ListPartsResponse;
import software.amazon.awssdk.services.s3.model.NoSuchUploadException;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.model.UploadPartRequest;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UploadService {

    private final UploadSessionRepository sessionRepository;
    private final UploadPartRepository partRepository;
    private final S3Client s3Client;

    @Value("${gigavault.s3.bucket}")
    private String bucket;

    private static final SecureRandom RANDOM = new SecureRandom();

    private static String randomId() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    // ---- Story 1.2 AC1: initialize a multipart upload session ----

    @Transactional
    public InitUploadResponse initUpload(InitUploadRequest req) {
        String sessionId = randomId();
        String objectKey = sessionId + "/" + req.filename();

        CreateMultipartUploadResponse out;
        try {
            out = s3Client.createMultipartUpload(CreateMultipartUploadRequest.builder()
                    .bucket(bucket)
                    .key(objectKey)
                    .build());
        } catch (S3Exception e) {
            throw new UploadException(HttpStatus.BAD_GATEWAY, "failed to start S3 multipart upload: " + e.getMessage());
        }

        UploadSession session = new UploadSession();
        session.setId(sessionId);
        session.setS3UploadId(out.uploadId());
        session.setBucket(bucket);
        session.setObjectKey(objectKey);
        session.setFilename(req.filename());
        session.setTotalSize(req.totalSize());
        session.setChunkSize(req.chunkSize());
        sessionRepository.save(session);

        return new InitUploadResponse(sessionId, out.uploadId(), bucket, objectKey, req.chunkSize());
    }

    private static UploadException staleUploadError(String action) {
        return new UploadException(HttpStatus.GONE,
                "This upload session no longer exists in S3 (likely lost on a storage restart, or already "
                        + "completed/aborted). Start a new upload for this file. [" + action + "]");
    }

    private UploadSession loadSession(String sessionId) {
        return sessionRepository.findById(sessionId)
                .orElseThrow(() -> new UploadException(HttpStatus.NOT_FOUND, "upload session not found"));
    }

    // ---- Story 1.2 AC2-3: upload (or retry) a single chunk ----

    @Transactional
    public UploadPartResponse uploadPart(String sessionId, int partNumber, byte[] body, String clientMd5) {
        if (partNumber < 1) {
            throw new UploadException(HttpStatus.BAD_REQUEST, "invalid part number");
        }

        UploadSession session = loadSession(sessionId);

        // Verify the client-computed checksum against what actually arrived,
        // so a chunk corrupted in transit is caught here rather than baked
        // into S3.
        String serverMd5 = md5Hex(body);
        if (clientMd5 != null && !clientMd5.isBlank() && !clientMd5.equalsIgnoreCase(serverMd5)) {
            throw new UploadException(HttpStatus.BAD_REQUEST, "checksum mismatch, re-upload this chunk");
        }

        String etag;
        try {
            software.amazon.awssdk.services.s3.model.UploadPartResponse out = s3Client.uploadPart(
                    UploadPartRequest.builder()
                            .bucket(session.getBucket())
                            .key(session.getObjectKey())
                            .uploadId(session.getS3UploadId())
                            .partNumber(partNumber)
                            .build(),
                    RequestBody.fromBytes(body));
            etag = stripQuotes(out.eTag());
        } catch (NoSuchUploadException e) {
            throw staleUploadError("UploadPart");
        } catch (S3Exception e) {
            throw new UploadException(HttpStatus.BAD_GATEWAY, "S3 UploadPart failed: " + e.getMessage());
        }

        UploadPart part = new UploadPart();
        part.setSessionId(sessionId);
        part.setPartNumber(partNumber);
        part.setEtag(etag);
        part.setSize(body.length);
        part.setChecksumMd5(serverMd5);
        partRepository.save(part);

        return new UploadPartResponse(partNumber, etag);
    }

    // ---- Story 1.2 AC4: resume - ask S3 what's already landed ----

    @Transactional
    public ResumeResponse resumeUpload(String sessionId) {
        UploadSession session = loadSession(sessionId);

        ListPartsResponse listOut;
        try {
            listOut = s3Client.listParts(ListPartsRequest.builder()
                    .bucket(session.getBucket())
                    .key(session.getObjectKey())
                    .uploadId(session.getS3UploadId())
                    .build());
        } catch (NoSuchUploadException e) {
            throw staleUploadError("ListParts");
        } catch (S3Exception e) {
            throw new UploadException(HttpStatus.BAD_GATEWAY, "S3 ListParts failed: " + e.getMessage());
        }

        List<UploadedPartDto> uploadedParts = listOut.parts().stream()
                .map(p -> {
                    String etag = stripQuotes(p.eTag());
                    long size = p.size() == null ? 0L : p.size();

                    // Keep our DB in sync with the authoritative S3 state.
                    UploadPart part = new UploadPart();
                    part.setSessionId(sessionId);
                    part.setPartNumber(p.partNumber());
                    part.setEtag(etag);
                    part.setSize(size);
                    partRepository.save(part);

                    return new UploadedPartDto(p.partNumber(), etag, size);
                })
                .collect(Collectors.toList());

        return new ResumeResponse(
                sessionId,
                session.getChunkSize(),
                session.getTotalSize(),
                session.getObjectKey(),
                session.getStatus(),
                uploadedParts);
    }

    // ---- finalize the multipart upload once every chunk has landed ----

    @Transactional
    public CompleteResponse completeUpload(String sessionId) {
        UploadSession session = loadSession(sessionId);

        List<UploadPart> parts = partRepository.findBySessionIdOrderByPartNumberAsc(sessionId);
        if (parts.isEmpty()) {
            throw new UploadException(HttpStatus.BAD_REQUEST, "no parts uploaded yet");
        }

        List<CompletedPart> completedParts = parts.stream()
                .map(p -> CompletedPart.builder()
                        .partNumber(p.getPartNumber())
                        .eTag(p.getEtag())
                        .build())
                .collect(Collectors.toList());

        try {
            s3Client.completeMultipartUpload(CompleteMultipartUploadRequest.builder()
                    .bucket(session.getBucket())
                    .key(session.getObjectKey())
                    .uploadId(session.getS3UploadId())
                    .multipartUpload(CompletedMultipartUpload.builder().parts(completedParts).build())
                    .build());
        } catch (NoSuchUploadException e) {
            throw staleUploadError("CompleteMultipartUpload");
        } catch (S3Exception e) {
            throw new UploadException(HttpStatus.BAD_GATEWAY, "S3 CompleteMultipartUpload failed: " + e.getMessage());
        }

        session.setStatus("completed");
        sessionRepository.save(session);

        return new CompleteResponse("completed", session.getBucket(), session.getObjectKey());
    }

    // ---- optional cleanup ----

    @Transactional
    public void abortUpload(String sessionId) {
        UploadSession session = loadSession(sessionId);

        try {
            s3Client.abortMultipartUpload(AbortMultipartUploadRequest.builder()
                    .bucket(session.getBucket())
                    .key(session.getObjectKey())
                    .uploadId(session.getS3UploadId())
                    .build());
        } catch (NoSuchUploadException e) {
            throw staleUploadError("AbortMultipartUpload");
        } catch (S3Exception e) {
            throw new UploadException(HttpStatus.BAD_GATEWAY, "S3 AbortMultipartUpload failed: " + e.getMessage());
        }

        session.setStatus("aborted");
        sessionRepository.save(session);
    }

    private static String stripQuotes(String s) {
        return s == null ? null : s.replace("\"", "");
    }

    private static String md5Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("MD5");
            return HexFormat.of().formatHex(digest.digest(data));
        } catch (NoSuchAlgorithmException e) {
            // MD5 is part of every standard JVM's default providers; this
            // can't actually happen, but the checked exception has to go somewhere.
            throw new IllegalStateException("MD5 algorithm not available", e);
        }
    }
}
