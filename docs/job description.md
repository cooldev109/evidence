# EVIDENCE Module — Detailed Job Description

## Project Overview

**Project name:** EVIDENCE — Digital Chain of Custody Module
**Engagement type:** Fixed-scope, fixed-price contract
**Duration:** 8 weeks
**Delivery model:** 4 bi-weekly milestones
**Work model:** 100% remote, in parallel with internal team (who performs code review)
**IP / Rights:** Full assignment of all source code rights to the client at each milestone (not only at final delivery)

EVIDENCE is a **digital chain-of-custody layer** that transforms ordinary system events into **legally admissible evidence**. The module is anchored on Brazilian judicial decisions regarding digital chain of custody, and is designed to be jurisdictionally extensible to the European Union (eIDAS) and the United States.

The system captures events, hashes and chains them cryptographically, anchors them in time via a Timestamp Authority (TSA), stores them in tamper-evident append-only storage, and exposes verification endpoints and legal-grade PDF reports that third parties (lawyers, expert witnesses, regulators) can independently validate.

---

## Scope of Work

### 1. Event Capture Layer
- REST API for synchronous event ingestion.
- Webhook receiver for asynchronous event ingestion from external systems.
- Input validation, authentication, rate limiting, and tenant scoping.

### 2. Cryptographic Integrity — Hash Chaining
- SHA-256 hashing of each event payload.
- **Hash-linked** record structure: every record references the hash of the previous record, forming a tamper-evident chain per tenant.
- Detection and reporting of any chain break.

