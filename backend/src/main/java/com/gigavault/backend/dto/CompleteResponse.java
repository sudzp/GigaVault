package com.gigavault.backend.dto;

public record CompleteResponse(
        String status,
        String bucket,
        String objectKey
) {
}
