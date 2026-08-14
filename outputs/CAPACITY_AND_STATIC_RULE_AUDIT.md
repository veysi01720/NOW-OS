# Capacity And Static Rule Audit

Generated: 2026-08-15

## 1. Capacity Measurement

### Method

The benchmark ran inside the deployed `now_os_backend` container against the configured Responses/Terra adapter. It created synthetic private inbound contexts and concurrent model calls only. It did not call Evolution, WhatsApp, an outbound sender, or a worker. Therefore `outbound_count=0` and the benchmark measures the model/backend execution path, not webhook transport or WhatsApp delivery.

### First clean burst

| Concurrent calls | Success | Errors | Average | P95 | Provider rate-limit | Outbound | Message loss |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 10/10 | 0 | 4,996 ms | 10,263 ms | 0 | 0 | 0 |
| 50 | 50/50 | 0 | 3,591 ms | 4,636 ms | 0 | 0 | 0 |
| 100 | 100/100 | 0 | 3,790 ms | 4,778 ms | 0 | 0 | 0 |
| 200 | 194/200 | 6 | 3,850 ms | 4,814 ms | 6 | 0 | 6 provider failures |

The first observed degradation point was **200 concurrent calls**, where 3% failed with provider rate limiting. No backend message-drop signal or outbound delivery was involved.

### Resource sample during a repeat burst

| Concurrent calls | Peak sampled CPU | Peak sampled RAM |
|---:|---:|---:|
| 10 | 42.78% | 55.88 MiB |
| 50 | 74.59% | 87.47 MiB |
| 100 | 101.24% | 104.6 MiB |
| 200 | 126.71% | 142.5 MiB |

A second burst immediately after the first was intentionally observed as a cooldown effect: rate-limit errors persisted at 10/50/100/200 levels (5, 37, 75, and 147 failures respectively). This is provider-side throttling/cooldown, not evidence of backend memory exhaustion. The VPS has 8 GiB RAM; measured backend memory remained below 150 MiB.

### Bottleneck classification

- **Primary bottleneck:** Terra/Responses provider rate limit under burst concurrency.
- **Backend synchronous path:** CPU crosses one core around 100 concurrent calls, but no backend crash or local queue loss was observed.
- **Worker:** `WORKERS_ENABLED=false`; no worker was activated.
- **Evolution:** not exercised by this no-outbound benchmark.
- **PostgreSQL:** not exercised by the isolated provider harness.
- **Safe current synchronous envelope:** approximately **50 concurrent model calls** for a clean burst; 100 is a watch threshold; 200 is not safe without admission control/backpressure and provider quota headroom.
- **Phase 9 implication:** worker/admission control becomes operationally necessary before sustained traffic approaches 100 concurrent model executions, and is mandatory for multi-channel bursts near 200.

### Multi-channel assessment

The backend’s connector types recognize `instagram`, but the live webhook path measured here is Evolution/WhatsApp only. Three WhatsApp instances can converge on the same backend endpoint conceptually, but each adds an Evolution process/session/resource and multiplies inbound burst pressure. The current code does not provide a measured Instagram webhook-to-model production path in this benchmark. Therefore “3 WhatsApp + 2 Instagram” is **not production-capacity proven**.

Evolution’s per-instance CPU/RAM/network cost was not separately measured in this no-outbound run. It must be measured in staging with three instances and persistent sessions; inventing a per-instance cost from this test would be misleading.

## 2. Static Business-Rule Audit

Values below are findings only. None were changed in this audit.

