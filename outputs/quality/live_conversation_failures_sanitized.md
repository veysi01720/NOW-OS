# Quality Pack 1 Live Conversation Mining - Sanitized

Generated: 2026-07-22

Scope: read-only mining from production `now-os-store.json`, backend logs, and existing sanitized WhatsApp learning imports. No phone numbers, JIDs, names, tokens, raw IDs, or secrets are included here.

## Summary

- A) Parrot/repeated bot reply: 4 sanitized observations found.
- A) Candidate-scope observations converted to regression tests: 2.
- B) Re-asking known candidate info after it was provided: 0 usable live examples found.
- C) Generic job-definition answer missing app/policy specifics: 1 usable live example recorded, not yet converted.
- D) Owner tone/jargon override ignored: 0 usable live examples found.
- E) Fallback/safety response duplicate: 1 paired live observation recorded, not yet converted.

Quality Pack 1 live conversion is partial: 2/10 real golden assertions were added. No synthetic examples were created.

## Recorded Candidate Examples Pending Conversion

### QP1-LIVE-E1 - Fallback/Safety Response Duplicate Appears Outside Parrot Guard

- Category: `E_FALLBACK_SAFETY_DUPLICATE`
- Source: live backend logs and owner-provided screenshot, private candidate conversation.
- Observation time: 2026-07-22 22:06-22:09 UTC / 2026-07-23 01:06-01:09 Europe/Istanbul.
- Deploy timing check: `now_os_backend` was recreated at 2026-07-22 21:34:34 UTC / 2026-07-23 00:34:34 Europe/Istanbul, so both candidate turns happened after the parrot guard deployment.
- Correlation 1: `corr_929041fa-6606-4d1a-8262-e5d7b871fb84`.
  - Candidate prompt, sanitized: short frustration/critique about bot wording.
  - Runtime path: `MESSAGE_NORMALIZED` private, `ASSISTANT_RUN_STARTED`, primary model error, repair model error, `CONVERSATION_DECISION_V2_TRACE`, `SEND_CONFIRMED`, `WHATSAPP_SEND_SUCCESS`.
  - Trace fields: `intent=candidate_next_step`, `dialogue_phase=WORK_MODEL_ACCEPTANCE`, `final_reply_origin=deterministic_safety_response`, `mutation_source=final_validation_safety_response`, `model_call_count=2`, `reply_mutated_after_model=true`.
  - Reason codes: `WORK_MODEL_NOT_DISCLOSED` appeared in both quality and validation reason arrays.
- Correlation 2: `corr_8fb82afe-4584-4258-bc7f-8c8527c31806`.
  - Candidate prompt, sanitized: short question asking which apps are available.
  - Runtime path: `MESSAGE_NORMALIZED` private, `ASSISTANT_RUN_STARTED`, primary model error, repair model error, `CONVERSATION_DECISION_V2_TRACE`, `SEND_CONFIRMED`, `WHATSAPP_SEND_SUCCESS`.
  - Trace fields: `intent=candidate_next_step`, `dialogue_phase=WORK_MODEL_ACCEPTANCE`, `final_reply_origin=deterministic_safety_response`, `mutation_source=final_validation_safety_response`, `model_call_count=2`, `reply_mutated_after_model=true`.
  - Reason codes: `WORK_MODEL_NOT_DISCLOSED` appeared in both quality and validation reason arrays.
- Bot reply, shortened/sanitized: both turns sent the same deterministic safety fallback meaning "I could not clarify this safely; team should check."
- Quality concern: this is not the normal model-response parrot pattern. The duplicate appears to come from the fixed safety fallback template after primary+repair model failure/final validation failure.
- Code finding: `ConversationDecisionEngine.ts` validates the model/repair decision, then replaces it with `buildDeterministicSafetyDecision(...)` when final quality or schema validation fails. The replacement fallback is not re-run through a second recent-reply repetition check before send.
- Scope note: this is a Quality Pack 1 follow-up distinct from the NEW_LEAD parrot guard. Candidate-facing fallback templates need repeat-aware behavior or contextual variants so two different questions do not receive identical "team check" replies.

### QP1-LIVE-C1 - Job Definition Answer Overstates Sparse Policy Facts

