package com.gigavault.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;

@Entity
@Table(name = "upload_parts")
@IdClass(UploadPart.UploadPartId.class)
@Getter
@Setter
@NoArgsConstructor
public class UploadPart {

    @Id
    @Column(name = "session_id")
    private String sessionId;

    @Id
    @Column(name = "part_number")
    private int partNumber;

    @Column(nullable = false)
    private String etag;

    @Column(nullable = false)
    private long size;

    @Column(name = "checksum_md5")
    private String checksumMd5;

    @Column(name = "uploaded_at", nullable = false)
    private Instant uploadedAt = Instant.now();

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UploadPartId implements Serializable {
        private String sessionId;
        private int partNumber;
    }
}
