# V2 Grounding Fix Design

## Status

Design only. No publish, active knowledge mutation, vector-store update, Assistant binding change, or deployment is performed by this document.

## Problem

The live Conversation Decision V2 path can lack the structured application facts that are available to the canonical knowledge system. A model may therefore fall back, invent an action, or fail to preserve official facts even when the source data exists elsewhere.

## Design goals

- Produce structured facts from the canonical, owner-approved source set.
- Make the generated artifacts available to the live V2 context builder.
- Preserve official app facts and link catalog precedence.
- Keep generated artifacts versioned, hashed, validated, and rollbackable.
- Never let model output become an authoritative fact source.
- Keep legacy Assistant behavior unchanged until a separately approved cutover.

## A. Publish mechanism

1. Select only validated official sources and approved review/training sources according to the existing bundle rules.
2. Normalize them into derived artifacts such as app_facts_structured.json, routing rules, and a manifest.
3. Run source-integrity, placeholder/thin-file, conflict, risk-language, and link-policy gates.
4. Write to an immutable versioned staging directory with a manifest hash.
5. Perform a dry-run retrieval proof and compare official-source precedence.
6. Activate only an approved manifest pointer; failed validation leaves the previous pointer active.
7. Record sanitized publish and rollback audit events.

The active artifact must be mounted or copied into the canonical backend image/runtime through the existing deployment process. It must not be generated on demand from a model response.

## B. Context builder integration

The V2 context builder receives a provider-neutral structured-facts object with:

- schema version and manifest id;
- official facts and source provenance;
- approved links and link policy;
- current workflow/routing rules;
- conflict and risk guards;
- compact conversation state needed for the current decision.

The adapter receives this context through the existing provider-neutral input contract. The prompt formatter may serialize it for Responses, but the source ownership remains backend-side. The legacy Assistant path continues to receive its existing context until a separately approved migration.

## Authority and guard order

Backend facts and deterministic transition rules run before model execution. Model output is parsed and validated against the decision schema. Official facts win conflicts. Unknown links are not promoted. Unsupported guarantees and unsafe claims are rejected. Missing facts produce a deterministic clarification or human-handoff action, not an invented answer.

## Rollback

A publish snapshot contains the previous active manifest pointer, source hashes, derived artifact hashes, and runtime compatibility metadata. Retrieval proof failure, source-integrity failure, or smoke/content safety failure restores the previous pointer. Rollback does not reset the database, delete WhatsApp sessions, or alter Evolution configuration.

## Acceptance criteria

- All required structured sources exist and pass integrity gates.
- V2 context builder includes the active structured-facts manifest.
- Golden/replay scenarios verify official facts, links, routing, and safe wording.
- No secret, phone, JID, group id, raw model output, or message content is logged.
- Legacy path remains behaviorally unchanged while the integration is shadowed.
- No active publish occurs without owner approval and a pre-publish snapshot.
- No vector or Assistant binding change occurs in design validation.