### 3. Trusted Timestamping (RFC 3161) — Multi-Jurisdiction
- Integration with **RFC 3161** Timestamp Authorities, with a **provider-agnostic** abstraction layer.
- **Native Brazilian TSA** support (ICP-Brasil compliant — note: the client referenced "RFC 6131"; the correct standard is **RFC 3161**, used by ICP-Brasil's Carimbo do Tempo).
- Pluggable providers for **European Union** (eIDAS-qualified TSAs) and **United States** TSAs.
- TSA provider selected automatically based on user/tenant locale, with override capability.

### 4. Append-Only Storage
- Tamper-evident storage using **AWS S3 Object Lock** (Compliance or Governance mode) or equivalent WORM (Write-Once-Read-Many) technology.
- Retention policies aligned with legal evidence-preservation requirements per jurisdiction.
- Object versioning and immutability guarantees.

### 5. Legal Evidence PDF Generation
- Generation of a court-ready PDF report containing:
  - Full chain of custody for the requested event(s).
  - Hash chain proofs and verification steps.
  - Embedded RFC 3161 timestamp tokens.
  - Tenant, jurisdiction, and provider metadata.
- **Multi-language** output (Portuguese, English, Spanish at minimum) so reports match the jurisdiction in which they will be filed.

### 6. Public Verification API
- Publicly accessible REST endpoints allowing third parties (lawyers, expert witnesses, auditors, courts) to verify the validity of a piece of evidence without prior credentials.
- Verification covers: hash integrity, chain continuity, TSA token validity, and storage immutability.
- Machine-readable (JSON) and human-readable responses.

### 7. Multi-Tenant Administrative Panel (React)
- React-based admin frontend.
- **Multi-tenant** architecture with tenant isolation at data, UI, and access-control layers.
- **Multi-language UI** (i18n) — Portuguese, English, Spanish.
- Locale-aware defaults for TSA provider selection.
- Tenant management, event browsing, evidence export, audit log views, and verification status dashboards.

---

## Technology Stack

| Layer            | Technology                                              |
|------------------|---------------------------------------------------------|
| Backend          | Node.js + TypeScript                                    |
| Database         | PostgreSQL (advanced features: RLS, partitioning, etc.) |
| Frontend         | React (multi-tenant, i18n)                              |
| Infrastructure   | AWS (S3 + Object Lock, IAM, KMS)                        |
| Containerization | Docker                                                  |
| Timestamping     | RFC 3161 TSA — ICP-Brasil, eIDAS, US providers          |

---

## Milestones, Deliverables & Pricing

**Total fixed price: USD 3,000** for the full 8-week engagement.
Code is transferred to the client at **each milestone**, not only at final delivery.

### Milestone 1 — Event Capture & Hash Chaining — **USD 600** (Weeks 1–2)
- REST API and webhook receiver for event ingestion.
- SHA-256 hashing pipeline.
- Hash-linked record schema in PostgreSQL.
- Multi-tenant data model foundation.
- Tenant-scoped authentication baseline.
- Unit and integration tests for capture and chain integrity.

### Milestone 2 — TSA Timestamping & Append-Only Storage — **USD 900** (Weeks 3–4)
- Provider-agnostic RFC 3161 TSA integration layer.
- ICP-Brasil TSA implementation as the default Brazilian provider.
- Stubs / adapters for eIDAS and US TSA providers.
- AWS S3 + Object Lock integration for append-only evidence storage.
- KMS-backed key management for signing/verification material.
- Retention and immutability policy configuration.

### Milestone 3 — Legal PDF + Public Verification API — **USD 900** (Weeks 5–6)
- Court-ready PDF report generator with embedded TSA tokens and chain proofs.
- Multi-language PDF output (PT / EN / ES).
- Public verification REST API (no-auth read endpoints, rate-limited).
- Independent re-verification of hash chain and TSA tokens from stored evidence.
- API documentation (OpenAPI) for third-party consumers.

### Milestone 4 — Multi-Tenant React Admin Panel — **USD 600** (Weeks 7–8)
- React admin panel with multi-tenant architecture.
- Internationalization (PT / EN / ES) with locale-driven TSA defaults.
- Tenant management, event browsing, evidence export, verification dashboards.
- Containerization (Docker) and deployment documentation for the full stack.
- Final handover documentation.

---

## Cross-Cutting Requirements

- **Multi-language support** across PDF reports, public verification API responses, and admin UI.
- **Jurisdiction-aware TSA selection** driven by user/tenant locale, with explicit override.
- **Provider-agnostic abstractions** so additional TSAs and storage backends can be added without core changes.
- **Audit logging** of all administrative and verification actions.
- **Tenant isolation** enforced at the database (e.g., PostgreSQL RLS), application, and infrastructure layers.
- **Code review** by the client's internal team on every milestone.
- **Full IP assignment** at each milestone.

---

## Required Candidate Profile

### Essential
- Proven backend experience with **Node.js / TypeScript** (or Python).
- Working knowledge of **cryptography**: hashing, digital signatures, certificate handling.
- Experience integrating with **RFC 3161 Timestamp Authorities** or comparable standards (ICP-Brasil, eIDAS).
- Advanced **PostgreSQL** proficiency and experience implementing **multi-tenancy** in SaaS products.
- Hands-on experience with **AWS** — specifically **S3 (Object Lock)**, **IAM**, and **KMS**.

### Differentiators
- Prior work in **RegTech** (regulatory technology).
- Experience on projects with a **legal / judicial focus** or strong **data-integrity** requirements (e.g., audit trails, e-discovery, notarization, blockchain-anchored evidence).
- Familiarity with **eIDAS** and **ICP-Brasil** ecosystems.

---

## Engagement Terms

- **Pricing:** USD 3,000 fixed, paid per milestone (600 / 900 / 900 / 600).
- **Schedule:** 4 bi-weekly milestones over 8 weeks.
- **Working mode:** 100% remote, asynchronous, in parallel with the client's internal engineering team.
- **Code review:** Performed by the client's internal team at each milestone.
- **IP transfer:** Full and irrevocable assignment of all source code rights to the client at the close of each milestone.
- **Confirmed scope additions:** Multi-language support and locale-driven TSA selection (BR / EU / US) — confirmed in writing during onboarding and included at the agreed fixed price.

---

## Open Items / Clarifications Recommended

- **TSA standard reference:** Client mentioned "RFC 6131"; the actual RFC for trusted timestamping used by ICP-Brasil, eIDAS, and US providers is **RFC 3161** (with RFC 5816 update). Worth confirming with the client during kickoff to avoid ambiguity in the contract.
- **Target languages:** Final list of supported languages for PDF and UI should be confirmed (proposed: PT-BR, EN-US, ES).
- **Retention period** for S3 Object Lock per jurisdiction.
- **Hosting model:** Whether infrastructure is owned by the client's AWS account or provisioned by the contractor during development.
