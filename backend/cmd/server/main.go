package main

import (
	"context"
	"log"

	"gigavault/internal/config"
	"gigavault/internal/db"
	"gigavault/internal/handlers"
	"gigavault/internal/s3client"
)

func main() {
	ctx := context.Background()
	cfg := config.Load()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to postgres: %v", err)
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	s3c, err := s3client.New(ctx, cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Region)
	if err != nil {
		log.Fatalf("failed to create S3 client: %v", err)
	}

	if err := s3client.EnsureBucket(ctx, s3c, cfg.S3Bucket); err != nil {
		log.Fatalf("failed to ensure bucket %q: %v", cfg.S3Bucket, err)
	}

	h := &handlers.Handler{DB: pool, S3: s3c, Bucket: cfg.S3Bucket}
	router := handlers.NewRouter(h, cfg.AllowedOrigin)

	log.Printf("GigaVault backend listening on :%s (bucket=%s, endpoint=%s)", cfg.Port, cfg.S3Bucket, cfg.S3Endpoint)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