| Value / rule | Location | Knowledge-bank counterpart | Status / risk | Origin evidence |
|---|---|---|---|---|
| Male age 18-30, female age 18-40, under 18 rejected | `candidateIntakeStateMachine.ts` | Published eligibility policy | **Aligned** | Current implementation in `ea8eae2`; prior 65 fallback removed |
| `age > 65` semantic validator ceiling | `ConversationDecisionV3SemanticValidator.ts:216` | No valid current policy counterpart | **SUSPICIOUS / conflicting stale default** | `git blame`: `28f4935` (2026-07-17) |
| Daily hours 1-16 | `ConversationDecisionV3SemanticValidator.ts:219` | General intake/work rules | **Likely aligned, owner confirmation recommended** | `28f4935` |
| Context targets: 12,000 owner/manager; 16,000 report; hard cap 22,000 | `src/utils/contextBudget.ts:5-7` | No direct structured policy field | **Engineering limit, not business rule** | Existing context-budget implementation |
| Model execution timeout 45,000 ms | `src/config/env.ts:127` | No knowledge-bank counterpart | **Engineering default** | Env fallback; overrideable |
| Queue max 1,000 entries; TTL 1 hour; lease 1 minute | `inMemoryReliabilityQueueStore.ts:11-12,89` | No business counterpart | **Engineering defaults** | `642e4259`, 2026-07-24 |
| Queue backlog alarm at 50; exponential retry capped at 60 seconds | `inMemoryReliabilityQueueStore.ts:158,208` | No business counterpart | **Engineering defaults** | `28f4935` |
| ZIP 50 MiB, 500 files, 200 MiB extracted, 10 MiB/entry, 180 sec | `src/bridge/zipIngestion/pipeline.ts:26-32` | Security/design documents | **Security limits; review operationally, do not treat as policy** | `28f4935` |
| ZIP processing timeout additionally capped at 30 sec | `pipeline.ts:187` | Design says bounded processing, no exact value | **Potential documentation drift** | `28f4935` |
| Model adapter canary max traffic 10%; message window exactly 20 | `modelAdapterCanaryApprovalController.ts:131-134` | Canary design | **Aligned with canary control** | `fa5e2df5` |
| Canary stop thresholds: validator reject >10%, transient retry >20%, timeout >10% | `modelAdapterCanaryThresholds.ts:84-93` | Canary safety plan | **Engineering safety threshold** | Existing package-13 code |
| Retry reduction 30% and context array caps of 10 | `contextBudget.ts:60,77-92` | No policy counterpart | **Engineering heuristic** | Existing implementation |
| Reply/content caps: 160, 500, 1,000, 2,000, 5,000 chars in various stores/routes | `followUpQueue.ts`, dashboard/review/sanitizer files | No single canonical content policy | **Duplicated limits; consolidation candidate** | Multiple existing locations |
| Secondary routing apps `Timo, Linky, Soyo` | `CandidatePolicyResolver.ts:222` | Routing matrix lists these alternatives | **Aligned today, duplicate source** | Existing resolver + structured routing policy |
| Routing text includes Layla/TanChat/Amar/Linky/Soyo/Timo | Structured routing policy and resolver fallback text | Same | **Potential drift risk** | Resolver has hardcoded English fallback at lines 203-204 |
| Payment terms such as 1-3 business days, IBAN, cancellation rule | Structured `general_work_model`/policy sections | Same | **Mostly aligned; startup guard checks presence only** | Runtime startup guard reports PASS |
| Default app names in golden fixtures (`Layla`, `Soyo`, `Amar`, `Timo`) | `src/behavior/goldenConversations.ts` | Structured facts has six apps | **Test fixture stale/incomplete, not runtime source** | Existing fixture |
| Default response text and safety phrases | `SemanticQualityGuard.ts`, `responsesDecisionPrompt.ts`, `buildBackendContext.ts` | Some policy sections overlap | **Duplicated behavior source; candidate-facing drift risk** | Static literals and policy context coexist |
| Multipart upload 50 MiB | `server.ts:395` | Media design has 2 MiB installation image limit | **Potential boundary mismatch** | Server transport cap is broader than installation verifier |

## Owner Review Priorities

1. Remove or replace the stale `>65` semantic validator ceiling so V3 validation cannot accept a policy-invalid age.
2. Decide whether daily-hours `1-16` is the approved business rule or an engineering parser limit.
3. Make routing and secondary-app selection derive exclusively from structured facts/policy sections; keep hardcoded text only as a fail-closed fallback.
4. Document or centralize content-size limits so transport, ZIP, review, and model-context limits cannot drift silently.
5. Run a staging multi-instance benchmark before planning 3 WhatsApp + 2 Instagram production use.

## Safety Boundary

No business-rule value, feature flag, worker setting, provider setting, container, database, or live WhatsApp connection was changed by this audit. The only produced artifact is this report.
