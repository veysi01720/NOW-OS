# NOW-OS AI Quality Strategy for Claude

Date: 2026-07-21

Purpose: Give Claude a clear strategic picture of why the bot still feels weak in intelligence, decision quality, language, and factual reliability despite Packages 1-13, and propose the next practical roadmap.

Security note: this document contains no secrets, phone numbers, WhatsApp JIDs, tokens, raw user messages, or `.env` values.

## 1. Executive Summary

The project has made major progress in infrastructure, safety, deploy discipline, model migration readiness, and live WhatsApp recovery. However, the user-facing bot still does not feel intelligent enough because most work so far hardened the system around the model rather than improving the model-facing knowledge, dialogue policy, and real conversation quality.

In short:

- Packages 1-13 built the runway.
- They did not fully upgrade the pilot.
- The bot now has a safer and more observable execution path, but the actual product experience still needs a dedicated quality phase.

The recommended next strategic move is to pause broad canary expansion and run a focused "real conversation quality" package:

1. Collect 10-30 bad live conversations.
2. Label why each failed.
3. Convert them into golden tests.
4. Strengthen Now Akademi policy/knowledge facts.
5. Improve deterministic state decisions and V2/V3 prompts.
6. Then resume Package 13 canary from a stronger baseline.

## 2. Current Project Position

Current committed HEAD:

- `71e775f fix: use provider message ids for evolution dedupe`

Important local state:

- A latency fix exists locally but is not committed/deployed yet.
- That fix adds a deterministic fast-path for simple work-model acceptance replies and stable V2 thread reuse.
- Full local suite after that latency fix: 84/84 files, 570/570 tests PASS.

Production state after P0 fix:

- Candidate private messages now reach backend.
- Assistant run starts.
- WhatsApp send succeeds.
- User confirmed bot reply arrived.
- Baseline production response path is alive again.

Canary state:

- Package 12 is eligible for canary.
- Package 13 safety/arming mechanisms exist.
- Owner approval is not currently active.
- Responses/V3 is not yet broadly serving live traffic.

## 3. Why The Bot Still Feels Weak

### 3.1 Most packages built safety rails, not intelligence

The work so far focused on:

- canonical repo and handover discipline
- build provenance
- runtime identity lock
- model adapter abstraction
- Responses shadow/replay harness
- strict schema and semantic validation
- canary scope control
- owner approval
- automatic stop
- safe fallback behavior
- message normalization and dedupe correctness

These are necessary, but they mostly answer:

- Can we deploy safely?
- Can we prove what code is running?
- Can we stop unsafe canary behavior?
- Can we avoid silent fallback?
- Can we verify deterministic test results?

They do not by themselves answer:

- Does the bot know enough about Now Akademi?
- Does it understand the current candidate stage?
- Does it answer naturally?
- Does it ask the right next question?
- Does it avoid generic or wrong replies in live language?

### 3.2 The live path is still mainly Assistants/V2

The migration target is Responses/V3, but live candidate traffic is still mostly using the old Assistant-backed V2 decision path.

That means a lot of the architecture is ready, but the better-controlled model path has not yet accumulated enough real live observations.

### 3.3 The knowledge layer is thin

The bot's factual reliability depends on canonical policy facts and knowledge available to the decision engine. If those facts are incomplete, the model either:

- gives generic answers,
- refuses/escalates too often,
- guesses,
- repeats shallow onboarding text,
- or misses the operator's actual business intent.

The bot may be technically safer while still feeling unhelpful.

### 3.4 The state machine is operational but coarse

The current state machine can capture core fields and enforce some next-step gates, but it is still not rich enough to handle many real-world conversational situations:

- user asks vague questions,
- user resists work model,
- user asks payment/trust questions,
- user mixes app/platform names,
- user asks about account/profile/camera,
- user sends fragmented messages,
- user repeats old questions,
- user asks in colloquial Turkish,
- user needs reassurance but not unsupported claims.

