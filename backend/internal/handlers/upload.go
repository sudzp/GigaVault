package handlers

import (
	"bytes"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB     *pgxpool.Pool
	S3     *s3.Client
	Bucket string
}

func randomID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type sessionRow struct {
	S3UploadID string
	Bucket     string
	ObjectKey  string
	ChunkSize  int64
	TotalSize  int64
	Status     string
}

func (h *Handler) loadSession(c *gin.Context, sessionID string) (sessionRow, error) {
	var s sessionRow
	row := h.DB.QueryRow(c.Request.Context(),
		`SELECT s3_upload_id, bucket, object_key, chunk_size, total_size, status
		 FROM upload_sessions WHERE id=$1`, sessionID)
	err := row.Scan(&s.S3UploadID, &s.Bucket, &s.ObjectKey, &s.ChunkSize, &s.TotalSize, &s.Status)
	return s, err
}

// ---- Story 1.2 / AC1: initialize a multipart upload session ----

type initRequest struct {
	Filename  string `json:"filename" binding:"required"`
	TotalSize int64  `json:"totalSize" binding:"required"`
	ChunkSize int64  `json:"chunkSize" binding:"required"`
}

func (h *Handler) InitUpload(c *gin.Context) {
	var req initRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	sessionID := randomID()
	objectKey := fmt.Sprintf("%s/%s", sessionID, req.Filename)

	out, err := h.S3.CreateMultipartUpload(c.Request.Context(), &s3.CreateMultipartUploadInput{
		Bucket: aws.String(h.Bucket),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to start S3 multipart upload: " + err.Error()})
		return
	}

	_, err = h.DB.Exec(c.Request.Context(),
		`INSERT INTO upload_sessions (id, s3_upload_id, bucket, object_key, filename, total_size, chunk_size)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		sessionID, *out.UploadId, h.Bucket, objectKey, req.Filename, req.TotalSize, req.ChunkSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist session: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"sessionId":  sessionID,
		"s3UploadId": *out.UploadId,
		"bucket":     h.Bucket,
		"objectKey":  objectKey,
		"chunkSize":  req.ChunkSize,
	})
}

// ---- Story 1.2 / AC2-3: upload (or retry) a single chunk ----

func (h *Handler) UploadPart(c *gin.Context) {
	sessionID := c.Param("sessionId")
	partNumber, err := strconv.Atoi(c.Param("partNumber"))
	if err != nil || partNumber < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid part number"})
		return
	}

	sess, err := h.loadSession(c, sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk body"})
		return
	}

	// Verify client-computed checksum against what actually arrived, so a
	// corrupted-in-transit chunk is caught here rather than baked into S3.
	sum := md5.Sum(body)
	serverMD5 := hex.EncodeToString(sum[:])
	if clientMD5 := c.GetHeader("X-Checksum-MD5"); clientMD5 != "" && clientMD5 != serverMD5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "checksum mismatch, re-upload this chunk"})
		return
	}

	out, err := h.S3.UploadPart(c.Request.Context(), &s3.UploadPartInput{
		Bucket:     aws.String(sess.Bucket),
		Key:        aws.String(sess.ObjectKey),
		UploadId:   aws.String(sess.S3UploadID),
		PartNumber: aws.Int32(int32(partNumber)),
		Body:       bytes.NewReader(body),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "S3 UploadPart failed: " + err.Error()})
		return
	}

	etag := strings.Trim(aws.ToString(out.ETag), `"`)

	_, err = h.DB.Exec(c.Request.Context(),
		`INSERT INTO upload_parts (session_id, part_number, etag, size, checksum_md5)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (session_id, part_number)
		 DO UPDATE SET etag=EXCLUDED.etag, size=EXCLUDED.size, checksum_md5=EXCLUDED.checksum_md5`,
		sessionID, partNumber, etag, len(body), serverMD5)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record part: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"partNumber": partNumber, "etag": etag})
}

// ---- Story 1.2 / AC4: resume - ask S3 what's already landed ----

