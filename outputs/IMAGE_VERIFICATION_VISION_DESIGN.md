# Image Verification B: Vision/OCR Integration Design

## Status

Design only. This document does not add code, enable a flag, call a provider,
change the production runtime, or activate image processing.

## Decision Summary

Use OpenAI vision through the existing Responses API integration as the first
provider. Do not add a separate OCR service in this phase. The existing
installation-verification boundary remains authoritative: private candidate
messages only, installation-verification state only, maximum 2 MB, one-hour
local processing TTL, no raw image in durable state or logs, and fail-closed
on every uncertainty or provider failure.

The vision call is a separate bounded classification call, not an extension
of the normal conversation-generation call. This keeps image handling out of
the ordinary assistant context and makes the state transition depend on a
small, auditable result.

## 1. Provider Choice

### Preferred: OpenAI vision via Responses API

The current system already owns the OpenAI credential, provider adapter,
deadline handling, structured decision validation, and provider diagnostics.
Responses accepts image inputs, including a base64 data URL or image URL, so
the verifier can use the existing API boundary without introducing another
credential, network egress rule, vendor SDK, or retention contract. The
official quickstart documents image analysis through `responses.create` with
an `input_image` item. [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart)

The configured model must be checked at startup/qualification time for image
input support. A model that cannot accept image input is a configuration
failure, not a reason to fall back to text-only guessing.

### Not selected initially: separate OCR service

A separate OCR provider would add credentials, data-processing terms, another
failure mode, another latency budget, and an additional source of semantic
disagreement. It can be reconsidered if later evidence shows that the
bounded verification task needs deterministic OCR accuracy that the selected
OpenAI model cannot meet.

## 2. Call, Cost, and Latency Boundary

Every accepted image costs one additional provider request. The request must
be deliberately small:

- Input: the image plus a short verification instruction and only the
  installation-state facts needed for the check.
- Output: a strict result such as `clear` or `ambiguous`, a bounded reason
  code, and optional sanitized dimensions/status metadata.
- Completion cap: a small verifier-specific cap, recommended 128-256 output
  tokens, rather than the normal 2,000-token conversation completion limit.
- Context: no full conversation transcript, no broad knowledge bank, and no
  owner/candidate message history unless a minimal state flag is required.

The existing 18,000-token conversation context budget remains unchanged. The
vision request is not allowed to consume that budget or to trigger a second
full conversation response. After a `clear` result, the backend performs the
existing deterministic transition to `TRAINING_READY` and sends the existing
single confirmation. After `ambiguous` or any error, it creates the existing
installation-verification handoff and sends one safe response. There is no
automatic second vision retry in the first version; a bounded, classified
retry may be considered later only for transport failures and only within the
same event budget.

## 3. Integration With the Bounded Installation Path

The current bounded path is the integration point:

1. Confirm private chat, candidate role, and installation-verification state.
2. Reject unsupported media and payloads over 2 MB before provider work.
3. Decode the base64 payload into one ephemeral memory buffer.
4. Compute the media hash, byte size, and media type.
5. Call the vision classifier while the buffer is still in memory.
6. Retain only the sanitized classification result and metadata.
7. Explicitly release references to the buffer and never place it in state,
   queue payloads, audit logs, or error messages.
8. For `clear`, apply the existing transition to `TRAINING_READY`.
9. For `ambiguous`, missing, oversized, unsupported, timed-out, or failed
   classification, keep the state unchanged and record
   `installation_verification_ambiguous` human handoff.

The existing `stripMediaBase64` default remains unchanged for every other
message. The installation exception must remain explicit and must not be
usable by ordinary conversation, group messages, owner commands, or model
context construction.

The classifier result is not authoritative by itself. The backend validates
the result against a narrow allowlist, verifies that the request was in the
correct state, and owns the transition. The model cannot directly set
`TRAINING_READY`.

## 4. Verification Contract

The provider-facing output should be normalized into a backend-owned result:

```text
status: clear | ambiguous
reason_code: INSTALLATION_SCREEN_CONFIRMED | INSTALLATION_SCREEN_UNCLEAR |
             UNSUPPORTED_MEDIA | PROVIDER_FAILURE | PROVIDER_TIMEOUT |
             INVALID_PROVIDER_RESULT
confidence: optional numeric value, never sufficient by itself to authorize
             a transition
```

Only `status=clear` with an allowlisted reason and a valid backend context may
advance the state. A high confidence value without the required visual
evidence is still rejected. Raw OCR text is not persisted and is not emitted
to logs. If a human needs more detail, the dashboard receives sanitized
metadata and the handoff reason, not the image contents.

## 5. Privacy and Retention

### Local runtime

