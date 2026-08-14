# Configuration Source Inventory

Generated: 2026-08-15

## Executive Summary

The highest-risk duplication is the application vocabulary. Before this
change, structured facts contained six owner-approved applications while
`APPROVED_APPS` exposed only four to candidate context. The code now derives
`allowed_apps` from validated structured facts and treats
`APPROVED_APPS_OVERRIDE` as a narrowing intersection only. Invalid or missing
structured facts produce an empty list.

The remaining duplicated areas are mostly deliberate safety boundaries, but
they need explicit ownership and startup observability. The key rule is:
knowledge may describe a policy, but deterministic validators and state guards
remain the enforcement authority.

## 1. Application Lists and App Properties

| Definition | Location | Count/status | Synchronized? | Candidate risk |
|---|---|---:|---|---|
| Canonical app records and properties | `data/knowledge_bank/app_facts.md` | 6 approved apps | Source material | Missing/old runtime copy can hide or alter an app |
| Published app records | `data/knowledge_bank/app_facts_structured.json` | 6 owner-approved records | Must match manifest | Invalid structured data must expose no apps |
| Runtime candidate vocabulary | Previously `APPROVED_APPS` in env; now derived by `src/config/approvedApps.ts` | Derived from owner-approved facts | Fixed in code; runtime env migration still required | Stale env previously hid TanChat and Linky |
| Emergency narrowing | `APPROVED_APPS_OVERRIDE` | Optional intersection | Cannot expand facts | A bad override can hide valid apps, but cannot approve unknown apps |
| Routing prose | `CandidatePolicyResolver.ts` `candidate_secondary_app_options` and `secondary_apps` | Hard-coded guidance | Partially duplicated | Model may see routing names that are not in `allowed_apps` |
| Test fixtures | `src/tests/fixtures/knowledgeBankFixture.ts`, replay fixtures | Repeated app records | Not production source | Tests can pass with stale app metadata |

**Recommendation:** `app_facts_structured.json` plus its valid manifest is the
only runtime app source. Remove the old `APPROVED_APPS` variable during the
next deployment migration. Keep only `APPROVED_APPS_OVERRIDE` as an emergency
restrictor. The routing matrix should also be generated from structured facts
or validated against it at startup; no hard-coded app name may expand the
vocabulary.

## 2. Age, Gender, and Eligibility Limits

| Rule | Location | Current relation |
|---|---|---|
| Minimum age 18 | `src/bridge/candidateIntakeStateMachine.ts:isAgeEligible` | Enforced deterministically |
| Male upper bound 30 | Same function | Enforced deterministically |
| Female upper bound 40 | Same function | Enforced deterministically |
| Unknown-gender fallback upper bound 65 | Same function | Code-only fallback; not stated in the active knowledge text |
| Candidate-facing rule | `data/knowledge_bank/app_facts.md`, `Uygunluk ve Red` | States 18-30 male and 18-40 female |
| Policy section | Structured `policy_sections.eligibility_rejection` | Published representation |

The male/female limits are currently aligned. The fallback `age <= 65` is a
separate code behavior and should be either explicitly documented as an
internal pre-gender parsing rule or removed in favor of fail-closed behavior.
Otherwise a partial message can be treated differently by code and model
context. Eligibility enforcement must remain code-owned; knowledge is for
explanation only.

**Recommendation:** Keep the deterministic state-machine rule as the source
of enforcement. Publish the same values into a typed eligibility policy
object, validate equality at startup, and fail closed on mismatch.

## 3. Hard-Coded Policy Rules vs Knowledge Bank