- Category: `C_JOB_DEFINITION_MISSING_POLICY_SPECIFICS`
- Source: live memory snapshot and backend logs, private candidate conversation.
- Observation time: 2026-07-22 21:36 UTC / 2026-07-23 00:36 Europe/Istanbul.
- Runtime evidence: inbound private candidate message reached V2 path, `SEND_CONFIRMED` and `WHATSAPP_SEND_SUCCESS` were logged; no `SEND_TEXT_FAILED` was logged for this turn.
- State at observation: `WORK_MODEL_ACCEPTANCE`; selected app appears as Layla in recent conversation memory.
- Candidate prompt, sanitized: short direct job-definition question.
- Bot reply, shortened/sanitized: `Burada işin, Layla uygulamasında sadece yazışarak sohbetlere cevap vermek. Kamera açmak veya görüntülü görüşme zorunlu değil. Sadece mesajlara yazılı olarak yanıt veriyorsun...`
- Policy evidence available in live knowledge bank: `app_facts.md` contains Layla/NIVI with `Text-only`; `app_facts_structured.json` and `app_routing_rules.md` were not present in the mounted live knowledge bank snapshot.
- Quality concern: the answer used the sparse `Text-only` fact as if it were the full job definition (`sadece mesajlara cevap veriyorsun`). The live policy source did not provide enough structured job-definition detail to ground that full explanation.
- Scope note: this is not a parrot-guard failure; the reply was different. It belongs to Quality Pack 1 job-definition grounding.

#### QP1-LIVE-C1 Root-Cause Notes

- VPS inventory check: mounted runtime path `/app/data/knowledge_bank` contained `app_facts.md`, `approved_learning.json`, and `approved_learning.md`; it did not contain `app_facts_structured.json`, `app_routing_rules.md`, `full_approved_knowledge_bundle.md`, or `publish_manifest.json`.
- Runtime structured facts check: `loadStructuredAppFacts()` would return `source_status=missing` because `/app/data/knowledge_bank/app_facts_structured.json` does not exist.
- V2 path code finding: `buildBackendContext.ts` includes `structured_facts`, but `ConversationContextBuilder.ts` builds `canonical_policy_facts` through `resolveCandidatePolicy(state, approvedApps)`, not from `structured_facts` or `app_routing_rules.md`.
- Likely root cause: live V2 job-definition grounding is operating from sparse static candidate policy plus `app_facts.md`, while the structured Package 11B-style source files are absent from the VPS runtime knowledge bank. This is the V2 analogue of the earlier structured-facts context gap and should be handled as a deliberate Quality Pack 1 design/fix, not as a parrot-guard issue.

## Converted Candidate Examples

### QP1-LIVE-A1 - Work Model Fast-Path Repeated

- Category: `A_PARROT_REPLY`
- Source: live memory snapshot, private candidate conversation.
- State at observation: `WORK_MODEL_ACCEPTANCE`, age/gender/daily availability present, model acceptance pending, selected app Layla.
- Candidate turn 1: `Selam`
- Bot reply 1: `Bilgilerini aldim. Onayli uygulama icinde temel is, gelen sohbet veya mesajlara yaziyla duzenli cevap vermek. Kamera ya da goruntulu calisma zorunlu diye bir kural soylemiyoruz; mesajlasma agirlikli ilerleyebilirsin. Kuruluma gecmeden once bu calisma modeli sana uygun mu?`
- Candidate turn 2: `Selam`
- Bot reply 2: same as bot reply 1.
- Regression test: `repairs a live work-model parrot reply instead of sending the same answer again`
- Expected protection: deterministic fast-path keeps model call count at 0, but uses a shorter repeat-safe reply instead of the exact previous paragraph.

### QP1-LIVE-A2 - Frustration Follow-Up Repeated

- Category: `A_PARROT_REPLY`
- Source: live memory snapshot, private candidate conversation.
- State at observation: `READY_FOR_INSTALLATION`, age/gender/daily availability present, work model accepted, selected app Layla.
- Candidate turn 1: `Nasil para kazanacagim erkek hesabimi acmam gerekiyor ne yapmam gerekiyor hicbir sey anlatmadim ki`
- Bot reply 1: `Tamam, bilgiler tamam. Simdi kurulum adimina gecebiliriz.`
- Candidate turn 2: `Dalga mi geciyorsunuz efendim`
- Bot reply 2: same as bot reply 1.
- Regression test: `repairs a live frustration parrot reply before repeating the stale setup template`
- Expected protection: V2 semantic guard marks `RECENT_REPLY_REPEATED`, requests repair, and sends the repaired answer instead of the stale setup template.

## Out-Of-Scope Observations

These were found during mining but not converted to candidate golden tests because the message role/wording is owner or authority-mode, not candidate traffic:

- Owner/authority greeting repeated the same `Selam sef...` style reply.
- Owner/authority knowledge note repeated the same `knowledge'a al` acknowledgement style reply.

## Insufficient Live Evidence

- B) Known-info re-ask: not enough paired live text in the available 7-day logs/store memory.
- C) Generic job-definition answer: not enough paired live text in the available 7-day logs/store memory.
- D) Owner style override ignored: not enough paired live text in the available 7-day logs/store memory.
