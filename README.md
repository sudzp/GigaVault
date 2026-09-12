# GigaVault

GigaVault is a local-development MVP for reliable, browser-based large-file
uploads. It splits a file into verified chunks, uploads them through an
S3-compatible multipart-upload pipeline, and resumes confirmed work after an
interruption.

> **MVP scope:** GigaVault currently provides resilient file ingestion. It is
> not yet a zero-knowledge document-management product: client-side encryption,
> key management, authentication, and document-management features are not
> implemented.

## Features

- Upload files in dynamically sized 10–50 MB chunks, with a 9,500-part safety
  limit below S3's 10,000-part maximum.
- Read and hash one chunk at a time in a Web Worker to keep the UI responsive.
- Calculate an MD5 digest in the browser and verify it again in the backend.
- Retry transient network and server failures up to five times with exponential
  backoff and jitter.
- Persist upload sessions in IndexedDB and Postgres; use S3 `ListParts` as the
  authoritative resume source.
- Pause, resume, or abort an active upload; pause safely when the browser goes
  offline and resume when it reconnects while the page remains open.
- Retain upload state while navigating between the included Upload and Activity
  SPA screens.
- Discover interrupted sessions after a page refresh. Select the same file
  again to resume it.

## Architecture

```text
React + Vite UI
  └─ Upload manager + Web Worker
       ├─ IndexedDB: browser-side session record
       └─ Spring Boot API
            ├─ Postgres: session and part metadata
            └─ LocalStack S3: multipart-uploaded objects
```

The browser sends chunks to the backend rather than directly to S3. The backend
validates the received MD5, uploads the part to S3-compatible storage, and
records the returned ETag.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Web Workers, IndexedDB |
| Backend | Java 21, Spring Boot 3, Gradle, AWS SDK for Java v2 |
| Metadata | PostgreSQL 16 |
| Object storage | LocalStack S3 |
| Local runtime | Docker Compose |

## Quick Start

### Prerequisites

- Docker Desktop or Docker Engine with Compose v2
- Ports `5173`, `8080`, `4566`, and `5432` available locally

### Configure local environment

Docker Compose reads `.env` from the repository root. Create one locally if it
is not already present:

```dotenv
POSTGRES_USER=gigavault
POSTGRES_PASSWORD=gigavault
POSTGRES_DB=gigavault

S3_ACCESS_KEY=test
S3_SECRET_KEY=test
S3_BUCKET=gigavault

# Obtain this from your LocalStack account when required by the image.
LOCALSTACK_AUTH_TOKEN=replace-with-your-token
```

Do not commit real tokens or production credentials.

### Run the stack

```bash
docker compose up --build
```

Open the frontend at [http://localhost:5173](http://localhost:5173). The
backend creates the configured S3 bucket automatically at startup.

| Service | Address |
| --- | --- |
| Frontend | [http://localhost:5173](http://localhost:5173) |
| Health endpoint | [http://localhost:8080/healthz](http://localhost:8080/healthz) |
| LocalStack S3 endpoint | `http://localhost:4566` |
| PostgreSQL | `localhost:5432` |

Stop the local services with:

```bash
docker compose down
```

This preserves local volumes. Run `docker compose down -v` only when you intend
to remove LocalStack and PostgreSQL data.

## Upload Lifecycle

1. **Initialize:** the client chooses a safe chunk size and calls the init API.
   The backend opens an S3 multipart-upload session and stores its metadata.
2. **Upload:** a Web Worker lazily slices the file, calculates MD5, and uploads
   parts sequentially with retry behavior. The backend re-checksums each part,
   forwards it to S3, and saves its ETag.
3. **Resume:** reselecting the same file restores its browser session. The
   backend compares it with S3 `ListParts`; confirmed parts are skipped.
4. **Complete:** after all parts arrive, the backend calls
   `CompleteMultipartUpload`.

## API Reference

All upload endpoints are under `/api/uploads`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/init` | Create a multipart-upload session |
| `PUT` | `/{sessionId}/parts/{partNumber}` | Upload one binary chunk |
| `GET` | `/{sessionId}/resume` | Return the S3-authoritative uploaded parts |
| `POST` | `/{sessionId}/complete` | Finalize the multipart upload |
| `POST` | `/{sessionId}/abort` | Abort and mark an upload session aborted |

### Initialize an upload

```http
POST /api/uploads/init
Content-Type: application/json

{
  "filename": "archive.zip",
  "totalSize": 1073741824,
  "chunkSize": 10485760
}
```

The response includes `sessionId`, `s3UploadId`, `bucket`, `objectKey`, and
`chunkSize`.

### Upload a part

Send raw bytes with `Content-Type: application/octet-stream` and the lowercase
or uppercase hexadecimal MD5 digest in `X-Checksum-MD5`.

```http
PUT /api/uploads/{sessionId}/parts/1
Content-Type: application/octet-stream
X-Checksum-MD5: <md5-of-request-body>
```

The response contains the part number and S3 ETag.

## Testing

The frontend production build, including TypeScript type-checking, can be run
inside Docker:

```bash
docker compose build frontend
docker compose run --no-deps --rm frontend npm run build
```

For end-to-end manual verification—including first upload, pause/resume, abort,
offline recovery, persisted sessions, SPA navigation, and notifications—follow
[docs/TESTING.md](docs/TESTING.md).

## Development Notes and Limitations

- Vite pre-bundles `spark-md5` so its worker-only import does not refresh the
  first development upload.
- A browser can suspend work when a tab closes, a device sleeps, or the OS
  reclaims resources. In those cases the upload is recoverable, not guaranteed
  to continue in the background.
- A file must be reselected after a full page reload because ordinary browser
  file inputs do not retain a `File` object.
- Hibernate uses `ddl-auto: update` for local development; use Flyway or
  Liquibase before production.
- Chunk uploads are proxied by the backend. Production deployments may use
  pre-signed S3 URLs instead.
- The current fingerprint is file name + size + last-modified timestamp. It is
  a practical resume lookup, not a cryptographic identity.

## Documentation

- [MVP 1 status and next plan](docs/MVP1_REQUIREMENTS.md)
- [Manual test guide](docs/TESTING.md)
- [AGPL-3.0 license](LICENSE)

## Roadmap

The next priorities are automated frontend and backend test coverage, production
security and operational controls, and finally client-side encryption plus key
lifecycle management.
