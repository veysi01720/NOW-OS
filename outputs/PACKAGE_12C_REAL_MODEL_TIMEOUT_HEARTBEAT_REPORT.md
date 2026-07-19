# Package 12C Real Model Timeout / Heartbeat Report

Date: 2026-07-18

## Scope

Synthetic qualification had already passed: baseline 13/13, targeted 3/3,
expanded 10/10 across three runs. This report covers the real-model
qualification timing and provider classification only.

## Timeout Diagnosis

- The original 8+ minute run was manually stopped.
- No system `PROVIDER_TIMEOUT` classification was emitted in that run.
- Direct qualification bypassed the model execution service deadline path.
- A 45-second adapter-level request deadline and abort signal were added.
- Timeout errors are classified as `APIConnectionTimeoutError` for the existing
  provider classification layer.

## Heartbeat Evidence

The qualification runner emitted sanitized scenario progress lines every ten
seconds. No message text, phone number, JID, credential, or raw model output
was logged.

Observed pattern:

```text
[1/69] p6_greeting - 0s elapsed (start, attempt=1)
[1/69] p6_greeting - 10s elapsed (heartbeat, attempt=1)
[1/69] p6_greeting - 16s elapsed (complete, attempt=1) classification=PROVIDER_UNKNOWN_ERROR
[2/69] p6_first_contact - 16s elapsed (start, attempt=1)
...
[23/69] p12_manager_role_boundary - 376s elapsed (complete, attempt=1) classification=PROVIDER_UNKNOWN_ERROR
...
[69/69] p12_manager_role_boundary - 1128s elapsed (complete, attempt=1) classification=PROVIDER_UNKNOWN_ERROR
```

Conclusion: the runner progressed through all 69 calls. It did not hang on a
single scenario. Total elapsed time was approximately 18 minutes 48 seconds.

## Real Qualification Result

- Completed calls: 69/69
- Runs: 3
- Calls per run: 23
- Baseline: 0/13 in each run
- Targeted: 0/3 in each run
- Expanded: 0/10 in each run
- Unsafe claims: 0
- Provider failures: 23 per run
- Retry recovery: 0
- Timeout classifications: 0
- Final classification: `PROVIDER_UNKNOWN_ERROR`
- Real WhatsApp outbound: 0
- Canary: not armed

The provider returned no usable decision for any scenario. Therefore this run
is not a model-quality qualification pass and must not authorize canary use.

## Network Check

A sanitized unauthenticated request from the VPS to the OpenAI endpoint returned
quickly:

- DNS lookup: approximately 4 ms
- TCP connect: approximately 7 ms
- TLS: approximately 30 ms
- Total HTTP response: approximately 205 ms
- HTTP status: 401, expected without authorization

This did not establish a VPS DNS/proxy failure. The authenticated Responses
request path remains unresolved and was classified as provider unknown by the
harness.

## Verification

- Local build: PASS
- Local full suite: 84 test files, 562 tests passed
- Focused adapter/replay tests: PASS
- Production backend changed: NO
- Evolution changed: NO
- WhatsApp outbound: 0
- Secrets printed: NO
- Raw phone/JID/text logged: NO

## Changed Files

- `src/modelAdapter/ResponsesAdapter.ts`
- `src/modelAdapter/responsesGoldenReplay.ts`
- `scripts/responsesQualificationSuite.ts`
- `src/tests/modelAdapter/responsesAdapter.contract.test.ts`

## Decision

`REAL_MODEL_QUALIFICATION: NOT_ELIGIBLE`

The timeout safety mechanism and progress observability are verified. The
remaining blocker is provider/SDK error classification and the absence of a
usable model decision, not a scenario hang.

`CANARY_ARMED: NO`
`DEPLOY: NO`
