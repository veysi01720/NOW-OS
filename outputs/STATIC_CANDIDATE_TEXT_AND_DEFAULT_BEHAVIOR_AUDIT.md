# Static Candidate Text and Default Behavior Audit

Date: 2026-08-15
Scope: production `src/` only; tests, docs, owner-only dashboard text, logs, and model prompt instructions are separated from candidate-facing output.
Status: audit only. No behavior or text was changed.

## Executive summary

The scan found three high-priority review candidates:

1. `ConversationDecisionRepair.ts:225-227` has a camera/profile fallback saying that the male account/profile requirement is not verified. The active knowledge bank now explicitly says the male profile rule applies. This is a direct contradiction and can send the candidate the wrong policy.
2. `ConversationDecisionRepair.ts:206-208` says verified payment/earnings detail is unavailable. The active knowledge bank contains the 1-3 business-day, weekend, IBAN-correction, and non-cancellable-withdrawal rules. This fallback can suppress valid information when the deterministic path is selected.
3. App selection has duplicated hardcoded defaults: `Layla`/`allowedApps[0]` in the resolver, a five-app fallback list in the repair layer that omits `TanChat`, and a separate secondary-app array. This can produce incomplete or stale options when structured facts are available.

The remaining fixed candidate texts are mostly safety, workflow, or transport fallbacks. They do not claim business facts, but several are not represented in `app_facts.md`; they should be treated as owner-reviewable behavior copy rather than silently assumed to be policy.

## Source and comparison notes

- The canonical human-readable source inspected was `data/knowledge_bank/app_facts.md`.
- `data/knowledge_bank/app_facts_structured.json` is a generated/runtime artifact and is not present in this source checkout. The structured loader/publisher code was inspected separately. Runtime publication must remain the comparison point for generated facts.
- The knowledge bank contains sections for general work model, setup, routing, application independence, profile/bio/photo, memory, eligibility, installation permission, installation evidence, privacy/payment/support, follow-up/group rules, and six approved apps.
- Git blame was used for suspicious literals. Many original deterministic safety texts trace to `28f4935` (2026-07-17); the payment/camera wording was tightened in `6e2a064` (2026-08-10), the general-work-model path in `04f7ded`/`0e6e225`, the off-topic response in `fbf7a13` (2026-08-14), and the app/default routing code originates mainly in `28f4935`.

## A. Candidate-facing fixed texts

### A1. Job-definition fallback

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:139-195`.

Variants:

- If `general_work_model.summary` exists, it is used as the main answer.
- Otherwise: the candidate is told that the work is answering incoming chats/messages in writing inside an approved app, that camera/video is not stated as mandatory, and either missing intake fields or work-model acceptance is requested.
- If earnings/payment is asked on this path, the fallback adds: “verified earnings/payment detail is unavailable; I can only explain the approved messaging process.”

Knowledge-bank comparison: the work-model summary, workflow, camera boundary, and acceptance gate exist. The fallback’s exact wording is not stored as a fact.

Risk: medium. The fallback is intentionally safety-oriented, but the no-summary branch can become stale and the appended camera boundary can dominate a general job-definition answer. Owner review: keep as an emergency fallback, but make factual claims come from the published section only.

### A2. Payment/earnings boundary

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:206-222`.

Fixed text: “Verified earnings or payment detail is unavailable; I can only explain the approved app messaging process.”

Knowledge-bank comparison: conflict. `app_facts.md` contains payment timing (1-3 business days, weekends excluded), IBAN correction, and non-cancellable withdrawal rules. It also says exact minimums/deductions are checked in the app.

Risk: high. A candidate asking a payment question may receive an unnecessarily empty answer even though approved payment facts exist. This is a stale fallback candidate, not a reason to weaken the no-guarantee rule. Owner decision needed: use the verified payment section when present, retain the no-guarantee sentence for unsupported amounts.

