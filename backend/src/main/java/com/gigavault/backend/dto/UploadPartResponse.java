package com.gigavault.backend.dto;

public record UploadPartResponse(
        int partNumber,
        String etag
) {
}
