# Package 13 Arming Blocker Closure Evidence

Date: 2026-07-18  
Deployment: **NO**  
Canary armed: **NO**  
Production approval created: **NO**

## Decision

The owner approval controller, persistent 20-event observation window, Connection
Doctor projection, build, full tests, provenance, immutable image tests, isolated
startup, and no-outbound acceptance pass. The real Package 12 requalification
does **not** pass all mandatory suite targets in all three runs. Canary arming is
therefore blocked and no runtime flag, production container, approval, or deploy
was changed.

```text
OWNER_APPROVAL_CONTROLLER=PASS
PERSISTENT_20_EVENT_OBSERVABILITY=PASS
PACKAGE_12_REQUALIFICATION=FAIL
EXACT_IMAGE_NO_OUTBOUND_ACCEPTANCE=PASS
CANARY_ARMED=NO
DEPLOY_EXECUTED=NO
```

## 1. Owner Approval Controller

Implemented files:

- `src/modelAdapter/modelAdapterCanaryApprovalController.ts`
- `src/modelAdapter/modelAdapterCanaryApprovalAudit.ts`
- `src/modelAdapter/modelAdapterCanaryApproval.ts`
- `src/bridge/dashboardRoutes.ts`
- `src/server.ts`

Runtime endpoint:

```text
POST /dashboard/actions/model-adapter-canary/approve
Authentication: DASHBOARD_OWNER_TOKEN only
Manager token: denied
Legacy admin token: denied
```

Mandatory request scope:

- canonical tenant id;
- greeting / candidate-first-contact intent set;
- configured traffic percentage, capped at 10%;
- expiry from 1 to 1440 minutes;
- exactly 20 observed messages;
- backend-enforced private candidate channel.

The server generates a fresh `approval_id` and `approval_generation`. An active
approval cannot be reused (`ACTIVE_APPROVAL_REUSE_DENIED`). After invalidation,
the next approval receives a different generation. Approval JSON uses temporary
file + rename atomic replacement and mode `0600`. Audit is append-only NDJSON,
mode `0600`, and records owner role, owner-token auth source, timestamp, result,
reason, and sanitized scope without storing the token.

Test evidence:

```text
npm.cmd test -- --run src/tests/modelAdapter/modelAdapterCanaryApprovalEndpoint.test.ts
Test file: src/tests/modelAdapter/modelAdapterCanaryApprovalEndpoint.test.ts
Covered: scoped issue, append-only audit, active reuse denial, fresh generation,
manager/legacy-admin denial, invalid scope denial.
Included in full suite: PASS, 5 tests.
```

## 2. Persistent 20-Event Observability

Implemented files:

- `src/modelAdapter/modelAdapterCanaryStateStore.ts`
- `src/modelAdapter/modelAdapterCanaryControl.ts`
- `src/modelAdapter/modelAdapterCanaryThresholds.ts`
- `src/modelAdapter/modelExecutionService.ts`
- `src/server.ts`

The atomic `0600` state file persists:

- approval generation;
- hashed reservations and finalized status;
- terminal observations needed to restore threshold windows;
- terminal progress and aggregate outcome counts;
- stop latch and reason;
- window start and last terminal timestamps.

Restart verification:

```text
src/tests/modelAdapter/modelAdapterCanaryPersistence.test.ts
7 events finalized -> new controller process -> progress remains 7/20
same event after restart -> duplicate
events 8..20 -> progress 20/20 and complete=true
raw event keys, message text, phone, and JID absent from state file
```

Connection Doctor fields:

```text
canary_terminal_window_target
canary_terminal_window_progress
canary_terminal_window_complete
canary_window_started_at
canary_last_terminal_at
canary_result_totals
```

Doctor contract evidence:

```text
src/tests/connectionDoctorRoute.test.ts
PASS in full suite
```

## 3. Build and Full Regression

Commands and results:

```text
npm.cmd run build
WORKSPACE_PREFLIGHT=PASS
tsc -p tsconfig.json
exit_code=0

npm.cmd test -- --run
Test Files  83 passed (83)
Tests       545 passed (545)
exit_code=0
```

Targeted approval, persistence, stop, candidate scope, and Doctor run:

