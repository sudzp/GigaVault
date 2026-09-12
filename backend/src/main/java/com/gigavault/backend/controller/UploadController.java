package com.gigavault.backend.controller;

import com.gigavault.backend.dto.CompleteResponse;
import com.gigavault.backend.dto.InitUploadRequest;
import com.gigavault.backend.dto.InitUploadResponse;
import com.gigavault.backend.dto.ResumeResponse;
import com.gigavault.backend.dto.UploadPartResponse;
import com.gigavault.backend.service.UploadService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/uploads")
@RequiredArgsConstructor
public class UploadController {

    private final UploadService uploadService;

    @PostMapping("/init")
    public InitUploadResponse init(@Valid @RequestBody InitUploadRequest req) {
        return uploadService.initUpload(req);
    }

    @PutMapping(value = "/{sessionId}/parts/{partNumber}", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public UploadPartResponse uploadPart(
            @PathVariable String sessionId,
            @PathVariable int partNumber,
            @RequestHeader(value = "X-Checksum-MD5", required = false) String clientMd5,
            @RequestBody byte[] body) {
        return uploadService.uploadPart(sessionId, partNumber, body, clientMd5);
    }

    @GetMapping("/{sessionId}/resume")
    public ResumeResponse resume(@PathVariable String sessionId) {
        return uploadService.resumeUpload(sessionId);
    }

    @PostMapping("/{sessionId}/complete")
    public CompleteResponse complete(@PathVariable String sessionId) {
        return uploadService.completeUpload(sessionId);
    }

    @PostMapping("/{sessionId}/abort")
    public Map<String, String> abort(@PathVariable String sessionId) {
        uploadService.abortUpload(sessionId);
        return Map.of("status", "aborted");
    }
}