### 3.5 Too much is still model-decided

Some replies should not require a model call. If the state and policy make the next response obvious, deterministic code should answer quickly and safely.

Example found live:

- Candidate was already in `WORK_MODEL_ACCEPTANCE`.
- Bot only needed to explain the safe work model and ask if it is suitable.
- Instead, the path waited for a model call.
- Measured latency: about 10.7 seconds total, with about 8.8 seconds in model execution.

### 3.6 Not enough live failure examples are encoded as tests

The test suite is strong structurally, but the product quality problem now needs real examples:

- bad answers,
- wrong assumptions,
- unnatural tone,
- repeated questions,
- missing direct answers,
- ungrounded information,
- escalation when not needed,
- failure to handle Turkish variants.

Without those examples as golden tests, quality improvements will be guesswork.

## 4. What Has Actually Improved So Far

The work done so far is not wasted. It changed the system from fragile to controllable.

### 4.1 Source and handover reliability

- Canonical GitHub repo exists.
- Zip/hash confusion is resolved.
- Future handover can use git pull/push.
- `docs/architecture/now-os-kapsamli-durum-ve-plan.md` captures state and backlog for future sessions.

### 4.2 VPS deploy safety

- New git source folder exists on VPS.
- Existing `.env`, `data`, and `backups` were preserved.
- Docker build context is controlled.
- Only target service is recreated during backend deploy.

### 4.3 Provenance and runtime proof

- Docker image labels are matched to source manifest hashes.
- Build fails closed if provenance build args are unknown.
- We can distinguish a fresh image from an old cached image.

### 4.4 Owner-controlled canary

- Owner approval endpoint exists.
- Dashboard owner token is required.
- Approval is time-limited.
- Canary observation window is capped.
- Automatic stop exists for unsafe counts.

### 4.5 Responses/V3 readiness

- Adapter layer exists.
- Responses adapter exists.
- Strict schema and semantic validator exist.
- Missing policy normalizer exists.
- Package 12 final qualification reached `ELIGIBLE_FOR_CANARY`.

### 4.6 Live WhatsApp recovery

- Evolution DB auth issue was fixed.
- Instance returned to `open`.
- Backend receives inbound again.
- P0 message id/dedupe bug was fixed and deployed.
- Candidate private message now gets a bot reply.

### 4.7 Latency root cause identified

- Latency was measured and split by phase.
- Main delay was model execution, not webhook normalization.
- A local latency fix is ready but not deployed.

## 5. Proposed Strategic Roadmap

### Phase A: Finish baseline reliability and speed

Goal: normal candidate messages should work and be fast before canary expansion.

Tasks:

1. Review local latency fix with Claude.
2. Commit and deploy it only if review passes.
3. Validate live fast-path:
   - `CONVERSATION_DECISION_V2_FAST_PATH_SELECTED`
   - no `ASSISTANT_RUN_STARTED` for same correlation id
   - `model_call_count=0`
   - `WHATSAPP_SEND_SUCCESS`
   - expected latency around 1-2 seconds for the simple case

Decision gate:

- Do not proceed to canary until baseline candidate reply is both alive and acceptably fast.

### Phase B: Build a real conversation failure corpus

Goal: turn subjective "bot is bad" into testable failure categories.

Collect 10-30 real bad interactions, sanitized.

Each sample should be labeled:

- wrong factual claim
- unsupported promise
- missed direct question
- asked already-known info
- wrong next step
- bad tone
- too generic
- too slow
- failed state transition
- should have escalated
- escalated unnecessarily
- payment/trust handling bad
- account/profile/camera handling bad
- unknown app handling bad

Output:

- `outputs/quality/live_conversation_failures_sanitized.md`
- `src/tests/fixtures/live-quality-regressions.json`

### Phase C: Convert failures into golden tests

Goal: every serious live failure becomes a regression test.

Add tests for:

