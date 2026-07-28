# Learning Approval to Structured Facts Publish Design

## Status and scope

Design only. No learning behavior, active knowledge file, vector store,
provider, assistant binding, or activation is changed by this document.

## Current behavior and gap

`LRN-XX onayla` is an owner/manager command path that changes a learning
suggestion to `approved` and may create a knowledge patch through the existing
sync service. That approval must not be treated as active structured facts
publication. The missing capability is a controlled bridge from an approved
app-information suggestion to a dry-run `app_facts_structured.json` artifact.

## Eligibility boundary

Only suggestions classified as `app_fact_candidate` are eligible for this
structured-facts bridge. This includes a verified app name, platform name,
capability, invite/agency code, or app-specific routing fact with sanitized
source metadata. The following remain outside automatic structured-facts
publication and require their existing review paths: general work model,
payment/earnings claims, style rules, workflow rules, escalation rules, link
candidates, raw references, and any candidate text containing unsupported
guarantees or unverified links.

The static training number is not an eligible fact and is not added to
`app_facts.md` or structured facts.

## Proposed flow

1. Owner approval of `LRN-XX` records `approved_for_bundle` plus an append-only
   audit event. It does not modify active facts.
2. A deterministic selector creates an isolated dry-run from only eligible
   approved candidates. Rejected, pending, needs-edit, and ineligible types are
   excluded.
3. The assembler normalizes the candidate into the existing structured schema,
   preserves official app facts and link catalog authority, and writes a
   temporary `app_facts_structured.json` plus manifest.
4. Integrity gates verify required sources, schema completeness, no
   placeholders/thin records, conflict/risk flags, source hashes, and bundle
   hash. Any conflict remains a manifest note; it is never silently overwritten.
5. A distinct, one-time owner activation approval is required before the
   active file can change. `LRN-XX onayla` alone is insufficient. The existing
   owner command may be extended to present the dry-run and request this second
   approval, but it must not self-activate.
6. On explicit authenticated activation, atomically replace the active
   structured-facts artifact, write the active manifest/pointer, and retain a
   rollback snapshot. Hash mismatch, stale approval, failed integrity, or
   missing owner activation aborts before the active file is touched.

## Approval and identity controls

The owner approval must be bound to an authenticated owner-only private
command or dashboard action, scoped to tenant, candidate set/dry-run id,
bundle hash, and expiry. It must be single-use and append-only audited. A
boolean such as `ownerApproval: true` in code is not sufficient as an identity
check. Manager approval can review but cannot activate this structured-facts
publish.

## Idempotency, rollback, and observability

The dry-run id and bundle hash form the idempotency key. Repeating the same
approval cannot create a second active publish. Publish events expose only
sanitized status, counts, hashes, conflict/risk counts, and timestamps. The
previous active manifest pointer and file snapshot are retained until the new
artifact passes post-activation integrity checks; failure restores the prior
pointer/file atomically. No raw candidate text, phone, JID, or secret is logged.

## Acceptance criteria

- App-fact approvals produce a valid dry-run artifact and manifest.
- Non-app-fact approvals never enter structured facts automatically.
- Official facts and link catalog win conflicts.
- Rejected/pending/needs-edit records are excluded.
- Hash, schema, risk, conflict, and source-integrity gates pass before activation.
- Approval alone does not change active knowledge; distinct owner activation is
  required and audited.
- Repeated activation is idempotent and rollback restores the prior artifact.
- No OpenAI publish, vector modification, assistant binding change, or
  WhatsApp outbound is triggered by review or dry-run creation.

## Open decisions before implementation

1. Confirm the exact owner activation command/dashboard action and expiry.
2. Confirm whether app-specific payment timing facts remain review-only (the
   recommended default) or get a separate typed schema.
3. Confirm the active manifest location and rollback retention period.
