package com.gigavault.backend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

import java.net.URI;

@Configuration
public class S3Config {

    @Value("${gigavault.s3.endpoint}")
    private String endpoint;

    @Value("${gigavault.s3.access-key}")
    private String accessKey;

    @Value("${gigavault.s3.secret-key}")
    private String secretKey;

    @Value("${gigavault.s3.region}")
    private String region;

    @Bean
    public S3Client s3Client() {
        return S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(accessKey, secretKey)))
                // LocalStack (and MinIO-alikes generally) need path-style
                // addressing rather than virtual-hosted-style buckets.
                .forcePathStyle(true)
                .build();
    }
}
