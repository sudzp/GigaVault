package com.gigavault.backend.dto;

import java.util.List;

public record ResumeResponse(
        String sessionId,
        long chunkSize,
        long totalSize,
        String objectKey,
        String status,
        List<UploadedPartDto> uploadedParts
) {
}
