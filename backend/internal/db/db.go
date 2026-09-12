package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pooled connection to Postgres and verifies it is reachable.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return pool, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS upload_sessions (
	id           TEXT PRIMARY KEY,
	s3_upload_id TEXT NOT NULL,
	bucket       TEXT NOT NULL,
	object_key   TEXT NOT NULL,
	filename     TEXT NOT NULL,
	total_size   BIGINT NOT NULL,
	chunk_size   BIGINT NOT NULL,
	status       TEXT NOT NULL DEFAULT 'in_progress',
	created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_parts (
	session_id   TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
	part_number  INT NOT NULL,
	etag         TEXT NOT NULL,
	size         BIGINT NOT NULL,
	checksum_md5 TEXT,
	uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (session_id, part_number)
);
`

// Migrate applies the (idempotent) schema. Fine for local/dev use; swap for a
// real migration tool (golang-migrate, atlas, etc.) before production.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, schema)
	return err
}
