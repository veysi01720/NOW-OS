# Package 09 - Backend Semantic Enforcement

Status: PASS / CANDIDATE IMAGE VERIFIED / PRODUCTION UNCHANGED

## Objective

Package 09 adds a provider-neutral semantic acceptance boundary after the strict ConversationDecision V3.1 shape validator. It does not activate Responses, apply V3 state patches, rewrite replies, or send outbound messages.

## Validation Order

1. Strict V3.1 shape validation.
2. Role and channel boundary validation.
3. Backend domain action allowlist validation.
4. Orchestration `next_action` compatibility validation.
5. Canonical policy fact reference validation.
6. State patch value and evidence validation.
7. Deterministic approved-app reply validation.

Any failure is terminal for the proposed V3 decision. A failed proposal remains an observation only.

## Action Boundaries

`chosen_actions` contains backend domain action IDs and must be a subset of backend-provided `allowed_actions`.

`next_action` is a separate orchestration outcome. Compatibility is checked against required domain actions, role, escalation flags, and whether a state patch exists. It is never compared to the domain allowlist as the same string namespace.

## State Patch Evidence

- Every non-null patch field requires exactly one evidence record.
- Null patch fields cannot carry evidence.
- Duplicate evidence for one field is rejected.
- Non-policy evidence uses `evidence_ref=null`.
- Canonical-policy evidence uses a sanitized known fact ID.
- Current-message evidence must deterministically match the proposed value.
- Existing-state evidence must equal backend state.
- Text-only preference is atomic: `preferred_work_mode=text_only` and `video_allowed=false`.
- Work-model disclosure may use reply-content evidence only when the decision cites a canonical fact.

Package 09 validates proposals but does not apply them. State mutation remains backend-owned and disabled for Responses shadow.

## Approved App Boundary

Reply text is checked against the configured approved app list, the currently selected approved app, and the deterministic denied platform/app catalog. A denied term cannot be emitted unless it is explicitly approved for that context.

This guard does not infer arbitrary brand names from capitalization. It enforces the backend-owned deterministic vocabulary and fails closed for known denied terms.

## Compatibility

- Conversation Decision V2 is unchanged.
- Assistant Response Contract V1.0 is unchanged.
- Primary adapter remains `AssistantAdapter`.
- Responses remains default-off and shadow-only.
- No state, memory, queue, knowledge, vector, provider, model, Assistant, Evolution, webhook, or production change is authorized.

## Next Package Boundary

Package 10 may use the accepted semantic result for controlled state-transition preparation. It must not bypass this validator or merge model patches directly into persistent state.

## Verification

- Build: PASS
- Full test suite: PASS, 499 tests
- Audit: PASS, 0 high vulnerabilities
- Provenance: PASS
- Candidate image: `now_os_backend:package09-semantic-190e2854`
- Candidate image startup: PASS with dummy non-secret environment
- Production deploy: NOT RUN
