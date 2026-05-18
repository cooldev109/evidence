# EVIDENCE

Digital chain-of-custody module. Captures system events, hashes them in a per-tenant hash-linked chain, anchors them in time with an RFC 3161 Timestamp Authority, stores them in append-only S3 storage, and lets third parties independently verify their validity. See [docs/job description.md](docs/job%20description.md) and [docs/roadmap.md](docs/roadmap.md).

## Status

**Milestone 1 — Event Capture & Hash Chaining: complete.** See [docs/architecture/m1.md](docs/architecture/m1.md).

**Milestone 2 — TSA Timestamping & Append-Only Storage: complete.** See [docs/architecture/m2.md](docs/architecture/m2.md).

## Prerequisites

- Node.js ≥ 20
- pnpm 10
- PostgreSQL 16 (local install **or** via the included `docker-compose.yml`)

## Quickstart

### Option A — Use Docker for Postgres

```bash
pnpm install
pnpm db:up                      # starts postgres on :5432
cp .env.example .env
pnpm db:migrate                 # applies schema + RLS policies
pnpm --filter @evidence/api db:seed   # creates a demo tenant + API key, prints curl
pnpm api:dev                    # http://localhost:3000
```

### Option B — Use an already-running local Postgres

```bash
sudo -u postgres psql -c "CREATE USER evidence WITH PASSWORD 'evidence';"
sudo -u postgres psql -c "CREATE DATABASE evidence OWNER evidence;"

pnpm install
cp .env.example .env            # the defaults work for local Postgres on :5432
pnpm db:migrate
pnpm --filter @evidence/api db:seed
pnpm api:dev
```

## Test it

```bash
# Run the full suite (unit + integration). Postgres must be reachable at $TEST_DATABASE_URL.
TEST_DATABASE_URL=postgres://evidence:evidence@localhost:5432/evidence pnpm test
```

Expected:

```
 Test Files  3 passed (3)
      Tests  27 passed (27)
```

The suite exercises:
- Hash + chain primitives (15 unit tests)
- Auth, tenant isolation, idempotency, pagination
- Chain verification and tamper detection
- Webhook signature verification
- **Chain integrity under 50 concurrent appends to the same tenant** (proves no chain fork under contention)
- TSA provider abstraction + locale routing (14 tests)
- Local evidence store immutability (rejects overwrites)
- End-to-end: capture → TSA → storage → retrieval, with canonical envelope verification

## Try the API

`pnpm --filter @evidence/api db:seed` prints a ready-to-paste `curl`. Or run the steps yourself:

```bash
# 1. Create a demo tenant + API key
pnpm --filter @evidence/api db:seed
# (copy the printed key, e.g. evk_AbC...)

# 2. Append an event
curl -X POST http://localhost:3000/v1/events \
  -H 'Authorization: Bearer evk_AbC...' \
  -H 'Content-Type: application/json' \
  -d '{"source":"app","payload":{"hello":"world"}}'

# 3. List events
curl http://localhost:3000/v1/events \
  -H 'Authorization: Bearer evk_AbC...'

# 4. Verify the chain
curl http://localhost:3000/v1/verify \
  -H 'Authorization: Bearer evk_AbC...'

# 5. Health check (no auth)
curl http://localhost:3000/health
```

## Project layout

```
evidence/
├── apps/api          # Fastify HTTP server (capture, chain, verify, webhooks, evidence)
├── packages/core     # Hashing + chain primitives + verifier (pure, stateless)
├── packages/tsa      # RFC 3161 TSA abstraction + Mock/FreeTSA/ICP-Brasil/eIDAS/US providers
├── packages/storage  # Append-only evidence store: LocalFilesystem + S3 Object Lock + KMS
├── infra/docker      # docker-compose for local Postgres
├── docs              # Job description, roadmap, architecture notes
└── .github/workflows # CI (lint, typecheck, migrate, test)
```

## Roadmap

| Milestone | Status | Scope |
|-----------|--------|-------|
| M1 — Event Capture & Hash Chaining | ✓ Complete | Multi-tenant ingestion, SHA-256 chain, RLS, verification |
| M2 — TSA Timestamping & Append-Only Storage | ✓ Complete | RFC 3161 (mock/FreeTSA/stubs), S3 Object Lock + KMS, canonical envelope |
| M3 — Legal PDF + Public Verification API | Pending | Court-ready PDFs (PT/EN/ES), public verify endpoints |
| M4 — Multi-Tenant React Admin Panel | Pending | i18n admin UI, tenant management, audit log |