| Policy | Code locations | Knowledge locations | Sync/risk |
|---|---|---|---|
| No guaranteed earnings/payment | `ConversationDecisionRepair.ts`, semantic quality/validator rules, response prompts | `general_work_model`, `privacy_payment_support`, `app_facts.md` | Intentional defense-in-depth; wording can drift, but code must remain stricter |
| Camera/video boundary | `ConversationDecisionRepair.ts`, vision lock, validator/prompt rules | App capabilities and profile policy section | Mostly aligned; stale facts can cause model ambiguity, never relax validator |
| Sensitive data prohibition | validator/catalog, prompt rules, bundle/source-integrity checks | profile/privacy sections | Intentional duplicate safety layers; code is enforcement source |
| Explicit model acceptance before setup | intake state machine, decision prompt/repair | `work_model_acceptance_required`, setup boundary | Aligned conceptually; action names can drift |
| No invented app/policy facts | approved-app guard, semantic validator, prompt, resolver | structured facts and policy sections | High-risk if allowed vocabulary and facts diverge |
| Memory/no re-ask | `CandidatePolicyResolver` memory fact, prompt/quality guard | `policy_sections.memory_rules`, `app_facts.md` | Recently synchronized conceptually; should have one typed rule object |
| Owner-transfer constraints | `CandidatePolicyResolver` classification logic | `owner_transfer_sections` | Classification is runtime data; missing classification defaults to information |

**Recommendation:** Separate policy data from enforcement. Knowledge should
be the only source of explanatory text and typed policy values. Code should
own invariant checks, and each invariant should have one catalog ID plus a
startup/test parity check against the published policy object.

## 4. Routing and Priority

There are currently three related definitions:

1. `allowed_apps` in backend context, now derived from structured facts.
2. `candidate_secondary_app_options` in `CandidatePolicyResolver.ts`, a
   hard-coded policy sentence containing the routing matrix.
3. `secondary_apps: ["Timo", "Linky", "Soyo"]` returned by the resolver.

The third value is not consumed by the main context/prompt path; it is mainly
an unused result field and test expectation. The routing sentence mentions
TanChat/TanStar, but the model's strict vocabulary is `allowed_apps`.

**Recommendation:** Store routing categories and priority as structured
policy data. Derive the candidate vocabulary from app facts, then validate
every routing target against it. Keep preference logic (device, experience,
text/video) in resolver code, but do not hard-code application names there.

## 5. Payment and Withdrawal Rules

| Definition | Location | Status |
|---|---|---|
| 1-3 business days, weekends excluded, IBAN correction, non-cancellable withdrawal | `app_facts.md` general/payment sections | Knowledge source |
| Same rules in structured facts | `general_work_model.payment_policy`, `policy_sections.privacy_payment_support` | Published copy |
| Missing/unverified payment fallback | `ConversationDecisionRepair.ts`, semantic validator, prompts | Safety enforcement |
| Minimum/fees checked in app screen | Knowledge text and payment boundary wording | Deliberately not a hard-coded amount |

These are intentionally duplicated as data plus enforcement. They are not
currently contradictory: the code refuses unsupported exact payment claims,
while the knowledge layer supplies the verified general timing rules. A
future change to timing must update the structured source and run a parity
test; editing only a fallback string is unsafe.

## 6. Roles and Owner/Manager Numbers

| Definition | Location | Current source |
|---|---|---|
| Owner phone numbers | `OWNER_PHONE_NUMBERS` -> `EnvConfig.ownerPhoneNumbers` -> `roles.ts`/`authorityContext.ts` | Runtime env |
| Manager phone numbers | `MANAGER_PHONE_NUMBERS` -> `EnvConfig.managerPhoneNumbers` | Runtime env |
| Role precedence | `src/config/roles.ts` | Code |
| Test role numbers | Multiple test fixtures | Test-only duplicates |
| Dashboard credentials | Dashboard env variables and runtime files | Runtime secret/config |

The numbers are not duplicated in the knowledge bank. They can still drift
between the runtime `.env`, token files, and test fixtures. A wrong runtime
number changes authorization and can route owner commands to the model path;
this is a security risk, not merely a candidate wording issue.

**Recommendation:** Runtime secret manager/env is the sole source. Startup
should log only normalized counts and a masked fingerprint, and fail closed
for owner commands when the configured owner set is empty or malformed.

