# S2 Org-Scan — Security & Data-Handling Review Package

**Status: FIRST-PARTY ENGINEERING REVIEW COMPLETE. Independent sign-off still
required before pilot users (see §6).** This package is the dedicated review
the S-spec demands — not inherited trust from the GitHub Labs monitor.

## 1. App manifest (least privilege, verifiable)

| Field | Value |
|---|---|
| Required permission | `contents: read-only` — nothing else |
| Write scopes | NONE (no code, issues, PRs, actions, metadata write) |
| Webhooks subscribed | NONE in v1 (poll/pull model only) |
| Install scope | Single organization, explicit org-admin consent |

Anyone reviewing the App manifest must be able to verify the above in under
a minute. If the manifest ever requests more, this review is void and must
be redone.

## 2. Data-handling policy (shown pre-install, served in-band)

In-band copy (`ORG_SCAN_DATA_POLICY`, returned on every POST):
> Scans read file contents via contents:read only. Stored: repo, path, line
> number, matched model id, and the single matched line. Full file contents
> are never retained. Results deletable at any time; uninstall revokes access.

Mechanics enforcing it:
- `scanFilesForModels` (`src/lib/org-scan.ts`) returns match locations +
  the single matched line only — no `content` key exists on the type
  (pinned by `tests/s2-s8-orgscan-codegen.test.ts`).
- The route persists nothing: no table, no insert call on the path
  (grep-verified). `DELETE /api/v1/org-scan` logs an audited purge
  acknowledgment and confirms zero server-side retention.
- Responses are `Cache-Control: no-store`; the audit log records org, repo
  count, match count, actor id — never file contents.

## 3. Threat model (abuse cases considered)

| Abuse | Disposition |
|---|---|
| Compromised session token triggers scans | Session rate limit 10/min + 4MB pre-parse cap bound blast radius; every run audit-logged to the actor |
| Malicious repo content (1MB single line, binary) | zod caps (200KB/file, 500 files); matched lines truncated to 500 chars; no code execution on content (regex only) |
| Exfiltration via matched lines | Single-line context by design; bulk export would require 500-file scans at 10/min — visible in audit log |
| Stale access after offboarding | Uninstall revokes at GitHub; procedure §5 must be executed AND verified per offboarding |

## 4. Audit logging (every run)

`org-scan.completed` and `org-scan.purged` events carry org, repos count,
match count, actor id, timestamp. Retention: log pipeline default; no PII
beyond actor id and org name.

## 5. Uninstall / revocation procedure (verify, don't assume)

1. Org admin removes the App via GitHub org settings → Apps.
2. Operator confirms token invalidation: previously issued installation
   tokens must 401 on next use (check GitHub audit log for the removal
   event + one negative probe call).
3. Operator issues `DELETE /api/v1/org-scan` purge acknowledgment for the
   org and files the GitHub removal event id alongside it.
4. Record all three artifacts below. **A removal without the negative-probe
   proof is not a verified revocation.**

## 6. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Engineering (first-party review) | AI Model Radar team | 2026-09-11 | APPROVED for pilot scoping — code controls verified, this package written |
| Independent reviewer | *pending* | — | Required before pilot users |
| Org-admin pilot sponsor | *pending* | — | Required before install on a real org |

## 7. Pilot scoping (post-sign-off)

Pilot gated by `ORG_SCAN_PILOT_ALLOWLIST` (P3 item): named orgs only, install→
completed-scan conversion + repeat-scan rate tracked as the value signal.
