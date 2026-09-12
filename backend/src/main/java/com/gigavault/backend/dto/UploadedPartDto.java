package com.gigavault.backend.dto;

public record UploadedPartDto(
        int partNumber,
        String etag,
        long size
) {
}
