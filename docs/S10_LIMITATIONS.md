# S10 — Negotiated Enterprise-Pricing Intelligence: Limitations & Strategic Gate

**Status: NOT BUILT. No code, no estimates, no schema, no API, no UI.**
This document records *why* S10 is held and exactly what must happen before
engineering may start. It mirrors the R10/ADR-010 treatment from the prior
round: a separately-gated strategic decision, not a sequenced engineering task.

---

## 1. What S10 would do (if greenlit)

Opt-in submission of negotiated rate / volume-tier data, aggregated and shown
**only** as ranges/percentiles once a minimum-contributor threshold is met per
provider × tier × volume-band combination. Never an individual
company-attributable figure — under any view, including internal/admin views.
Aggregated periodic snapshots only.

## 2. Why it is held — three risk categories new to this product

### 2.1 Confidential business pricing / NDA exposure (legal)
- Enterprise model contracts routinely cover negotiated rates under
  confidentiality clauses. The product **cannot verify** whether a
  contributing user is breaching a confidentiality agreement by submitting.
- Exposure falls on the **contributing user**, not just the product — a
  submission UI that makes sharing feel routine could induce a real breach.
- Consequence: legal input is **not optional**. Business/legal sign-off at
  ADR level (R10/ADR-010 pattern) is a prerequisite, not a parallel track.

### 2.2 Anti-gaming (trust)
- Distinct from every other trust boundary in this project (R9 connectors,
  R7 case studies): the submitter has a direct financial incentive to lie.
- Attack shapes:
  - A provider submitting fabricated *favorable* numbers about itself.
  - A competitor submitting fabricated *unfavorable* numbers about a rival.
  - Coordinated low-volume submissions to drag a percentile.
- Consequence: raw submissions must **never** flow directly into an aggregate.
  Plausibility bounds + a review step (outlier detection at minimum, human
  moderation for anything statistically unusual) are required first — the same
  trust-boundary discipline as R9 connector review, applied to pricing data.

### 2.3 De-anonymization by inference (privacy)
- An "aggregate" over too few contributors **is** the underlying number.
  With 1–2 contributors in a provider/tier/band cell, ranges and percentiles
  still reveal a specific company's rate.
- Consequence: a **specific, documented minimum-contributor threshold**
  (e.g., no aggregate shown with fewer than 5 distinct contributing
  organizations) per provider × tier × volume-band cell, enforced in code and
  in every view including admin. Below threshold: show "collecting data",
  never a number.

## 3. Required before engineering starts (all four, in order)

1. **Explicit business/legal sign-off, ADR-level** — matching the
   R10/ADR-010 pattern. Must record: who approved, on what legal advice,
   with what scope limits. Without this, no estimates and no code.
2. **Prominent, unmissable disclaimer at the point of submission** — the
   contributing user is responsible for confirming they are not violating any
   confidentiality agreement. The product cannot verify this and must not bury
   the responsibility in fine print.
3. **Minimum-contributor threshold** — a specific documented number per
   provider/tier/volume-band cell (recommended: ≥ 5 distinct organizations).
   Aggregates render only above threshold; everything below stays in
   "collecting" state.
4. **Plausibility bounds + review step before aggregation** — outlier
   detection at minimum, moderation review for statistically unusual
   submissions. Document the bounds, the reviewer role, and the audit trail
   (who approved what, when).

## 4. Explicit non-goals (if S10 ever proceeds)

- **No real-time individual quote sharing** — aggregated periodic snapshots
  only.
- **No scraping or inference from other data sources** — e.g., inferring a
  company's negotiated rate from disclosed spend via R5. Only data explicitly
  and separately submitted for this purpose counts.
- **No per-company figures in any view** — including internal/admin/debug
  views, logs, exports, and backups. Aggregates only, above threshold.
- **No silent threshold relaxation** — lowering the minimum-contributor
  number later is itself an ADR-level decision, not a config tweak.

## 5. Data-maturity gate (same pattern as S1)

Usage metrics are meaningless until the threshold is reachable. Track whether
the minimum-contributor threshold is actually met for **any**
provider/tier/band cell before promoting S10 out of "collecting data, not yet
showing anything." If no cell ever reaches threshold, S10 stays unpromoted —
that is a valid outcome, not a failure to ship.

## 6. Suggested success metrics (post-gate only)

- Submission completions with disclaimer acknowledged.
- Cells reaching the minimum-contributor threshold (count, over time).
- Aggregate views per matured cell — *not* submission volume alone.

## 7. Effort stance

**Do not estimate engineering time until the sign-off in §3.1 is obtained.**
Same standing as R10 pre-GA: open-ended until the strategic question is
answered. When estimated, budget for: submission + review-queue UI, aggregate
engine with threshold enforcement, moderation tooling + audit log, and ongoing
anti-gaming maintenance — not just a form and a chart.

## 8. Decision log

| Date | Decision | By whom |
|---|---|---|
| 2026-09-11 | S10 HELD — no code, no estimates, pending §3 sign-off | Product (this doc is the record) |
| 2026-09-11 | Vote NOT held — no legal/business counterparty in-session; HELD reaffirmed, not decided. To schedule: name the legal reviewer, circulate §3 package, record vote here | Engineering (status record, not a vote) |
| — | ADR-level go/no-go | *pending* |
| — | Threshold number + bounds documented | *pending* |

---

*Related: R10 precedent in `docs/ADR-010-routing-gateway.md`; S10 spec in the
S1–S10 implementation spec (Tier G). S10 shares R10's rule: "pilot works" must
never silently become "launched" — require the amendment vote.*
