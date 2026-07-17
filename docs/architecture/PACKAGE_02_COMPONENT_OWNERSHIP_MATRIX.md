# Package 02 - Component Ownership Matrix

## Field And Operation Ownership

| Capability | Current authoritative owner | May propose | Must validate | Must persist/send | Status |
| --- | --- | --- | --- | --- | --- |
| Evolution payload normalization | `normalizeEvolutionMessage` | gateway payload | normalizer shape rules | backend | active |
| Message idempotency | `evolutionWebhook` + `MessageDedupeStore` | none | dedupe key | persistent store | active |
| Sender role | `resolveSenderRole` | nobody | backend whitelist | backend context | active |
| Group/command permission | backend mode/command gates | nobody | deterministic backend | backend | active |
| Age/gender/daily hours | `candidateIntakeStateMachine` | current user message | deterministic extraction | `UserStateStore` | active |
| App/phone/acceptance patch | model decision | `ConversationDecisionV2` | `StatePatchValidator` plus current-message evidence | `UserStateStore` | active |
| Conversation memory | backend handler | accepted user/public reply | store limits | `MemoryStore` | active |
| Assistant thread mapping | Assistants adapter | provider | thread store contract | `ThreadStore` | isolated fallback |
| Candidate policy facts | `CandidatePolicyResolver` | approved knowledge | backend policy rules | context only | active |
| Allowed actions | `AllowedActionResolver` | nobody | backend state | context only | active |
| Candidate natural-language decision | model boundary | active model | decision and quality validators | never directly | active V2 |
| Owner/manager general reply | Assistants fallback | active Assistant | V1 parser and quality guards | public reply only | active fallback |
| State transition | backend | validated model patch | deterministic state validator | `UserStateStore` | active |
| Knowledge suggestion | backend ingestion/review | model internal note only in authorized flow | owner/manager review rules | ingestion store | isolated |
| Active knowledge update | backend publish workflow | approved review records | source integrity and owner approval | knowledge/publish service | controlled |
| WhatsApp public reply | backend egress | validated public reply | final outbound rules | `EvolutionApiSender` | active single owner |
| Retry queue send | queue worker | queued public reply | idempotency and queue status | same sender abstraction | dormant |
| Runtime diagnostics | logger/Connection Doctor | domain events | sanitization | diagnostic stores/logs | active |

## State Field Ownership

| State field | Extraction/proposal owner | Acceptance rule |
| --- | --- | --- |
| `age` | candidate intake state machine | current message evidence only |
| `gender` | candidate intake state machine | current message evidence only |
| `daily_hours` | candidate intake state machine | current message evidence only |
| `selected_app` | V2 decision may propose | approved app plus current message evidence |
| `phone_type` | V2 decision may propose | deterministic phone detector evidence |
| `model_acceptance` | V2 decision may propose | current message evidence and disclosed model |
| `work_model_disclosed` | V2 decision | accepted only through validated decision path |
| `behavior_conversation_state` | behavior state service | feature-gated; not canonical candidate facts |
| queue/follow-up state | backend queue evaluator | candidate private rules and dedupe |

## Contract Authority

| Contract | Authority | Public output allowed | State write allowed |
| --- | --- | --- | --- |
| `NormalizedIncomingMessage` | backend | no | no |
| `BackendContextPayloadV1` | backend | no | no |
| Assistant Response Contract V1.0 | backend parser | `reply` only | no direct write |
| Conversation Decision V2 | backend schema/validator | validated `reply.text` | proposal only |
| Conversation Decision V3 | backend strict schema | not active | not active |
| `ModelExecutionRequest/Result` | target adapter contract | no direct send | no |

## Single-Owner Invariants

1. Role always comes from backend authority context.
2. Only backend persistence writes state or memory.
3. Only approved knowledge workflows modify knowledge.
4. Only backend validation converts model output into an accepted decision.
5. Only one canonical egress callsite may send a public reply.
6. No provider state becomes the business source of truth.
