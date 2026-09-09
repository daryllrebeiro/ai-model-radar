-- 017: webhook dead-letter queue.
-- Terminal webhook failures (after inline retries) are parked here when
-- the caller opts in, instead of being lost to the audit log. A worker
-- (processDlqBatch) claims due rows, redelivers, and backs off
-- exponentially; rows past max_attempts go 'dead' for manual redrive.
-- Timestamps are the claim protocol: a row is claimable only when
-- status IN ('queued','retrying') AND next_retry_at <= NOW().
CREATE TABLE IF NOT EXISTS webhook_dlq (
  id              BIGSERIAL PRIMARY KEY,
  delivery_id     TEXT NOT NULL UNIQUE,
  rule_id         TEXT,
  destination_url TEXT NOT NULL,
  payload         TEXT NOT NULL,
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          VARCHAR(20) NOT NULL DEFAULT 'queued',  -- 'queued' | 'retrying' | 'dead' | 'delivered'
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_due
  ON webhook_dlq (status, next_retry_at) WHERE status IN ('queued', 'retrying');
