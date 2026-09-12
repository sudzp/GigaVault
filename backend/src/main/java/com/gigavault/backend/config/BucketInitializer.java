package com.gigavault.backend.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Slf4j
@Component
@RequiredArgsConstructor
public class BucketInitializer implements CommandLineRunner {

    private final S3Client s3Client;

    @Value("${gigavault.s3.bucket}")
    private String bucket;

    @Override
    public void run(String... args) {
        try {
            s3Client.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
            log.info("Bucket '{}' already exists", bucket);
        } catch (S3Exception e) {
            log.info("Bucket '{}' not found, creating it", bucket);
            s3Client.createBucket(CreateBucketRequest.builder().bucket(bucket).build());
        }
    }
}
