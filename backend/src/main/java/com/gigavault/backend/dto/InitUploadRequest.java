package com.gigavault.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record InitUploadRequest(
        @NotBlank String filename,
        @Positive long totalSize,
        @Positive long chunkSize
) {
}