func (h *Handler) ResumeUpload(c *gin.Context) {
	sessionID := c.Param("sessionId")
	sess, err := h.loadSession(c, sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		return
	}

	listOut, err := h.S3.ListParts(c.Request.Context(), &s3.ListPartsInput{
		Bucket:   aws.String(sess.Bucket),
		Key:      aws.String(sess.ObjectKey),
		UploadId: aws.String(sess.S3UploadID),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "S3 ListParts failed: " + err.Error()})
		return
	}

	uploadedParts := make([]gin.H, 0, len(listOut.Parts))
	for _, p := range listOut.Parts {
		etag := strings.Trim(aws.ToString(p.ETag), `"`)
		uploadedParts = append(uploadedParts, gin.H{
			"partNumber": aws.ToInt32(p.PartNumber),
			"etag":       etag,
			"size":       aws.ToInt64(p.Size),
		})
		// Keep our DB in sync with the authoritative S3 state.
		_, _ = h.DB.Exec(c.Request.Context(),
			`INSERT INTO upload_parts (session_id, part_number, etag, size)
			 VALUES ($1,$2,$3,$4)
			 ON CONFLICT (session_id, part_number)
			 DO UPDATE SET etag=EXCLUDED.etag, size=EXCLUDED.size`,
			sessionID, aws.ToInt32(p.PartNumber), etag, aws.ToInt64(p.Size))
	}

	c.JSON(http.StatusOK, gin.H{
		"sessionId":     sessionID,
		"chunkSize":     sess.ChunkSize,
		"totalSize":     sess.TotalSize,
		"objectKey":     sess.ObjectKey,
		"status":        sess.Status,
		"uploadedParts": uploadedParts,
	})
}

// ---- finalize the multipart upload once every chunk has landed ----

func (h *Handler) CompleteUpload(c *gin.Context) {
	sessionID := c.Param("sessionId")
	sess, err := h.loadSession(c, sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		return
	}

	rows, err := h.DB.Query(c.Request.Context(),
		`SELECT part_number, etag FROM upload_parts WHERE session_id=$1 ORDER BY part_number ASC`, sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load parts: " + err.Error()})
		return
	}
	defer rows.Close()

	var completedParts []types.CompletedPart
	for rows.Next() {
		var pn int32
		var etag string
		if err := rows.Scan(&pn, &etag); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		completedParts = append(completedParts, types.CompletedPart{
			PartNumber: aws.Int32(pn),
			ETag:       aws.String(etag),
		})
	}

	if len(completedParts) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no parts uploaded yet"})
		return
	}

	_, err = h.S3.CompleteMultipartUpload(c.Request.Context(), &s3.CompleteMultipartUploadInput{
		Bucket:          aws.String(sess.Bucket),
		Key:             aws.String(sess.ObjectKey),
		UploadId:        aws.String(sess.S3UploadID),
		MultipartUpload: &types.CompletedMultipartUpload{Parts: completedParts},
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "S3 CompleteMultipartUpload failed: " + err.Error()})
		return
	}

	_, _ = h.DB.Exec(c.Request.Context(), `UPDATE upload_sessions SET status='completed' WHERE id=$1`, sessionID)

	c.JSON(http.StatusOK, gin.H{"status": "completed", "bucket": sess.Bucket, "objectKey": sess.ObjectKey})
}

// ---- optional cleanup ----

func (h *Handler) AbortUpload(c *gin.Context) {
	sessionID := c.Param("sessionId")
	sess, err := h.loadSession(c, sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
		return
	}

	_, err = h.S3.AbortMultipartUpload(c.Request.Context(), &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(sess.Bucket),
		Key:      aws.String(sess.ObjectKey),
		UploadId: aws.String(sess.S3UploadID),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "S3 AbortMultipartUpload failed: " + err.Error()})
		return
	}

	_, _ = h.DB.Exec(c.Request.Context(), `UPDATE upload_sessions SET status='aborted' WHERE id=$1`, sessionID)
	c.JSON(http.StatusOK, gin.H{"status": "aborted"})
}
