# Owner Knowledge Transfer Chain Design

Date: 2026-08-14
Status: DESIGN ONLY. No code, data, activation, or deployment was performed.

## Goal

Make owner-submitted text/ZIP knowledge auditable from intake through active structured facts, with section-level approval and verifiable publish feedback. Reuse `zipIngestion`, learning review, and structured publish; do not create a parallel ingestion system.

## Proposed End-to-End Flow

### 1. Intake - existing

`zipIngestion` receives an owner/manager ZIP, verifies sender role, archive hash, safe paths and content limits, then creates a review job and section candidates in `pending_owner_review`. Raw candidate text remains sanitized and is never treated as active policy.

### 2. Owner summary - missing link

After extraction, create an owner-private review summary containing:

- job ID and archive hash (masked)
- detected section IDs and human-readable titles
- classification: informational, behavioral constraint, critical safety, archive-only
- detected application names/codes (masked where sensitive)
- conflict candidates against current knowledge
- proposed target: `app_facts.md`, structured facts, policy catalog, or archive
- no raw candidate messages or unnecessary PII

The summary must be available in the dashboard review queue and as an owner-private WhatsApp notification. It must not claim that anything is active.

### 3. Section-level approval - missing link

The dashboard displays one row per detected section with:

- `section_id`, title, source excerpt, sanitized preview
- proposed target and risk classification
- current-vs-proposed diff
- conflict warnings
- actions: approve section, reject section, approve all safe sections, reject all

Approval is bound to the archive hash, section hash, owner identity, timestamp, and one-time review version. “Approve all” is only a convenience action that creates individual approval records; it must not bypass section audit.

### 4. Materialization - missing link

Approved sections are passed to the existing learning approval/publish pipeline as typed candidates:

- `app_fact_candidate`: eligible for structured app facts after safety/schema/conflict validation
- policy/behavior sections: routed to their specific owner-reviewed policy workflow
- legacy rates: archive-only, never active
- unsupported or conflicting sections: remain pending/rejected and cannot publish

The materializer writes a new version of `app_facts.md` atomically through a temporary file, preserving the previous version and recording source archive hash plus section hashes. It must not edit the live file directly from the model/context builder.

### 5. Structured publish - existing

The existing structured publisher derives `app_facts_structured.json` and its manifest from the approved markdown source, validates schema/hash/risk/conflict gates, and writes the new version atomically. The manifest must include source archive hash, approved section IDs, source hash, generated structured hash, and previous-version rollback pointer.

Activation remains separate from review approval where the existing owner activation gate requires it. A failed publish leaves the previous active version untouched.

### 6. Evidence feedback - missing link

After publish, the owner receives a deterministic audit result containing:

- job ID and publish ID
- approved/rejected/skipped section IDs
- active version/hash (masked)
- structured fact count
- manifest validation result
- activation status: `published_active`, `published_pending_activation`, or `failed_previous_version_preserved`
- rollback pointer

The system must emit success only after the file, manifest and audit record are durably written. A queued or dry-run result must never be described as active.

## Reused Components

- `src/bridge/zipIngestion/`: archive intake, safety checks, hashing, review candidates
- learning/approval store: section approval records and audit trail
- `publishStructuredKnowledgeSources`: deterministic structured derivation and manifest
- existing owner activation controller: one-time, expiring activation and rollback
- dashboard handoff/review endpoints: owner-private review and status visibility

No second queue, second manifest format, or parallel knowledge writer should be introduced.

## Approval and Safety Gates

1. Sender is authenticated owner/manager.
2. Archive and section hashes match the reviewed source.
3. Section target and type are allowlisted.
4. PII, secrets, contact data, guarantees and unsafe instructions are rejected or quarantined.
5. Current-vs-proposed conflict is visible before approval.
6. Owner approval is recorded per section.
7. Schema, safety and conflict validation pass before materialization.
8. Atomic write and manifest verification pass before active status.
9. Rollback pointer is written before activation.

## Failure and Rollback

- Summary generation failure: keep the intake job pending; do not publish.
- Section approval failure: reject only that section; unrelated approved sections may proceed.
- Materialization failure: preserve the previous markdown version.
- Structured validation failure: preserve previous JSON and manifest.
- Activation failure: remain on the previous active version and report `failed_previous_version_preserved`.
- Human rollback uses the existing version pointer and audit log; no manual file editing is required.

## Owner Review Screen

The minimum review screen must show the section title, sanitized original excerpt, proposed normalized text, target file/schema, risk class, current-vs-proposed diff, conflict warnings, source/archive hash, and explicit approve/reject controls. It must clearly separate `queued`, `approved_for_bundle`, `dry_run_validated`, `published_pending_activation`, and `active`.

## Acceptance Criteria

- A ZIP with 8 sections produces 8 independently reviewable records.
- Approving 2 sections writes only those 2 sections to the approved bundle.
- Rejected/legacy sections never enter active structured facts.
- The owner sees a masked hash and section-level active confirmation after publish.
- A forced hash/schema/risk failure leaves the previous active knowledge unchanged.
- Full audit trail is append-only and contains no raw candidate message or unnecessary PII.
