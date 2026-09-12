# GigaVault Manual Test Guide

Start the stack with:

```bash
docker compose up --build
```

Open `http://localhost:5173`. Use a file larger than 10 MB so progress has time
to change; a 100 MB or larger test file makes pause, resume, and navigation
tests easier to observe.

## Core upload

1. Select a file and confirm the page does not refresh on the first upload.
2. Confirm progress advances to 100% and the status becomes `completed`.
3. Confirm the backend logs contain `CreateMultipartUpload`, one or more
   `UploadPart` requests, and `CompleteMultipartUpload`.

## Pause, resume, and abort

1. Start an upload and select **Pause** while progress is below 100%.
2. Confirm the status becomes `paused`, then select **Resume** and confirm it
   completes without restarting from 0% on the server.
3. Start another upload and select **Abort**. Confirm the UI returns to its
   initial state and the next selection starts a new multipart session.

## Connection recovery and persisted sessions

1. Start an upload, then use the browser DevTools Network panel to switch to
   offline mode.
2. Confirm the status becomes `waiting_for_connection`.
3. Restore network access and confirm the upload resumes automatically.
4. Start another upload, pause it, and refresh the browser. The home screen
   should report an interrupted upload. Select the same file again to resume;
   the file name, size, and last-modified time must match.

## SPA navigation and notifications

1. Start an upload, choose **Activity**, then return to **Upload**. Progress and
   controls must show the same active upload throughout; the upload must not
   restart.
2. Select a file and allow the browser notification permission when prompted.
3. Start an upload, move to another tab before it completes, and confirm a
   GigaVault completion notification is shown if the browser allows it.

## Clean-up

Stop the stack after testing:

```bash
docker compose down
```

This preserves the Compose volumes. Use `docker compose down -v` only when you
intentionally want to discard local Postgres and LocalStack data.