### A3. Camera/account/profile boundary

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:225-241`.

Fixed text: camera/video is not stated as mandatory, and “the male account/profile requirement is not verified; I cannot claim a definite rule.”

Knowledge-bank comparison: direct conflict. `app_facts.md` under “Profil, Bio ve Fotoğraf Kuralları” explicitly states the owner-approved male profile rule. The same source separately states the camera boundary.

Risk: high. This can make the model/candidate see two incompatible policies. The camera sentence is still consistent; the male-profile sentence is stale and should be replaced only after owner approval.

### A4. Off-topic safety response

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:244-258`.

Fixed text: “I do not have information on this; I can help with work or installation questions.”

Knowledge-bank comparison: no exact fact needed; this is a scope response, not business knowledge.

Risk: low. It is intentionally outside the human-handoff path and contains no team promise. Owner review is optional copy review only.

### A5. Partial-intake response

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:262-292`.

Template: “I received [captured fields]. Now could you write [missing fields]?”

Knowledge-bank comparison: no exact text in the knowledge bank. The fields and the requirement to collect age/gender/daily availability are represented by the eligibility and memory sections.

Risk: low to medium. It is procedural, but it can become stale if the intake field set changes. The female-only experience branch is implemented in the state machine, so this template must not be treated as the sole field policy.

### A6. Candidate tone boundary

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:295-315`.

Fixed text: asks the candidate not to speak that way and offers help if they write the work model or problem clearly.

Knowledge-bank comparison: no exact text. The follow-up/closure rules support non-insistent handling, but the exact tone copy is an operational behavior rule.

Risk: low. It does not make a factual earnings, app, or eligibility claim. It can trigger the conversational escalation category only through the general fallback path, not this tone boundary itself.

