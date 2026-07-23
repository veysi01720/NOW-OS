# NOW-OS Session Report for Claude

Scope: 2026-07-21 19:12 Europe/Istanbul onward.

Audience: Claude / next reviewer.

Security note: this package intentionally excludes `.env`, tokens, phone numbers, WhatsApp JIDs, message text, and raw secrets. All production observations below are summarized.

## 1. Starting Context

- Repository: `C:\Users\Hp\NOW-OS`
- Branch: `master`
- Remote: `https://github.com/veysi01720/NOW-OS.git`
- Canonical production source: VPS `now_os_backend`
- Pre-existing latest committed docs handover before P0 deploy: `a0303b8`
- P0 production issue under investigation: candidate/private WhatsApp messages were reaching backend but were not starting assistant runs because Evolution payload normalization/dedupe was collapsing messages through JID-like ids.

## 2. Production P0 Fix Completed

Commit created and pushed:

- Commit: `71e775f fix: use provider message ids for evolution dedupe`
- Remote master verified as: `71e775fca4307aefc819015fd4c3ab827383f8b8`

Files changed in that committed fix:

- `src/bridge/normalizeEvolutionMessage.ts`
  - `message_id` now accepts only provider `data.key.id`.
  - JID-like values such as `@s.whatsapp.net`, `@g.us`, `@lid`, and `@broadcast` are rejected as message IDs.
- `src/bridge/evolutionWebhook.ts`
  - Non-message Evolution events are ignored before message normalization.
  - Message payloads without a valid provider message id are ignored before dedupe and assistant execution.
- `src/tests/normalizeEvolutionMessage.test.ts`
- `src/tests/evolutionWebhook.test.ts`

Verification before deploy:

- Focused tests: 2/2 files PASS, 18/18 tests PASS
- Build: PASS
- Full suite: 84/84 files PASS, 568/568 tests PASS

## 3. VPS Deploy Completed

VPS source update:

- Source pulled from `510e0d8` to `71e775f`.

Build/provenance/deploy gates:

- Temporary build/test container used: `node:20-alpine`, matching Dockerfile base.
- `npm ci`: PASS
- `npm run build`: PASS
- `npm test`: PASS, 84/84 files, 568/568 tests
- `npm run provenance:generate`: PASS
- `npm run provenance:verify`: PASS
- Docker build with `--no-cache`: PASS
- Image labels matched manifest values:
  - `now_os.build_timestamp`: PASS
  - `now_os.source_tree_hash`: PASS
  - `now_os.package_lock_hash`: PASS
  - `now_os.dist_tree_hash`: PASS
  - `now_os.workspace_identity_hash`: PASS
  - `now_os.provenance_manifest_hash`: PASS
  - `now_os.test_result_reference`: PASS
- Recreated only `now_os_backend`: PASS
- Did not recreate Evolution or DB during this backend deploy.
- Health checks:
  - `/healthz`: 200
  - `/readyz`: 200
- Evolution instance state after read-only check: `open`

## 4. Live WhatsApp Verification

After user sent a private WhatsApp message to the bot:

- Backend confirmed inbound private message.
- Sender role resolved as `candidate`.
- Candidate state at time of test: `WORK_MODEL_ACCEPTANCE`.
- Model route: `conversation_decision_v2`.
- Assistant run started.
- Bot reply was sent and user confirmed it arrived.

Observed timeline, sanitized:

- `INBOUND_CONFIRMED`: `2026-07-21T16:37:13.529Z`
- `MESSAGE_NORMALIZED`: private, `is_from_me=false`
- `STATE_MACHINE_EVALUATED`: sender_role `candidate`, state `WORK_MODEL_ACCEPTANCE`
- `CONVERSATION_MODEL_ROUTE_SELECTED`: `conversation_decision_v2`
- `ASSISTANT_RUN_STARTED`: `2026-07-21T16:37:13.626Z`
- `CONVERSATION_DECISION_V2_TRACE`: intent `candidate_first_contact`
- `SEND_CONFIRMED`: `2026-07-21T16:37:24.227Z`
- `WHATSAPP_SEND_SUCCESS`: `2026-07-21T16:37:24.227Z`

Connection doctor after send:

- `recent_inbound_observation=true`
- `recent_send_observation=true`
- `live_cutover_ready=true`
- `reason_codes=[]`

Conclusion: P0 candidate response outage was resolved.

## 5. Latency Root Cause Found

The received reply was correct but slow. A read-only latency split showed:

- Normalize to model start: 97 ms
- Model execution: 8827 ms
- Evolution send: 1774 ms
- Total: 10698 ms

Primary root cause:

- The V2 candidate path sends even simple deterministic onboarding replies through OpenAI Assistant runs.
- In the tested state (`WORK_MODEL_ACCEPTANCE`), the bot only needed to repeat/explain the safe work model and ask explicit acceptance.
- That reply can be generated deterministically from canonical policy facts without a model call.

Secondary inefficiency found:

- `ConversationDecisionEngine.ts` passed `context.request_id` as `conversationId` to `ModelExecutionService`.
- Because `request_id` is the per-message correlation id, `AssistantAdapter` creates a new OpenAI thread for each message instead of reusing the stable WhatsApp conversation thread.
- This adds unnecessary thread creation overhead and loses model-thread continuity.

## 6. Local Latency Fix Implemented But Not Committed/Deployed

Important: these changes are currently local only. They have not been committed, pushed, provenanced, or deployed.

