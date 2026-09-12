# GigaVault — MVP 1

Local development stack for a resilient, chunked large-file upload pipeline.

**Implemented:** Story 1.1 (client-side chunking and MD5 validation) and Story
1.2 (resumable S3 multipart upload). The current uploader uses a dedicated Web
Worker: it keeps the UI responsive and may continue while the tab is
backgrounded, but browser scheduling cannot be guaranteed. It also cannot
guarantee execution after a full page navigation, browser close, device sleep,
or OS suspension. Interrupted uploads can be resumed by selecting the same file
again.

See [MVP 1 requirements and roadmap](docs/MVP1_REQUIREMENTS.md) for the
product scope, acceptance criteria, and planned work.

## Stack

- **Backend**: Java 21 + Spring Boot 3 (Gradle), talks to S3 via the AWS SDK
  for Java v2, tracks session/part state in Postgres via Spring Data JPA.
- **Frontend**: React + TypeScript + Vite. A Web Worker does chunk slicing,
  MD5 hashing, and the actual `fetch` upload so the main thread never blocks.
- **Storage**: [LocalStack](https://www.localstack.cloud/) (S3-compatible),
  Postgres for upload metadata.

> **Why LocalStack and not MinIO?** MinIO discontinued free Docker image
> distribution in October 2025 and archived its community-edition repo in
> February 2026, redirecting users to its commercial AIStor product — the
> `minio/minio` image no longer exists on Docker Hub or quay.io. LocalStack is
> still actively maintained, so that's what this stack uses for local S3
> emulation.

> **Backend history:** the first pass of this MVP used a Go/Gin backend.
> It's been rewritten in Java/Spring Boot; the HTTP API contract (routes,
> request/response shapes, status codes) is unchanged, so the frontend
> needed no changes.

## Running it

```bash
docker compose up --build
```

First build needs internet access (Gradle/Maven Central + npm registry) —
after that, `docker compose up` is fully local. The backend image is built
in two stages: a `gradle:8.10-jdk21` image compiles the Spring Boot fat jar,
then it's copied into a slim `eclipse-temurin:21-jre-alpine` runtime image.
No Gradle wrapper is checked into the repo — the Docker build supplies
Gradle itself, the same way the earlier Go version let `go mod tidy` resolve
dependencies at build time rather than committing a lockfile.

Once it's up:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8080/healthz
- LocalStack S3 endpoint: http://localhost:4566 (dummy creds: `test` / `test`)
- Postgres: `localhost:5432` (user/pass/db: `gigavault` / `gigavault` / `gigavault`)

The `gigavault` bucket is created automatically by the backend on startup.

LocalStack's community edition doesn't ship a bucket-browsing web UI, so to
poke around the uploaded objects from your host, use the AWS CLI pointed at
the LocalStack endpoint:

```bash
aws --endpoint-url=http://localhost:4566 s3 ls s3://gigavault --recursive \
  --region us-east-1 \
  # or export these once: AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
```

## How the pipeline works

1. **Init** — frontend computes a chunk size (10–50MB, scaled so a file never
   exceeds ~9,500 parts) and calls `POST /api/uploads/init`. The backend opens
   an S3 `CreateMultipartUpload` session and stores it in Postgres.
2. **Chunk & upload** — a Web Worker slices the file with `File.slice()`
   (lazy — nothing is read into memory until needed), computes an MD5 per
   chunk, and `PUT`s each chunk to `/api/uploads/:sessionId/parts/:partNumber`
   with retry + exponential backoff (5 attempts). The backend re-checksums the
   bytes it received, calls S3 `UploadPart`, and records the returned ETag.
3. **Resume** — the browser tracks session state in IndexedDB. If the same
   file (matched by name + size + lastModified) is re-selected, the frontend
   calls `GET /api/uploads/:sessionId/resume`, which asks S3 `ListParts` for
   the authoritative list of parts already landed, and the worker skips those.
4. **Complete** — once every chunk is uploaded, the frontend calls
   `POST /api/uploads/:sessionId/complete`, which pulls the full part list
   from Postgres and calls S3 `CompleteMultipartUpload`.

## Notes / simplifications for this MVP pass

- Files smaller than the minimum chunk size still go through the multipart
  pipeline as a single part — simpler than branching to a separate
  single-PUT path, and functionally equivalent.
- Chunk uploads are proxied through the Java backend (not pre-signed
  direct-to-S3 URLs). This is simpler for local dev; swap to pre-signed URLs
  later if you want the browser talking to LocalStack/S3 directly.
- Schema is created via Hibernate's `ddl-auto: update` rather than a real
  migration tool — fine for local dev, swap for Flyway or Liquibase before
  anything further than that. Also note `upload_parts.session_id` is a plain
  string column, not a JPA-managed foreign key, so referential integrity
  between the two tables isn't enforced at the DB level yet.
- No auth yet — anyone who can reach the API can start/resume/complete an
  upload. Fine for local dev, not for anything further than that.
- Zero-knowledge client-side encryption (implied by the product subtext) isn't
  part of these two stories' acceptance criteria, so it's out of scope here.

## Next up

- Story 1.3: explicit pause/resume/abort controls and connection-aware recovery
  are implemented. Next, add an upload manager that survives SPA route changes
  and background completion notifications. Browser close and OS suspension will
  remain recoverable-resume scenarios rather than guaranteed background
  execution.
- Test coverage: backend tests with a mocked `S3Client` for checksum mismatch,
  stale sessions, resume reconciliation, and completion validation; frontend
  tests for chunk-size boundaries, retry behavior, and resume logic.
- Production hardening: authentication, authorization, rate limits, upload
  quotas, abandoned multipart-upload cleanup, structured logs, and metrics.
- Future: implement client-side encryption and key lifecycle management before
  describing GigaVault as zero-knowledge.