The local one-hour TTL is a processing guard, not a promise about provider
retention. No durable image file should be created in the normal path. If an
SDK or transport requires a temporary file, it must be in a private runtime
directory with restrictive permissions, be deleted in a `finally` path, and
have a cleanup watchdog. Persist only:

- truncated media SHA-256;
- byte size and MIME type;
- correlation reference;
- sanitized result/reason code;
- expiry and processing timing metadata.

Never persist base64, raw bytes, OCR text, filenames containing PII, phone
numbers, JIDs, or screenshots.

### OpenAI retention boundary

OpenAI states that API data is not used to train models unless the customer
opts in. By default, abuse-monitoring logs may contain customer content and
are retained for up to 30 days. The `/v1/responses` endpoint has application
state retention behavior when stored responses are used; the design must set
`store=false` and must not use background mode or conversation/file objects
for this verifier. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint)

This does **not** make provider-side retention zero. Image/file inputs can be
retained for manual review if automated safety scanning detects potential
CSAM, even when enhanced retention controls are enabled. OpenAI also states
that Zero Data Retention and Modified Abuse Monitoring require eligibility and
prior approval, and image/file inputs have limitations. Therefore:

- local one-hour deletion and OpenAI retention are separate controls;
- there is no direct contradiction, but local deletion cannot shorten
  provider-side retention;
- the owner must confirm the project's data-control posture before live
  candidate images are sent;
- until that posture is accepted, the feature remains disabled or limited to
  synthetic, non-personal fixtures.

No claim of zero provider retention may appear in product or operator copy.

## 6. Failure and Safety Policy

Vision failures are fail-closed:

- timeout, network failure, 401/403, rate limit, 5xx, malformed JSON, schema
  failure, unsupported model, or ambiguous output: no state transition;
- no automatic claim that installation was verified;
- one `installation_verification_ambiguous` handoff record, idempotent per
  inbound event;
- one safe candidate reply at most;
- sanitized diagnostic event with provider class/status only;
- no raw provider body, image, OCR text, phone, JID, or secret in logs.

The existing provider timeout/deadline and retry discipline applies. The
verifier must have its own shorter deadline within the inbound processing
budget so a visual message cannot recreate the historical multi-minute
provider stall. A retry, if later enabled, must be classified and bounded;
retry exhaustion remains ambiguous.

## 7. Activation Plan

The feature is not direct-live. Proposed controls:

```text
INSTALLATION_VISION_ENABLED=false
INSTALLATION_VISION_CANARY_MODE=off
INSTALLATION_VISION_CANARY_PERCENT=0
```

Activation sequence:

1. Unit and contract tests with synthetic images only; real outbound = 0.
2. Provider-spy acceptance proving one verifier call, no raw-media logging,
   hash/size/type metadata only, and correct fail-closed behavior.
3. Shadow classification on synthetic or explicitly approved internal
   fixtures; it must not advance state or send an outbound message.
4. Owner approval for live activation and data-retention posture.
5. A tiny internal canary, recommended 1% or at most 3 approved test
   candidates, with a fixed observation window.
6. Automatic stop on any raw-media leak, unsupported claim, state transition
   without `clear`, duplicate outbound, missing handoff, provider error-rate
   threshold, or any privacy-policy violation.
7. Expand only after the canary report passes. Rollback is flag-off plus
   approval invalidation; no Evolution, database, queue, or session reset.

The first live canary must exclude normal users, groups, owner/manager
commands, payment decisions, and all non-installation media.

## 8. Acceptance Criteria Before Any Live Activation

- [ ] Configured Responses model accepts image input.
- [ ] `store=false` is sent and no background/conversation/file object is used.
- [ ] 2 MB, MIME, private-state, and one-image-at-a-time gates pass.
- [ ] Clear synthetic fixture advances to `TRAINING_READY` exactly once.
- [ ] Ambiguous synthetic fixture does not advance and creates one handoff.
- [ ] Timeout, 401/403, 429, 5xx, malformed JSON, and schema failures are
      classified and fail closed.
- [ ] Raw bytes/base64/OCR text are absent from logs, queue payloads, state,
      and durable files.
- [ ] Provider-spy count is exactly one for each accepted event; real WhatsApp
      outbound count is zero in acceptance.
- [ ] Replay proves the normal conversation route is not invoked for the
      verifier result.
- [ ] Feature flags are off by default and rollback is tested.
- [ ] Owner approval and data-retention posture are recorded before live use.

## Decision

OpenAI vision through the existing Responses API is the recommended first
implementation, but only as a bounded installation classifier. It must remain
separate from ordinary conversation generation, backend-authorized for state
changes, privacy-minimal locally, explicit about provider retention, and
fail-closed on uncertainty.