### A7. Provider/policy/invalid-decision fallback family

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:318-360`.

Fixed variants:

- Provider failure: the answer could not be safely generated; the team should clarify it.
- Missing policy: verified information is missing; the team should clarify it.
- Invalid model decision: the answer could not be safely clarified; the team should check it.
- Repeat-safe alternatives mention that the team was already asked to check the topic or that the system will keep a safe boundary until clarification.

Knowledge-bank comparison: no exact copy. The knowledge bank does support escalation for unresolved installation, ban, and technical problems, but it does not define these generic fallback sentences.

Risk: medium. These are operationally honest only if `recordHumanHandoff()` succeeds. They are intentionally paired with `conversational_escalation_claim`; a missing handoff dependency would make the candidate-facing promise false. This path deserves owner copy review, but it is not a business-fact source.

### A8. Approved-app vocabulary fallback

Location: `src/bridge/approvedAppGuard.ts:3-14` and use in `handleIncomingMessage.ts:1641-1645`.

Fixed text: asks the candidate to clarify which approved app the team told them to use, then offers step-by-step help.

Comparison: no exact knowledge-bank text. It is a safety guard response.

Risk: medium. The wording is safe, but it can hide a model response that mentioned an unapproved app. The app vocabulary itself is a separate duplicated-default finding below.

### A9. Installation verification responses

Locations: `src/bridge/handleIncomingMessage.ts:774`, `:797`, `:817`.

Variants:

- Clear: installation verification was received and training can begin.
- Ambiguous: the installation image could not be clearly verified and was sent for checking.
- Locked ambiguous state: the image is not yet verified; no definite app/setup confirmation can be given; send a clearer setup screen.

Knowledge-bank comparison: the installation process and evidence rules exist; exact response copy does not.

Risk: low for the clear/locked behavior because the state gate is deterministic. Medium for copy because “training can begin” must remain behind the clear verification result and post-install gate.

### A10. Maintenance and transport fallback

Locations: `src/bridge/handleIncomingMessage.ts:582-584`; `src/contracts/assistantResponseContract.ts:3-4`.

Fixed texts:

- Maintenance: a short maintenance is in progress and the team will help shortly.
- Assistant technical fallback: a small technical problem occurred while processing the message and help will follow.

Knowledge-bank comparison: no exact text; these are infrastructure responses.

Risk: low to medium. They do not assert business facts, but the maintenance sentence promises team help and should only be used when maintenance mode is truly enabled.

### A11. Post-install training gate and redirect

Locations: `src/bridge/handleIncomingMessage.ts:601-612`, `:917-923`.

Fixed texts:

- Candidate: installation is complete but training approval is pending.
- Owner: asks whether to begin training.
- Candidate redirect: supplies the owner-provided number.

Knowledge-bank comparison: the training gate and “do not train before Now Ajans/profile/member-ID evidence” rule exist. Exact handoff wording does not.

Risk: low when the training handoff store is the source of truth. The redirect number is runtime input, not a knowledge-bank fact; it must never be logged.

## B. Fixed default behaviors

### B1. App selection defaults and duplicate sources

Locations:

- `src/intelligence/candidate/CandidatePolicyResolver.ts:35-42`: selected app first; otherwise text-only app; otherwise allowed app; otherwise first owner-approved fact.
- `src/intelligence/candidate/CandidatePolicyResolver.ts:163-165`: app fallback to `Layla`, then `allowedApps[0]`.
- `src/intelligence/conversation/ConversationDecisionRepair.ts:110-118`: fallback search list `Layla, Soyo, Amar, Timo, Linky`.
- `src/intelligence/candidate/CandidatePolicyResolver.ts:200-222`: hardcoded routing fact and secondary apps `Timo, Linky, Soyo`.

Knowledge-bank comparison: the routing matrix and six owner-approved app facts exist, including TanChat. The resolver’s fallback list omits TanChat and the fallback list is not derived from structured facts.

Risk: high. Missing/invalid structured data can cause Layla-first behavior or hide TanChat. This is a duplicate-source issue, not an owner-facing wording issue. The resolver should fail closed or derive every fallback vocabulary from validated structured facts.

### B2. Eligibility and intake defaults

Locations: `src/bridge/candidateIntakeStateMachine.ts`; missing-field decisions in `ConversationDecisionRepair.ts:120-136` and `ConversationDecisionEngine.ts:112-119`.

Behavior: collect age, gender, and daily hours; female candidates additionally collect previous platform experience; age eligibility is gender-specific; setup waits for explicit work-model acceptance.

Knowledge-bank comparison: aligned with “Uygunluk ve Red”, “Bellek ve Tekrar Sormama”, and “Kurulum İzni”. The exact question templates are not stored in the bank.

Risk: medium. The rules are security/eligibility behavior and should stay deterministic at the state-machine layer. The text templates are reviewable copy, not policy authority.

### B3. Unknown/missing-information fallback

Locations: `ConversationDecisionRepair.ts:343-360`; `baseDecision()` at `:72-108`.

Behavior: fail closed, choose a repeat-safe response, set escalation, and use `conversational_escalation_claim` for generic model/provider/policy failures.

Comparison: no exact knowledge-bank equivalent; it is a safety mechanism.

Risk: medium. Correct security posture, but candidate-facing “team will check” language must stay coupled to a successfully persisted handoff.

### B4. Channel and role assumptions

Locations: `src/config/roles.ts:31-50`, `src/bridge/handleIncomingMessage.ts`, `src/bridge/ownerCommands.ts:405-407`.

Behavior:

- owner takes precedence if a number appears in both owner and manager lists;
- an unlisted number in a private chat is a candidate;
- owner/manager commands require private chat;
- candidate intake requires private chat and candidate role;
- group prefixless messages are ignored; group commands require authorization.

Knowledge-bank comparison: these are access-control and transport rules, so absence from app facts is expected.

Risk: high if env role lists or chat classification are wrong; low as a fixed design rule. Do not move these into candidate knowledge.

### B5. Approved/unapproved app guard defaults

Location: `src/bridge/approvedAppGuard.ts:6-14`.

Behavior: terms such as TikTok, Instagram, Twitch, YouTube, Sozzy, Chatrace, and NovaChat are treated as unapproved unless present in the allowed vocabulary.

Knowledge-bank comparison: not a business-fact section; it is a safety vocabulary. It is not the same thing as the six approved structured apps.

Risk: medium. A future approved app must be added to structured facts and derived vocabulary; otherwise the guard may block a valid answer. This list should be reviewed whenever app inventory changes.

### B6. Repeat guard defaults

Location: `src/intelligence/conversation/ConversationDecisionRepair.ts:7-8, 39-57`.

Behavior: fallback text shorter than 40 characters is not treated as a repeat; 95% token overlap is considered a repeat; alternate replies are selected when possible.

Knowledge-bank comparison: the memory section says not to ask known information again, but these numeric thresholds are engineering defaults, not policy facts.

Risk: medium. A threshold can create either a repeated reply or an unnecessarily different reply. Owner policy is not contradicted directly, but this deserves product/quality tuning.

### B7. Hardcoded fallback app-name order in safety code

Location: `ConversationDecisionRepair.ts:110-118`.

Behavior: when canonical facts do not yield an app, search a fixed list and use the first matching name.

Knowledge-bank comparison: not synchronized. TanChat is missing; the list order can reintroduce Layla-like bias.

Risk: high; see B1. This is the clearest stale default in the current scan.

### B8. Fixed response limits and contract defaults

Locations: `src/contracts/assistantResponseContract.ts:1-6`, environment/config defaults in `src/config/env.ts:135-187`.

Behavior: response contract `1.0`, reply max 2000 characters, internal note max 1000, port 3000, reconnect delay 5 seconds, reconnect cooldown 30 minutes, model timeout 45 seconds, human reply delay enabled unless explicitly false, workers off unless true, and V2 enabled unless explicitly false.

Knowledge-bank comparison: no business-fact counterpart; these are engineering defaults.

Risk: low for candidate truth, medium operationally. The V2 default is especially worth reviewing because the migration plan says Terra/V3 is the production path; it is not a candidate-facing text but can route traffic unexpectedly if env is incomplete.

## C. Candidate-facing items with no knowledge-bank equivalent

These are not automatically bugs, but owner review candidates because they can be visible to candidates:

- exact partial-intake questions;
- exact tone-boundary sentence;
- generic provider/policy/model failure sentences;
- off-topic sentence;
- maintenance/technical fallback sentences;
- installation clear/ambiguous/locked sentences;
- approved-app gate sentence;
- post-install training pending/redirect sentences.

The following are intentionally outside the knowledge bank and should remain there:

- access-control denial messages;
- owner/manager command confirmations;
- dashboard/audit status text;
- infrastructure and transport errors;
- model schema/prompt instructions.

## D. Recommended single-source policy

1. Structured facts should be the sole source for app names, capabilities, codes, routing targets, payment facts, profile rules, eligibility rules, and installation facts.
2. Deterministic code should retain only safety decisions and workflow gates, not duplicated business claims. When structured policy exists, deterministic fallbacks should quote or summarize that section; when absent, fail closed.
3. Candidate-facing behavioral copy should be catalogued separately from business facts, with tests for every safety fallback and explicit owner review for wording changes.
4. App vocabulary, fallback selection, secondary options, and startup invariants should all derive from validated structured facts. A startup mismatch should block model execution rather than silently choose Layla or the first array item.
5. Role/channel rules remain code/env-owned security controls and should not be moved into the knowledge bank.

## Priority list for owner review

| Priority | Finding | Why it matters |
|---|---|---|
| P0 | Camera/account fallback contradicts male profile rule | Candidate can receive the opposite of the approved policy. |
| P0 | Payment fallback suppresses published payment facts | Candidate may receive an incomplete payment answer. |
| P1 | App fallback list is duplicated and omits TanChat | Candidate options can be incomplete or Layla-biased. |
| P1 | Generic escalation copy depends on handoff persistence | “Team will check” must never be sent without a real handoff. |
| P2 | V2 enabled-by-default config remains | Can route traffic to legacy behavior if env is incomplete. |
| P2 | Fixed copy catalog absent | Future policy changes can leave stale wording behind. |