```text
Test Files  5 passed (5)
Tests       13 passed (13)
```

## 4. Real Package 12 Requalification

Command:

```powershell
$env:RESPONSES_QUALIFICATION_REAL='true'
$env:OPENAI_RESPONSES_MODEL='gpt-4.1'
npm.cmd run test:package12:combined-real
```

The OpenAI credential was reused process-locally from the canonical runtime,
was not printed, and was not written to disk. The production container did not
have `OPENAI_RESPONSES_MODEL`; the previously accepted Package 12 configured
model was selected only for this qualification process.

| Run | Baseline | Targeted | Expanded | Unsafe | Result |
|---:|---:|---:|---:|---:|---|
| 1 | 13/13 | 3/3 | 10/10 | 0 | PASS |
| 2 | 13/13 | 3/3 | 10/10 | 0 | PASS |
| 3 | 13/13 | 2/3 | 9/10 | 0 | FAIL |

Failed scenario in run 3:

```text
id=p12_unknown_app_missing_info
classification=MODEL_QUALITY_REJECTED
reason=NEXT_ACTION_MISMATCH
actual_next_action=ask_missing_info
actual_chosen_actions=clarify_ambiguous_input
provider_failure=0
parse_failure=0
schema_rejection=0
semantic_rejection=0
unsafe_claim_count=0
real_outbound_count=0
```

The mandatory targeted target is 3/3 in every run. This result is not eligible
for arming even though baseline remained 13/13 and expanded met its 9/10 floor.

## 5. Exact Immutable Image No-Outbound Acceptance

Provenance:

```text
source_tree_hash=ca4572251360c2f958ac96d244c154d710f6d5095509b28352fbe804d92cdb69
manifest_hash=076b53328f615cda321256ef2241c4e49e95c0151f30698451be3418571bfd23
PROVENANCE_VERIFIED=YES
```

Candidate image:

```text
tag=now-os-canary-prep:ca4572251360
image_id=sha256:2e8d028fa27f8084dcba686f1bae3190b8ee31d2d488809ea07979c3fe7ab55d
SOURCE_LABEL_MATCH=true
```

Network-disabled full suite inside the exact image:

```text
docker run --rm --network none --entrypoint npm <candidate-image> test -- --run
Test Files  83 passed (83)
Tests       545 passed (545)
```

Network-disabled canonical no-outbound tests inside the exact image:

```text
docker run --rm --network none --entrypoint npx <candidate-image> vitest run \
  src/tests/modelAdapter/modelAdapterCanaryRuntimeStop.test.ts \
  src/tests/modelAdapter/package13CandidateCanary.test.ts \
  src/tests/modelAdapter/modelAdapterCanaryPersistence.test.ts
Test Files  3 passed (3)
Tests       6 passed (6)
```

Isolated exact-image startup with dummy credentials and no network:

```text
HEALTH_STATUS=200
CONTAINER_STATE=running
OUTBOUND_SEND_EVIDENCE_COUNT=0
DUMMY_SECRET_LOG_EVIDENCE_COUNT=0
```

No Evolution API, webhook, or real WhatsApp sender was called.

## 6. Security and Runtime State

```text
changed_file_secret_pattern_count=0
changed_file_full_phone_pattern_count=0
changed_file_raw_jid_pattern_count=0
production_deploy=NO
production_approval=NO
canary_armed=NO
shadow_enabled=NO
```

Separate pre-existing dependency finding:

```text
npm audit --omit=dev
high=1
critical=0
package=adm-zip
fix_available=true
```

No dependency was upgraded in this task because it is outside the requested
arming-blocker scope and would change the lockfile and candidate provenance.

## Final Status

```text
AUTOMATIC_STOP_CODE_ACTIVE=YES
OWNER_APPROVAL_CONTROLLER_ACTIVE_IN_CODE=YES
PERSISTENT_EVENT_WINDOW_ACTIVE_IN_CODE=YES
FUNCTIONAL_CANARY_ARM_READY=NO
CANARY_ARMED=NO
BLOCKER=PACKAGE_12_TARGETED_REQUALIFICATION_RUN_3_FAILED
DEPLOY_EXECUTED=NO
```
