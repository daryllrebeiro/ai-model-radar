-- R8 — Third-party export integrations (Tier E).
-- Small set of specific, well-supported connectors (datadog, grafana,
-- notion, airtable) — NOT a generic integration platform. Secrets are
-- write-only: stored for delivery, never returned by any read path.
CREATE TABLE IF NOT EXISTS export_connectors (
    id                  SERIAL PRIMARY KEY,
    user_id             INT REFERENCES users(id) ON DELETE CASCADE,
    owner_email         VARCHAR(255) NOT NULL,
    name                VARCHAR(120) NOT NULL,
    type                VARCHAR(20) NOT NULL
                        CHECK (type IN ('datadog', 'grafana', 'notion', 'airtable')),
    destination_url     TEXT NOT NULL DEFAULT '',
    secret              TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at         TIMESTAMPTZ,
    last_status         VARCHAR(20),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_connectors_user ON export_connectors(user_id);
CREATE INDEX IF NOT EXISTS idx_export_connectors_active ON export_connectors(active);
