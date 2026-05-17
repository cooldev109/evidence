# EVIDENCE — Project Roadmap

**Duration:** 8 weeks · 4 bi-weekly milestones · USD 3,000 fixed
**Working mode:** 100% remote, async, code review by client's internal team at each milestone
**IP handoff:** Full source rights transferred at the close of each milestone

This roadmap converts the [job description](job%20description.md) into a week-by-week execution plan with concrete tasks, acceptance criteria, and deliverables per milestone. Buffer time, code-review cycles, and cross-cutting work (testing, CI, security) are accounted for so the schedule survives normal slippage.

---

## Pre-Kickoff Checklist (Day 0)

Items to lock down with the client **before** Week 1 starts. Each one blocks downstream work if left ambiguous.

- [ ] **TSA standard.** Confirm the standard is **RFC 3161** (not RFC 6131 as written in chat). ICP-Brasil "Carimbo do Tempo", eIDAS qualified timestamps, and most US TSAs all use RFC 3161 + RFC 5816.
- [ ] **TSA providers per jurisdiction.** Concrete choices: BR (e.g., ICP-Brasil-accredited PSC), EU (e.g., FreeTSA, DigiCert eIDAS, GlobalSign), US (e.g., DigiCert, GlobalSign, Sectigo). Will paid providers be procured by client or contractor?
- [ ] **Language list.** Proposed: PT-BR, EN-US, ES. Confirm whether ES is required or if EN + PT is enough for v1.
- [ ] **AWS account ownership.** Whose AWS account hosts S3 / KMS during development and after handover? IAM access for contractor needs scoping.
- [ ] **Retention period per jurisdiction.** Years to enforce in S3 Object Lock — varies by legal-evidence statute.
- [ ] **Tenant model.** Shared DB with Row-Level Security vs. schema-per-tenant. Default recommendation: **shared DB + RLS** for cost and operational simplicity at this scale.
- [ ] **Auth model for admin panel.** Email/password, SSO, both? OAuth providers required?
- [ ] **Repo + CI access.** GitHub repo (already in place: [cooldev109/evidence](https://github.com/cooldev109/evidence)), CI runner (GitHub Actions assumed), branch protection rules.
- [ ] **Code-review SLA.** Target turnaround from internal review team per milestone PR — proposed: 2 business days.

---

## Working Assumptions

- **Stack:** Node.js 20 LTS + TypeScript, PostgreSQL 16, React 18 (Vite), Docker, AWS (S3 + Object Lock, IAM, KMS).
- **Tooling:** pnpm, ESLint + Prettier, Vitest (backend) + Vitest/Playwright (frontend), GitHub Actions, Drizzle or Prisma for DB layer (preference: Drizzle for explicit migrations), Zod for input validation, Fastify for HTTP server.
- **Branching:** Trunk-based with short-lived feature branches; one PR per logical chunk, milestone PR for client review.
- **Repo layout:** monorepo via pnpm workspaces — `apps/api`, `apps/admin`, `packages/core`, `packages/tsa`, `packages/storage`, `packages/verify`, `infra/docker`.

---

## Milestone 1 — Event Capture & Hash Chaining
**Weeks 1–2 · USD 600**

### Week 1 — Foundations
| Day | Focus |
|-----|-------|
| 1 | Repo scaffolding (pnpm workspaces, TS configs, ESLint, Vitest). Docker baseline. GitHub Actions CI: lint + typecheck + test on PR. |
| 2 | PostgreSQL container, migrations tooling (Drizzle), local dev compose. Baseline `tenants`, `users`, `api_keys` tables with RLS policies. |
| 3 | Tenant-scoped authentication: API key middleware, tenant resolution from key, request-context propagation. |
| 4 | `events` table schema: `id`, `tenant_id`, `payload (jsonb)`, `payload_hash`, `prev_hash`, `chain_hash`, `seq`, `created_at`. Indexes for tenant + seq lookup. |
| 5 | REST API `POST /v1/events` — input validation (Zod), hash computation, atomic chain append in a transaction with `SELECT ... FOR UPDATE` on the tenant's tip row. |

### Week 2 — Capture surface area + integrity
| Day | Focus |
|-----|-------|
| 6 | Webhook receiver `POST /v1/webhooks/:source` — signature verification per source, idempotency via `external_id`. |
| 7 | `GET /v1/events/:id` and `GET /v1/events` with cursor pagination, tenant scoping. |
| 8 | Chain verification utility: `verifyChain(tenantId, fromSeq, toSeq)` — re-computes hashes, reports first break. |
| 9 | Test pass: unit tests for hashing + chaining, integration tests for capture endpoints, fuzz test that inserts 10k events and verifies the chain holds. Rate limiting (per API key). |
| 10 | Milestone PR, written walkthrough for reviewers, demo script. Buffer for review feedback. |

### Acceptance Criteria
- Events can be ingested via REST + webhook with auth and tenant scoping.
- Each persisted event has SHA-256 of payload AND a chain hash linking it to the previous event of the same tenant.
- Concurrent inserts to the same tenant cannot create chain forks (proven by a stress test).
- A verification utility detects any tampering or gap in the chain.
- CI green; coverage ≥ 80% on core packages.

### Deliverables
- `apps/api` with capture endpoints, `packages/core` with hashing/chain primitives.
- Drizzle migrations, seed data, local `docker-compose up` works end-to-end.
- Architecture note (`docs/architecture/m1.md`) explaining the chain semantics and concurrency guarantees.

---

## Milestone 2 — TSA Timestamping & Append-Only Storage
**Weeks 3–4 · USD 900**

### Week 3 — Trusted timestamping
| Day | Focus |
|-----|-------|
| 11 | TSA abstraction design: `TSAProvider` interface (`requestToken(digest) → TimestampToken`, `verifyToken(token, digest) → VerificationResult`). RFC 3161 request/response encoder using `node-forge` or `asn1js`. |
| 12 | **BR provider:** integration with an ICP-Brasil-accredited TSA (default), including cert chain validation against ICP-Brasil root. |
| 13 | **EU provider:** eIDAS-qualified TSA adapter (e.g., FreeTSA for dev, swappable). |
| 14 | **US provider:** DigiCert or GlobalSign TSA adapter. Locale-driven provider selection (`pickProvider(tenantLocale, override)`). |
| 15 | Persist TSA tokens with each event: new `event_timestamps` table — `event_id`, `provider`, `token (bytea)`, `issued_at`, `tsa_cert_chain`. Background job for batching/timestamp retries. |

### Week 4 — Append-only storage
| Day | Focus |
|-----|-------|
| 16 | S3 bucket provisioning (Terraform module under `infra/`): versioning on, Object Lock in **Compliance** mode, default retention configurable per tenant/jurisdiction. |
| 17 | Storage adapter `packages/storage`: `putEvidence(tenantId, eventId, blob)` writes the canonical event envelope (payload + hash + TSA token) to S3 with retention lock; `getEvidence` reads it back. |
| 18 | KMS-backed envelope encryption for evidence blobs. Key per tenant; key policy locked to the EVIDENCE IAM role. |
| 19 | Background worker: as events are appended, write evidence to S3 within N seconds; record `s3_key` and `version_id` on the event row. Retry with exponential backoff on failure. |
| 20 | Tests: TSA token round-trip + verification, S3 immutability test (attempt to delete/overwrite a locked object — must fail), KMS encrypt/decrypt round-trip. Milestone PR + demo. |

### Acceptance Criteria
- Each event has at least one valid RFC 3161 timestamp token from the locale-appropriate TSA, persisted alongside the event.
- TSA provider can be swapped without touching capture or storage code.
- Every event has a corresponding immutable S3 object that cannot be deleted or modified before retention expiry.
- Evidence blobs at rest are encrypted with a tenant-scoped KMS key.

### Deliverables
- `packages/tsa` with three provider implementations and a verification helper.
- `packages/storage` with the S3 + KMS adapter.
- Terraform under `infra/aws/` for buckets, IAM roles, KMS keys.
- Runbook (`docs/runbook/tsa.md`) for provider rotation and outage response.

---

## Milestone 3 — Legal PDF + Public Verification API
**Weeks 5–6 · USD 900**

### Week 5 — PDF evidence report
| Day | Focus |
|-----|-------|
| 21 | PDF template design (using `pdfkit` or React-PDF). Sections: cover page, tenant metadata, event list with hashes, chain proof, embedded TSA tokens (base64), verification instructions. |
| 22 | i18n integration: ICU message bundles for PT-BR / EN-US / ES, applied to PDF strings. Locale chosen by request param, defaulting to tenant locale. |
| 23 | PDF generation endpoint `POST /v1/reports` — takes a tenant + event range + locale, streams a signed PDF. PDF itself is hashed and signed (PAdES-like) with a tenant-bound key. |
| 24 | Embed a QR code / short URL on the PDF that points to the public verification endpoint with the report ID — enables a verifier to confirm validity in one click. |
| 25 | Tests for PDF determinism (same input → byte-identical output for hashing), language switching, large reports (1k+ events). |

### Week 6 — Public verification API
| Day | Focus |
|-----|-------|
| 26 | Public endpoint `GET /public/v1/evidence/:id` (no auth, rate-limited by IP): returns a JSON proof envelope — hash chain segment, TSA tokens, S3 object reference, verification steps. |
| 27 | `POST /public/v1/verify` — accepts a PDF or proof envelope, re-runs the full verification pipeline (hash chain continuity, TSA token validation against the issuing TSA's certs, S3 retention check), returns a structured pass/fail report. |
| 28 | OpenAPI 3.1 spec for all public endpoints + Redoc-served docs page. Multi-language response messages. |
| 29 | Standalone verification CLI (`packages/verify` with a `bin/`) so a third party can verify a downloaded PDF offline (TSA cert chain validation requires network for OCSP, document this). |
| 30 | End-to-end test: ingest events → generate PDF → public-verify PDF → tamper with a stored event → verification fails with a specific error. Milestone PR + demo. |

### Acceptance Criteria
- A generated PDF report opens correctly, contains all chain-of-custody data in the requested language, and embeds verifiable TSA tokens.
- The public verification API can independently confirm any piece of evidence using only the proof envelope and public TSA certs.
- Tampering with stored evidence is detected and surfaced with a specific error code.
- OpenAPI spec is published and tested with at least one third-party HTTP client.

### Deliverables
- `packages/pdf` (or equivalent) with the report generator.
- `packages/verify` with the verification engine + CLI.
- Public docs site (`apps/api` serving Redoc at `/docs`).
- Example "lawyer's guide" markdown explaining how to verify a PDF, in PT and EN.

---

## Milestone 4 — React Multi-Tenant Admin Panel
**Weeks 7–8 · USD 600**

### Week 7 — Foundations + tenant UX
| Day | Focus |
|-----|-------|
| 31 | React + Vite + TypeScript scaffold. Auth (cookie/JWT against the API), tenant-aware routing (`/t/:tenantSlug/...`), protected routes, layout shell. |
| 32 | i18n setup (`react-intl` or `i18next`) with PT / EN / ES bundles. Locale persisted per user, default from browser, drives TSA provider hint on the backend. |
| 33 | Tenant management screens: list, create, edit; tenant-level settings (default locale, default TSA provider, retention policy). Admin-only. |
| 34 | API keys & webhook sources management UI. |
| 35 | Event browser: paginated table per tenant with filters (date range, source, hash search), event detail drawer with full payload + chain context. |

### Week 8 — Evidence operations + handover
| Day | Focus |
|-----|-------|
| 36 | Evidence export UI: select event range → request PDF in chosen language → download. Background job status polling. |
| 37 | Verification dashboard: chain health per tenant (last verified seq, any breaks), TSA provider status, S3 retention summary. |
| 38 | Audit log view: every admin action recorded server-side (`audit_events` table), filterable UI. |
| 39 | `docker-compose.yml` for the full stack (api + admin + postgres + localstack/minio for S3). Deployment doc: production AWS topology, env vars, secrets, KMS key creation. |
| 40 | Handover: `docs/handover.md`, recorded walkthrough, final demo, milestone PR. |

### Acceptance Criteria
- An admin can sign in, switch tenant, browse events, export a legal PDF, and view verification health.
- UI is fully translated in PT / EN / ES with no hardcoded strings.
- All admin actions are audit-logged and visible in the panel.
- `docker-compose up` brings up the entire stack on a fresh machine.

### Deliverables
- `apps/admin` React app, production-build verified.
- Full `docker-compose.yml` + production deployment doc.
- Final handover document covering architecture, ops runbooks, and roadmap for v2 items not in scope.

---

## Cross-Cutting Tracks (run every week)

### Testing
- Unit tests alongside each module (Vitest). Target coverage ≥ 80% on `packages/*`.
- Integration tests with a real Postgres + LocalStack S3 in CI.
- One end-to-end happy-path test per milestone.

### CI/CD
- GitHub Actions: lint → typecheck → test → build → docker image on every PR.
- Milestone PRs trigger a tagged image build for the client's review environment.

### Security
- All inputs validated via Zod at the HTTP boundary.
- Secrets only via env vars / AWS Secrets Manager — never in code or repo.
- Dependency scanning (`pnpm audit` + Dependabot).
- Brief threat-model note added at each milestone PR.

### Observability
- Structured JSON logging (pino) with `tenant_id` + `request_id` propagation.
- Metrics counters for: events ingested, TSA requests, TSA failures, S3 puts, chain verifications.
- Health endpoint exposing dependency status (DB, S3, TSA reachability).

### Documentation
- Each milestone ships with an `architecture/m{N}.md` page describing the design decisions and trade-offs of the work delivered.
- OpenAPI kept in sync with the API on every PR via a CI check.

---

## Code Review Cadence with Client's Internal Team

- **Per-feature PRs** opened daily as work progresses — small reviews, fast turnaround.
- **Milestone PR** at the end of each fortnight: a meta-PR (or release-notes doc) summarizing the bundle, linked to all feature PRs, with the demo recording and architecture note.
- **Code-review SLA:** 2 business days per PR — agreed at kickoff. If review is slower, the contractor flags risk to milestone date in writing.
- **Review feedback loop:** reviewer comments addressed within 1 business day; substantive design pushback triggers a sync (async-first via written reply, video call if needed).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| TSA provider procurement delayed by client | Medium | High | Use FreeTSA / public test TSAs during development, plug in production credentials at the end of Milestone 2. |
| AWS access provisioning slow | Medium | High | LocalStack (S3 + KMS emulation) used for local dev so work isn't blocked. |
| Object Lock retention misconfigured (data unrecoverable) | Low | Critical | All Object Lock writes in dev/staging use **Governance** mode; **Compliance** mode only flipped on in production after client sign-off. |
| Scope creep from "small additions" | High | Medium | Anything beyond the four milestones logged in `docs/scope-changes.md` with effort estimate; client decides defer vs. paid change order. |
| Multi-language scope (added mid-deal) underestimated | Medium | Medium | i18n integrated from Week 1 in API responses so translation surface stays small; PDF templates designed with extraction-from-the-start. |
| Reviewer turnaround slower than SLA | Medium | High | Milestone PRs opened 1 day before the milestone deadline whenever possible; risk flagged immediately when SLA missed. |

---

## Communication Cadence

- **Weekly written update** (Friday): what shipped, what's next week, blockers, any risks.
- **Milestone demo** (end of week 2/4/6/8): short recorded walkthrough + live Q&A if requested.
- **Async-first:** Slack/email for short questions, written specs for design decisions, video calls only when async stalls.

---

## Out of Scope (v1 — flag for v2 if requested)

- Blockchain anchoring (e.g., OpenTimestamps over Bitcoin) — could complement RFC 3161 in a later phase.
- Mobile SDK for direct event capture from mobile apps.
- Long-term archival migration (e.g., to Glacier Deep Archive) — retention policies leave the door open but UI not built.
- SAML/SSO for the admin panel — email/password assumed in v1.
- White-label theming per tenant — multi-tenant data isolation in v1, visual theming deferred.
