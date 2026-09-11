# OAuth Billing Connections — Token-Storage Audit Package (P3 design gate)

**Status: DESIGN AUDIT ONLY. No implementation.** The R5 spec defers OAuth
until this audit exists (storage / scope / revocation). This document IS
that audit's design input; code starts only after its checklist (§5) is
signed. CSV import remains the supported path.

## 1. Proposed scope (least privilege)

| Item | Value |
|---|---|
| Providers | Stripe read-only (`read_only` restricted key) + Resend/SES read-only where offered |
| Forbidden | Secret keys with write scope, full-access keys, OAuth offline scopes that can't be revoked per-connection |
| Storage | AES-256-GCM envelope via `src/lib/secret-store.ts` (same as export-connector secrets), per-connection row, `enc:v2:` keyring-compatible |
| Scope display | Exact granted scope shown at connect time + in settings; mismatch refuses |

## 2. Storage design (mirrors export-connector secrets, already reviewed)

- New `billing_connections` table (owner_user_id FK, provider, encrypted
  `secret`, scope_granted, created_at, revoked_at). Reuses `secret-store.ts`
  encrypt/decrypt + fail-closed creation without key + legacy-plaintext
  refusal — no new crypto, no new patterns.
- Reads decrypt at sync time only; decrypted tokens never logged (logger
  already redacts secret-shaped keys) and never returned by any GET.

## 3. Threat model

| Abuse | Mitigation (required in implementation) |
|---|---|
| Stolen DB row / backup | AES-GCM at rest; backups already covered by the connector-ciphertext precedent (ciphertext only) |
| Over-scoped grant | Scope allowlist check at connect; reconnect required to widen |
| Stale access after user offboarding | Per-connection revoke endpoint + cascade on user delete (same as API-key revocation) + provider-side key rotation docs |
| Sync-job token spray (unbounded pulls) | Per-connection daily sync cap + existing source-breaker pattern (3-strikes/5min) on sync failures |
| Confused-deputy sync into shared aggregates | R5 boundary preserved: OAuth data is per-user private, never lands in public savings without the R7 double opt-in |

## 4. Revocation UX (required)

Settings → Billing connections → Revoke per connection (immediate:
row deleted + provider-side rotation instructions shown). User delete
cascades. Every revoke writes an audit log row (who, when, which provider).

## 5. Sign-off checklist (all required before code)

- [ ] Independent reviewer approves storage reuse + scope allowlist
- [ ] Rotation drill executed on one `EXPORT_CONNECTOR_KEY`-style key
- [ ] Revocation UX reviewed (screenshots, not prose)
- [ ] Sync caps + breaker thresholds documented
- [ ] R5→R7 boundary test extended to the OAuth path (no public leakage)
