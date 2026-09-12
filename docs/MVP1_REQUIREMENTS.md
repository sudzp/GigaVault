# GigaVault — MVP 1 Requirements

## Purpose

GigaVault is a resilient, browser-based large-file ingestion service. It uploads
files to S3-compatible object storage as verified, resumable multipart uploads.

The MVP supports reliable large-file ingestion; it is not yet a zero-knowledge
document-management system. A zero-knowledge claim requires client-side
encryption and key management, which are outside this MVP.

## Goals

- Upload files up to 100 GB without reading the entire file into browser memory.
- Resume interrupted uploads without retransmitting confirmed parts.
- Verify the integrity of every uploaded part.
- Keep the browser interface responsive during upload.
- Support S3-compatible object storage.

## Out of Scope

- Client-side encryption, encryption-key management, and zero-knowledge storage.
- Authentication, authorization, sharing, search, and document previews.
- Guaranteed upload continuation after a browser tab closes, a device sleeps, or
  the operating system suspends the browser. The upload must instead be
  recoverable when the user returns.

## Epic 1 — Resilient Large-File Uploads

### Story 1.1 — Client-side chunking and integrity validation

**As a** user uploading a very large file, **I want** the client to read, hash,
and upload one chunk at a time, **so that** uploads do not exhaust device memory
and corrupted data is detected.

#### Acceptance Criteria

1. Files larger than 100 MB are split into chunks sized dynamically between 10
   MB and 50 MB.
2. Chunk sizing keeps the part count at or below 9,500, leaving headroom below
   S3's 10,000-part limit.
3. The client reads only one upload chunk into memory at a time; upload-related
   memory overhead remains below 200 MB under normal browser measurement
   conditions.
4. A Web Worker performs chunk reading, MD5 calculation, and upload work so the
   main interface remains responsive.
5. The worker calculates an MD5 digest before uploading each part and sends it
   with the request.
6. The server independently calculates the MD5 of the received bytes and
   rejects a mismatch with a validation error.
7. Files at or below 100 MB may use the multipart pipeline as a single part.

### Story 1.2 — Resumable multipart upload

**As a** user on an unreliable connection, **I want** uploads to resume from
confirmed parts, **so that** I do not lose completed work or bandwidth.

#### Acceptance Criteria

1. The client initializes an upload through the backend. The backend creates an
   S3 multipart-upload session and returns a GigaVault session ID, object key,
   upload ID, and chunk size.
2. The client persists its file fingerprint, session ID, chunk size, object key,
   completed part numbers, ETags, and timestamp in IndexedDB.
3. Each successful part upload records its ETag on both client and server.
4. Transient network and 5xx failures retry up to five times using exponential
   backoff with jitter.
5. Non-retryable failures, including checksum mismatches and invalid session
   state, are clearly presented to the user.
6. To resume, the client calls a resume endpoint. The backend gets S3's
   authoritative `ListParts` response, reconciles local state, and returns the
   confirmed parts to skip.
7. The backend finalizes a multipart upload only when every expected part is
   present.
8. The user can abort an upload; the backend aborts its S3 session and the
   client removes its local upload record.

### Story 1.3 — Background-aware upload experience

**As a** user who changes views or backgrounds the app, **I want** upload status
to remain visible and recoverable, **so that** I can use the application while
an upload runs.

#### Acceptance Criteria

1. Upload orchestration runs in a dedicated Web Worker.
2. Progress remains synchronized through SPA route changes using shared
   application state and IndexedDB recovery.
3. When the page is backgrounded, the app requests notification permission and,
   when granted, shows a completion or failure notification.
4. If the browser suspends execution, the upload remains resumable when the app
   returns to the foreground.
5. The interface makes clear that closing the browser, device sleep, or OS
   resource suspension can pause an upload, and offers resume when reopened.

## Delivery Roadmap

| Phase | Deliverable | Current State |
| --- | --- | --- |
| 1 | React, Spring Boot, Postgres, and S3-compatible local stack | Complete |
| 2 | Web Worker chunking, MD5 hashing, and dynamic chunk sizing | Complete |
| 3 | Multipart initialization, part upload, verification, and completion | Complete |
| 4 | IndexedDB persistence, retry behavior, and S3-authoritative resume | Complete |
| 5 | Background-aware UX, route-change recovery, notifications, and pause/resume controls | Next |
| 6 | Automated tests, observability, and production security controls | Next |
| 7 | Client-side encryption and key lifecycle management | Future |

## Recommended Next Tasks

1. Introduce an upload manager/store that survives React route changes and
   reconnects to active IndexedDB sessions.
2. Add explicit pause, resume, and abort controls to the upload interface.
3. Detect `online` and `offline` events and show a waiting-for-connection state.
4. Add backend tests for checksum mismatch, stale S3 sessions, part
   reconciliation, and completion validation.
5. Add frontend tests for chunk-size limits, retries, and resume behavior.
6. Add authentication, rate limiting, upload quotas, abandoned-upload cleanup,
   structured logging, and metrics before production use.
