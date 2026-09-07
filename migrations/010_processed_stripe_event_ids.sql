-- Migration 010: processed Stripe webhook event ids (delivery idempotency).
--
-- The billing webhook previously re-applied every delivered event, so Stripe
-- retries (or replays) re-ran tier upgrades. One row per event.id with a
-- primary key makes re-delivery a no-op instead of a re-write.
-- Idempotent: safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS processed_stripe_event_ids (
    event_id              TEXT PRIMARY KEY,
    event_type            VARCHAR(80),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