## 7. File Paths and Data Sources

| Data | Locations | Risk |
|---|---|---|
| Structured knowledge | `KNOWLEDGE_BANK_DIR` or default `data/knowledge_bank/app_facts_structured.json` | Runtime bind mount can differ from git source |
| Markdown source | `data/knowledge_bank/app_facts.md` | Runtime file may be separately materialized by owner approval |
| Manifest | `structured_knowledge_manifest.json` | Hash mismatch must fail closed |
| Candidate state/store | Runtime `data/now-os-store.json` | Active state must not be overwritten by deploy/source sync |
| Build source | Canonical git workspace / container `/app` | Image can contain code different from runtime data |

**Recommendation:** Structured JSON plus manifest is the runtime read source;
Markdown is the materialization/source artifact. Startup should validate
structured JSON, manifest hash, schema, and owner-approved app count. It must
not silently fall back to Markdown or a baked placeholder when validation
fails.

## 8. Feature Flag Defaults

| Flag | Parser default | Other definitions | Drift risk |
|---|---|---|---|
| `MODEL_ADAPTER_LAYER_ENABLED` | false | Compose/runtime override, canary runbook | Global provider change if wrong |
| `TWO_LAYER_VALIDATOR_ENABLED` | false | Compose/runtime override, tests | Validation strictness changes |
| `INSTALLATION_VISION_ENABLED` | false | Runtime allowlist/activation config | Vision can activate unexpectedly if env drifts |
| `RESPONSES_SHADOW_ENABLED` | false | Shadow mode/roles env and runbook | Shadow vs outbound confusion |
| `WORKERS_ENABLED` | false | Compose/runtime env, capacity roadmap | Queue consumption/side effects |
| `WEBHOOK_QUEUE_MODE` | off | Runtime env and queue docs | Inbound durability behavior |
| `OUTBOUND_QUEUE_MODE` | off | Runtime env and queue docs | Delivery behavior |
| `CONVERSATION_DECISION_V2_ENABLED` | true unless explicitly false | Runtime env and migration docs | Legacy path can return unexpectedly |
| `HUMAN_REPLY_DELAY_ENABLED` | true unless explicitly false | Tests/runbook | Timing behavior changes |
| `BEHAVIOR_ORCHESTRATOR_ENABLED` | false | Canary docs/tests | Behavior layer activation |

These defaults intentionally live in code so a missing env does not silently
activate risky features. Runtime Compose values are the deployment decision;
runbooks and tests are documentation/verification, not sources of truth.

**Recommendation:** Keep safe defaults in code, keep deployment values in one
runtime env, and add a startup safe-config summary containing only flag values,
not secrets. A deployment gate should compare the expected flag profile with
the running container before accepting health.

## 9. Proposed Startup Synchronization Checks

1. Load structured facts and manifest.
2. Verify manifest `structured_hash` and schema.
3. Derive owner-approved app vocabulary.
4. Apply only the optional narrowing override.
5. Verify every routing target exists in the derived vocabulary.
6. Verify typed eligibility/payment invariant values against the published
   policy snapshot.
7. Emit masked counts/statuses only; no raw text, phone numbers, codes, or
   secrets.
8. Fail closed for candidate routing and owner knowledge activation on any
   mismatch.

## Summary of Recommended Single Sources

| Group | Single source |
|---|---|
| Apps and app properties | Validated structured knowledge + manifest |
| Eligibility enforcement | Deterministic state-machine catalog, mirrored to typed knowledge |
| Explanatory policy | Structured policy sections |
| Routing targets | Structured app records + structured routing matrix |
| Payment timing/explanations | Structured knowledge; validator owns safety limits |
| Roles/phone numbers | Runtime secret env/secret manager |
| Runtime data paths | Deployment contract and `KNOWLEDGE_BANK_DIR` |
| Feature flags | Runtime env with safe code defaults |
