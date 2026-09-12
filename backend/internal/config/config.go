package config

import "os"

type Config struct {
	Port          string
	DatabaseURL   string
	S3Endpoint    string
	S3AccessKey   string
	S3SecretKey   string
	S3Bucket      string
	S3Region      string
	AllowedOrigin string
}

func Load() Config {
	return Config{
		Port:          getEnv("PORT", "8080"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://gigavault:gigavault@postgres:5432/gigavault?sslmode=disable"),
		S3Endpoint:    getEnv("S3_ENDPOINT", "http://localstack:4566"),
		S3AccessKey:   getEnv("S3_ACCESS_KEY", "test"),
		S3SecretKey:   getEnv("S3_SECRET_KEY", "test"),
		S3Bucket:      getEnv("S3_BUCKET", "gigavault"),
		S3Region:      getEnv("S3_REGION", "us-east-1"),
		AllowedOrigin: getEnv("ALLOWED_ORIGIN", "http://localhost:5173"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
