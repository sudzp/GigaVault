package models

import "time"

type UploadSession struct {
	ID         string    `json:"id"`
	S3UploadID string    `json:"s3UploadId"`
	Bucket     string    `json:"bucket"`
	ObjectKey  string    `json:"objectKey"`
	Filename   string    `json:"filename"`
	TotalSize  int64     `json:"totalSize"`
	ChunkSize  int64     `json:"chunkSize"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type UploadPart struct {
	SessionID   string    `json:"sessionId"`
	PartNumber  int32     `json:"partNumber"`
	ETag        string    `json:"etag"`
	Size        int64     `json:"size"`
	ChecksumMD5 string    `json:"checksumMd5"`
	UploadedAt  time.Time `json:"uploadedAt"`
}