- candidate first contact
- work model acceptance
- ask how work is done
- ask job definition
- payment/trust questions
- camera/account/profile questions
- unknown app / missing app
- fragmented messages
- repeated greeting
- stale state recovery

Expected benefit:

- Future prompt/policy changes can be made confidently.
- Quality stops being subjective only.

### Phase D: Strengthen policy facts and deterministic decisions

Goal: stop making the model invent or infer core business policy.

Add or improve canonical facts around:

- what the work actually is
- approved apps
- what is known vs unknown about payment
- camera/video boundaries
- account/profile boundaries
- setup gating
- what the team will clarify
- what the bot is allowed to say before work model acceptance
- what requires owner/manager escalation

Add deterministic replies for narrow safe cases:

- ask missing age/gender/daily_hours
- work model acceptance nudge
- direct "what is the work?" answer when policy facts are sufficient
- "payment details are not verified here" boundary
- "account/profile rule not confirmed" boundary

### Phase E: Re-run Package 13 canary

Only after baseline quality is better:

1. Fresh owner approval.
2. Canary only candidate/private/first-contact.
3. Observe 20 terminal events.
4. Require:
   - unsafe=0
   - validator rejects acceptable/understood
   - no silent fallback
   - no owner/manager/payment bleed
   - no unexpected latency regression

### Phase F: Package 14 unknown app / missing info

After Package 13:

- Focus on `unknown_app_missing_info`.
- Build narrow scenario tests.
- Add policy or deterministic fallback.
- Keep separate approval and canary scope.

### Phase G: Observability package

Add structured latency metrics:

- webhook received to normalized
- normalized to state machine done
- state machine to route selected
- model start to model result
- model result to send start
- send start to send confirmed
- total request duration

This will stop future latency discussions from being guesswork.

## 6. Recommended Priority Order

1. Claude review of local latency fix.
2. Commit/deploy latency fix if approved.
3. Live latency validation.
4. Build live failure corpus.
5. Convert failures into golden tests.
6. Improve policy facts and deterministic safe replies.
7. Resume Package 13 canary.
8. Package 14 unknown app missing info.
9. Broader intelligence/learning layer.
10. Modern dashboard and SaaS generalization.

## 7. Risks If We Skip The Quality Phase

If we go straight to canary or Package 14 without quality work:

- bot may become technically safer but still unhelpful,
- Responses canary may measure only safety, not usefulness,
- real users may continue receiving shallow/generic answers,
- wrong policy gaps may be hidden by safe fallback,
- we may keep improving infrastructure while product value remains low.

## 8. Questions For Claude

Please answer these as decision guidance, not just commentary.

1. Should we deploy the latency fast-path before continuing Package 13 canary?
2. Is the current fast-path condition safe enough, or should it be narrower?
3. Should deterministic onboarding replies mention the approved app name, or stay generic until app selection is explicit?
4. What are the top 10 real conversation failure categories we should encode as golden tests first?
5. Should Package 13 canary be delayed until the failure corpus exists?
6. Should we prioritize improving V2 live quality first, or push Responses/V3 canary first?
7. Which replies should be deterministic and which should remain model-generated?
8. What minimum live quality gate should be required before broader traffic?
9. Is the current architecture too safety-heavy for a sales/onboarding bot, and where should it be loosened without allowing unsupported claims?
10. What is the smallest next package that will make the bot feel genuinely better to the user?

## 9. My Recommendation

My recommendation is:

- Do not treat Package 13 canary as the next product milestone.
- Treat it as a migration safety milestone.
- The next product milestone should be "Quality Pack 1: Real Candidate Conversation Quality".

Concrete path:

1. Finish and deploy latency fix.
2. Collect 10-30 sanitized bad live examples.
3. Build golden tests.
4. Patch policy facts and deterministic replies.
5. Then reopen owner approval and canary.

This keeps the migration safe while finally focusing on the thing the user actually feels: whether the bot answers correctly, naturally, and quickly.

