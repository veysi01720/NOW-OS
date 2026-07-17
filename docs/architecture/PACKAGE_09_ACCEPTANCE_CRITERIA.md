# Package 09 Acceptance Criteria

## Semantic Contract

1. Shape-invalid decisions never reach semantic acceptance.
2. Every chosen domain action must be backend-allowed.
3. `next_action` compatibility is validated separately from the domain action allowlist.
4. Unknown policy fact IDs are rejected.
5. Candidate state actions are rejected for owner, manager, and group roles.
6. Owner report actions are rejected for candidates.

## State Evidence

1. Every non-null patch has exactly one matching evidence record.
2. Duplicate, missing, orphan, unknown, or malformed evidence is rejected.
3. Current-message evidence deterministically supports the proposed value.
4. Existing-state evidence exactly matches backend state.
5. Canonical fact references exist in backend context.
6. Text-only preference fields remain internally consistent.
7. Invalid age, hours, gender, phone type, app, or acceptance values are rejected.

## Grounding And Safety

1. Known unapproved app/platform terms cannot appear in an accepted reply.
2. An explicitly approved term remains allowed.
3. Semantic failures produce no rewrite, state write, fallback, or outbound.
4. Shadow telemetry contains reason codes but no raw message, reply, phone, JID, or secret.

## Regression And Artifact Gates

1. Targeted semantic/adversarial tests pass.
2. Full tests, build, audit, Linux provenance, exact-image tests, and isolated startup pass.
3. Responses remains default-off, state-write disabled, and outbound disabled.
4. Production image and start time remain unchanged.
5. Real OpenAI and WhatsApp outbound counts remain zero.

## Package Decision

Package 09 PASS authorizes Package 10 controlled state-transition preparation only. It does not authorize Responses activation, canary, production deployment, or cutover.

## Verification Result

Status: PASS

- Semantic/adversarial tests: PASS
- Shadow integration tests: PASS
- Golden replay regression tests: PASS
- Build: PASS
- Full tests: PASS, 499 tests
- Audit: PASS, 0 high vulnerabilities
- Provenance: PASS
- Candidate image build: PASS
- Candidate image startup: PASS
- Real OpenAI calls: NO
- Real WhatsApp outbound: NO
- Production deployment: NO
