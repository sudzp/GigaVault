package com.gigavault.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "upload_sessions")
@Getter
@Setter
@NoArgsConstructor
public class UploadSession {

    @Id
    private String id;

    @Column(name = "s3_upload_id", nullable = false)
    private String s3UploadId;

    @Column(nullable = false)
    private String bucket;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(nullable = false)
    private String filename;

    @Column(name = "total_size", nullable = false)
    private long totalSize;

    @Column(name = "chunk_size", nullable = false)
    private long chunkSize;

    @Column(nullable = false)
    private String status = "in_progress";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