Changed files:

- `src/intelligence/conversation/ConversationDecisionEngine.ts`
- `src/intelligence/conversation/ConversationDecisionSchema.ts`
- `src/bridge/handleIncomingMessage.ts`
- `src/tests/conversationDecisionV2.test.ts`

Implemented behavior:

1. Deterministic fast-path for work-model acceptance nudges.
   - Applies only when all of these are true:
     - role is `candidate`
     - channel is `private`
     - dialogue phase is `WORK_MODEL_ACCEPTANCE`
     - age/gender/daily_hours are already captured
     - work model acceptance is not yet `accepted`
     - allowed actions include `request_work_model_acceptance`
     - canonical policy facts include:
       - `male_candidate_work_model`
       - `work_model_acceptance_required`
       - `candidate_work_steps_chat_based`
     - inferred intent is `candidate_first_contact` or `greeting_or_first_contact`
     - latest message does not look like a direct question about how/what/account/camera/payment/etc.
   - Emits `CONVERSATION_DECISION_V2_FAST_PATH_SELECTED`.
   - Produces `final_reply_origin=deterministic_work_model_acceptance_fast_path`.
   - `model_call_count=0`.
   - Does not log `ASSISTANT_RUN_STARTED` because no model call occurs.

2. Stable V2 conversation id.
   - `handleIncomingMessage.ts` now passes `conversationKey` into `executeConversationDecisionV2`.
   - `ConversationDecisionEngine.ts` passes that stable id to `ModelExecutionService`.
   - This lets `AssistantAdapter` reuse the same OpenAI thread for actual model calls in the same conversation.

3. V2 model logging corrected.
   - `ASSISTANT_RUN_STARTED` moved from the caller to inside the actual model-call branch.
   - This avoids misleading logs when deterministic fast-path skips the model.

Local verification:

- Focused V2/adapter tests: 3/3 files PASS, 21/21 tests PASS
- Build: PASS
- Full suite: 84/84 files PASS, 570/570 tests PASS
- Provenance currently says source mismatch, expected because local source changed and provenance has not been regenerated.

Expected production effect after deploy:

- For the tested onboarding case, expected latency should drop from about 10.7 seconds to roughly Evolution send time, likely around 1-2 seconds.
- Direct questions still go through the model path.
- Complex/semantic candidate messages still go through the model path.

## 7. Current Git State

Current committed HEAD:

- `71e775f fix: use provider message ids for evolution dedupe`

Uncommitted local changes:

- `src/bridge/handleIncomingMessage.ts`
- `src/intelligence/conversation/ConversationDecisionEngine.ts`
- `src/intelligence/conversation/ConversationDecisionSchema.ts`
- `src/tests/conversationDecisionV2.test.ts`

No latency fix commit has been created yet.

## 8. Recommended Next Steps

Recommendation A: Review and commit the local latency fix.

- Suggested commit message: `perf: fast path work model acceptance replies`
- Rationale: the fix is scoped, test-covered, and directly addresses the measured delay.
- Risk control: fast-path is deliberately narrow and does not answer direct policy/payment/account/setup questions.

Recommendation B: Deploy the latency fix only through the existing gated path.

Use the same discipline as the P0 deploy:

- push commit
- VPS pull
- temporary `node:20-alpine` `npm ci/build/test`
- provenance generate/verify
- Docker build with all provenance build args
- image label/manifest comparison
- recreate only `now_os_backend`
- `/healthz` and `/readyz` 200
- do not touch Evolution or DB

Recommendation C: Live validation after latency deploy.

Send one private candidate message that matches the fast-path scenario.

Expected logs:

- `MESSAGE_NORMALIZED`, private
- `CONVERSATION_DECISION_V2_FAST_PATH_SELECTED`
- no `ASSISTANT_RUN_STARTED` for that correlation id
- `CONVERSATION_DECISION_V2_TRACE` with `model_call_count=0`
- `WHATSAPP_SEND_SUCCESS`
- `SEND_CONFIRMED`

Expected user-facing result:

- reply arrives much faster than previous 10.7s baseline.

Recommendation D: Add explicit latency telemetry in a later small package.

Add structured durations for:

- webhook received to normalized
- normalized to state machine done
- model start to model result
- model result to send start
- send start to send confirmed
- total request duration

This should be a separate observability patch after the immediate latency fix.

Recommendation E: Canary work should remain paused until baseline latency fix is deployed and verified.

Owner approval was not touched during the latency work. Existing approval is expired/invalid. After baseline flow is fast and stable, resume Package 13 canary with a fresh approval window.

Recommendation F: Ask Claude specifically to review these points.

1. Is the fast-path condition too broad or too narrow?
2. Should the deterministic reply include the approved app name or stay generic as currently implemented?
3. Does stable `conversationId=conversationKey` create any thread-mixing risk for private/group transitions?
4. Should `ASSISTANT_RUN_STARTED` remain only in the true model-call branch?
5. Should the direct-question regex include additional Turkish variants before deploy?

## 9. Files Included In This Zip

- `NOW_OS_SESSION_REPORT_2026-07-21_1912_TO_NOW.md`
  - This human-readable report.
- `NOW_OS_LATENCY_FIX_UNCOMMITTED.patch`
  - Exact uncommitted local diff for Claude review.
- `NOW_OS_GIT_STATUS.txt`
  - Git status, recent commits, and diff stat at package creation time.

