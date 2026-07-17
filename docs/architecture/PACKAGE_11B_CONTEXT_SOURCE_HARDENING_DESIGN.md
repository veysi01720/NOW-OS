# Package 11B - Context Source Hardening / Structured Facts

Generated: 2026-07-18

## Status

Implementation complete locally; acceptance evidence is required before Package 12.

## Purpose

Package 11B closes the Package 04 knowledge fixture failure and implements
Addendum Ek 6 structured-facts separation before any real configured-model
quality decision is made in Package 12.

## Ownership

- `app_facts.md` remains the official human-readable narrative source.
- `app_facts_structured.json` is the machine-readable representation used by
  backend context construction and deterministic validation.
- The backend loads, validates, and exposes structured facts.
- The model receives facts through backend context and does not own or update
  the knowledge source.
- A publish/dry-run integrity gate fails when the structured file is missing,
  invalid, lacks official anchors, or disagrees with `app_facts.md`.

## Package 04 Fixture Closure

Tests must create a complete knowledge bank in a temporary directory. Tests
must not read, write, copy, or delete the production `data/knowledge_bank`
directory. The fixture includes both `app_facts.md` and
`app_facts_structured.json`, plus the required link policy and training files.

This closes the Package 04 `ENOENT app_facts.md` failure class without copying
production data into a historical package workspace.

## Structured Context Contract

`BackendContextPayloadV1.structured_facts` contains:

- source status;
- source hash;
- normalized app facts;
- validation errors.

Exact app names, platform names, approved codes, aliases, status, and
capabilities such as text-only support are represented as fields rather than
being inferred from a markdown blob.

## Package 12 Gate

Package 12 must not start until Package 11B has all of the following evidence:

- TypeScript build passes;
- targeted context/source tests pass;
- full test suite passes;
- production knowledge path guard passes;
- source integrity gate rejects missing or mismatched structured facts;
- audit and provenance checks pass.

Package 11B does not call the real OpenAI Responses API. Package 12 will run
the configured `OPENAI_RESPONSES_MODEL` against the 13-scenario baseline and an
expanded adversarial set. A failing configured model is automatically marked
not eligible for canary, but switching to a different model still requires
owner approval. A prompt/policy iteration after a failed first run is tracked
as Package 12B rather than silently extending Package 12.

## Non-Negotiables

- No production deployment.
- No OpenAI publish or vector-store change.
- No real WhatsApp outbound.
- No queue/worker or live canary cutover.
- No model-name branching.
- No production knowledge content modification.
- Existing Assistant path remains available as rollback.
