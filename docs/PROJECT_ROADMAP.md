# GigaVault — MVP 1

## Completed

- Resilient S3-compatible multipart upload for files up to 100 GB.
- Dynamic 10–50 MB chunks, capped at 9,500 parts, read and hashed one at a time
  in a Web Worker.
- Per-chunk MD5 checks calculated by the client and verified by the backend.
- IndexedDB upload records, server-side part records, retry with exponential
  backoff, and S3-authoritative resume through `ListParts`.
- Explicit pause, resume, and abort controls; offline detection pauses safely
  and automatically resumes when the connection returns while the page remains
  open.
- Application-level upload manager that retains worker ownership and upload
  state while the user navigates between SPA screens.
- Startup discovery of unfinished IndexedDB sessions. The user can resume one
  by selecting the same file again; browsers do not retain a file object after
  a reload by default.
- Optional browser completion notifications, requested when the user selects a
  file for upload.
- Vite pre-bundles the worker-only `spark-md5` dependency at startup, preventing
  the development server from refreshing the first upload.

## Next Plan

1. **Complete upload reliability and test coverage.** Add frontend tests for
   the upload manager, session restoration, retries, and SPA state continuity;
   add backend tests for checksum mismatch, stale S3 sessions, paginated
   `ListParts` reconciliation, and completion validation. Add a whole-file
   SHA-256 verification flow for completed downloads.
2. **Establish the security and metadata foundation.** Add authentication,
   authorization, private bucket policies, file ownership, audit logging, rate
   limiting, quotas, abandoned multipart-upload cleanup, metrics, and a file
   metadata model. This enables folders, immutable object UUIDs, rename/move,
   soft delete, and version metadata without copying large objects.
3. **Move transfer data paths to signed object-storage URLs.** Replace backend
   chunk proxying with authorized, short-lived pre-signed multipart part URLs
   and signed download URLs. Use S3 checksum support and renew expired part URLs
   as needed; treat each URL as a temporary bearer credential, not a single-use
   token.
4. **Build retrieval and retention.** Add streaming/range retrieval, a
   download manager that writes incrementally rather than buffering a complete
   file, media delivery through indexed containers or HLS/DASH, lifecycle
   tiering driven by metadata/tags, and archive-restore status.
5. **Add non-zero-knowledge content protection.** Add asynchronous quarantine,
   malware scan status, and safe release for plaintext files. Use GuardDuty
   Malware Protection for S3 or an isolated container-based scanner for large
   objects rather than a Lambda that downloads a whole 100 GB file.
6. **Make the product-architecture decision before encryption work.** Strict
   zero knowledge is incompatible with server-side plaintext scanning and with
   privacy-preserving global block deduplication. Choose and document either:
   (a) client-controlled encryption with no platform plaintext access, or
   (b) platform-managed encryption with scanning and carefully scoped dedupe.
   Do not describe the product as zero knowledge until the first model is
   implemented and independently reviewed.
