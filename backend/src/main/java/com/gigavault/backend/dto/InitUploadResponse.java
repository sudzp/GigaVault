package com.gigavault.backend.dto;

public record InitUploadResponse(
        String sessionId,
        String s3UploadId,
        String bucket,
        String objectKey,
        long chunkSize
) {
}
