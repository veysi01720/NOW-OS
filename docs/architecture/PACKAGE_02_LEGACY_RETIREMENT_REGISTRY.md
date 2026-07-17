# Package 02 - Legacy Retirement Registry

This registry classifies legacy or transitional assets. It is not deletion
approval.

| Asset | Classification | Dependency or reason | Retirement gate |
| --- | --- | --- | --- |
| OpenAI Assistants client | isolate | current production provider | Responses parity, canary and rollback proof |
| Assistant Response Contract V1.0 | isolate | owner/manager general path and fallback | all roles on accepted strict decision contract |
| OpenAI thread mapping | isolate | Assistants continuity | Assistants fallback retired and state export verified |
| Direct legacy branch in `ModelExecutionService` | retire later | current feature-off path | Assistant wrapped behind canonical adapter |
| Legacy `ModelAdapterInput/Output` family | retire later | current `run` adapter shape | canonical request/result adopted by both adapters |
| `@ts-nocheck` in adapter production files | retire next code package | hides interface mismatch | contract unification compiles without suppression |
| Conversation Decision V2 | isolate | active candidate production contract | V3 replay, shadow and scoped canary parity |
| Conversation Decision V3 | preserve target | source-only migration work | package-specific implementation approval |
| ResponsesAdapter | preserve target | source-only and unselected | contract repair plus shadow proof |
| Behavior Orchestrator | isolate | feature-off experimental context/state | explicit product architecture decision |
| Queue workers and queue-only modes | isolate | production flags off | separate reliability cutover approval |
| Local stopped message runtimes | quarantined | rollback evidence remains | controlled cleanup dependency proof |
| Local n8n data volume | quarantined | may contain historical credential/data | credential and backup review |
| VPS closed `Now_Akademi` instance | preserve/quarantine | database/session safety | separate Evolution cleanup approval |
| VPS stale Cloudflare port-5678 target | retire later | dependency not proven | network and external DNS dependency proof |

## Permanent Protection

The following are not legacy retirement targets:

- canonical `now_os_backend`
- canonical `nowakademi_evolution`
- canonical `nowakademi_db`
- PostgreSQL and WhatsApp session volumes
- canonical `nowakademi_bot` instance and webhook
- production user state and conversation history
- `data/runtime.lock` and `data/now-os-store.json`
- current rollback-capable production image
- approved knowledge and source integrity evidence
- source-only Responses/V3 migration work
