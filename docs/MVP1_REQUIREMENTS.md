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

1. Add automated frontend tests for the upload manager, session restoration,
   retry behavior, and state continuity across screen changes.
2. Add backend tests for checksum mismatch, stale S3 sessions, part
   reconciliation, and completion validation.
3. Add authentication, authorization, rate limiting, upload quotas, abandoned
   multipart-session cleanup, structured logs, and operational metrics.
4. Add client-side encryption and key lifecycle management before describing
   GigaVault as a zero-knowledge document-management system.
