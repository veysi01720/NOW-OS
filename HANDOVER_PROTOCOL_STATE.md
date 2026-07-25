# Handover Protocol State

Date: 2026-07-25 (2026-07-23 retained below)
Timezone: Europe/Istanbul

## Current Package / Step (2026-07-25)

Faz 0 + Faz 0.5 commit 642e425 pushed, verified independently (90/90
files, 617/617 tests PASS). WEBHOOK_QUEUE_MODE=dual_write activated,
verified via 20-min live observation: shadow_queue_stats.inbound
success_count 0->6, failure_count/error_rate always 0.
OUTBOUND_QUEUE_MODE=off, WORKERS_ENABLED=false unchanged.

Separate P0 found during observation: candidates get no real reply,
~14s then generic fallback. See docs/architecture/now-os-kapsamli-durum-ve-plan.md
Bolum 0-P0. Root cause: provider_unavailable in OpenAI run/poll loop.
Network/key/OpenAI-outage/rate-limit all ruled out. Unknown since when.

**P0 investigation update (same day, later):** 7-step diagnostic done.
16/16 synthetic real-call reproduction attempts (baseline, long-thread,
concurrent, from inside the live container) all SUCCEEDED, 6.4-10s,
ruling out code-level timeout (Hypothesis a, confirmed false) and
weakening systemic OpenAI-side 5xx (Hypothesis b). Root cause likely
specific to real candidate thread/traffic state (Hypothesis c) - could
not test further without touching real candidate PII. Gated temporary
raw-error diagnostic logging added: commit dabac5c
(MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED, default off, structural
fields only, never message content). Full suite 90/90 files, 619/619
tests PASS.

**DEPLOYED (same day, later) - approved by Eray.** commit cc27077
built, provenance-labeled (IMAGE_PROVENANCE_LABELED=YES, 4 hashes
verified), only now_os_backend recreated, healthz/readyz 200.
MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED=true added to .env,
now_os_backend recreated again, healthz/readyz 200 re-verified,
printenv confirms flag=true inside the container. Evolution/DB/
cloaker/cloudflare untouched (uptimes unchanged - 3 days/3 weeks).
Now WAITING for the next real candidate failure to capture the raw
error shape (HTTP status + error class, no content) and write an
evidence-based fix.

deployed_commit=cc27077ff48466a70a0c9c8d3ed1c952c0e1c29e
now_os_backend_recreated_at_utc=2026-07-25T20:00:00Z
p0_diag_logging_enabled=true
healthz=PASS readyz=PASS

**P0 real occurrence confirmed (same day, later).** Two real candidate
messages hit the fallback (20:12 and 20:13 UTC). Full log trace
confirmed via CONVERSATION_DECISION_V2_TRACE: mutation_source=
"provider_unavailable", NOT deterministic_safety_response - this is
genuinely the OpenAI transport failure category, not the payment/
camera/job-definition guardrail category. REQUEST_LATENCY_BREAKDOWN
showed model_start_to_model_result_ms=13598, matching the reported
~13.6s pattern exactly. But P0_DIAG_RAW_MODEL_EXECUTION_ERROR showed
ALL structural fields null (diag_error_type only "Error") - the raw
error is a plain JS Error, not an OpenAI SDK structured error.

36/36 total synthetic reproduction attempts (16 earlier + 20 more via a
one-off message-capture probe run from inside the live container) all
SUCCEEDED (6.4-12.4s) - could not reproduce the failure synthetically
even once. Conclusion: this only happens under real production load
(concurrent real traffic + dual_write + DB), not in isolation.

**Approved and deployed: diag_error_message field.** commit 76f3225 -
adds the raw Error's own .message (system/network text only, e.g.
"fetch failed"/"ECONNRESET" - never candidate/prompt content, verified
by a dedicated security test) to P0_DIAG_RAW_MODEL_EXECUTION_ERROR,
capped at 300 chars. Full suite 90/90 files, 621/621 tests PASS. Built,
provenance-labeled, only now_os_backend recreated, healthz/readyz 200,
flag already true (no .env change needed this round). Evolution/DB/
cloaker/cloudflare untouched.

Now WAITING again for the next real failure to capture diag_error_message
and finally get a narrow, evidence-based fix instead of guessing.

deployed_commit=76f3225d66b12cf14dfec9e4cba74edb1abf6d98
now_os_backend_recreated_at_utc=2026-07-25T20:56:00Z
healthz=PASS readyz=PASS

## Previous State - 2026-07-23 (historical)

## Current Package / Step

Post-deploy transfer state after the Quality Pack 1 preparation and
hardening commits. The live backend has been advanced from `63fbd58` to
`7059928`.

This state file is a docs-only handover update after that deploy. It is not
part of the deployed backend image unless a later session deploys it.

## Deploy State

```text
deployed_commit=7059928
production_deploy=YES
now_os_backend_recreated=YES
now_os_backend_image=sha256:3a6e4f02ab673169b09535cab79e41c4ff527e78f8e4676924a19f68d1ba6ae3
evolution_touched=NO
db_touched=NO
healthz=PASS HTTP 200
readyz=PASS HTTP 200
vps_source_status=clean
```

Deployment was completed with the P0 gate discipline:

```text
git_pull_head=7059928
temporary_node_image=node:20-alpine
build=PASS
test=PASS 88/88 files, 606/606 tests
provenance_generate=PASS
provenance_verify=PASS
docker_build_no_cache=PASS
image_label_match=PASS
backend_recreate_only=PASS
healthz_readyz=PASS
```

Provenance and image label evidence:

```text
source_tree_hash=a181566e82ef67cac66cbf3a4522ac03e9b820cb71ef1fe79f28daee0cdd63fc
package_lock_hash=9740eaf9cafebadb9bc33dff25fbad282194cac57b4eab0f8400ee7d5eaf9555
dist_tree_hash=1ecf16e0279460215a5aa1cc74a6353e5e6758b8b409b9717d6bfe22cbc6c2f5
workspace_identity_hash=4db557418dcaad79bf29c01788f72ca2a36aee0aa18d338f4f8054de3b35c57b
provenance_manifest_hash=61c5d1343ee32a84185eafac9f902b22021fcb7fb164c9241f854238f347f853
test_result_reference=quality-pack1-88-files-606-tests-pass
```

## Quality Pack 1 Status

Three Quality Pack 1 findings have been coded and deployed:

- Job-definition grounding: V2 can publish and consume structured knowledge
  facts for job-definition answers.
- Safety fallback repeat guard: deterministic safety/transport fallback
  replies now rotate through safe variants when the recent-reply overlap guard
  would otherwise repeat the same message.
- Candidate tone boundary: disrespectful or abusive candidate tone now has a
  deterministic, polite boundary response category separate from the generic
  fallback pool.

These fixes are deployed, but live verification has not yet been performed in
this handover step.

## Owner Approval / Package 13 Canary

```text
owner_approval_active=NO
package13_canary_armed=NO
owner_approval_endpoint_touched=NO
package13_canary_touched=NO
real_whatsapp_outbound_from_this_deploy=0
```

Owner approval and Package 13 canary were intentionally not touched.

## Next Safe Step

1. Live-verify the grounding fix with a real owner/candidate message.
2. Based on that result, decide whether Package 13 Resume is ready.

## Known Open Item

`src/tests/workspaceLock.test.ts` has a 15 second timeout added. It is not yet
reviewed whether that timeout masks a real performance issue or only stabilizes
the existing test runtime.

## Remaining Blocker

The next Package 13 decision still requires owner review after the live
grounding verification. Canary must remain closed until the owner explicitly
triggers approval.

## Package 16 - Container-Native Provenance (Locally Validated, Not Deployed)

Package 16 (container-native provenance) kod olarak yazıldı ve Docker
Desktop yeniden çalışır hale geldikten sonra 24 Temmuz 2026'da yerel
olarak doğrulandı:

```text
docker_build_no_cache=PASS (host-computed hash argümanı olmadan)
provenance_generate_in_container=PASS
  source_tree_hash=9e9d54829eab0932a93568c0f687b5166df40018e73ebc8c304eade84f432774
  package_lock_hash=9740eaf9cafebadb9bc33dff25fbad282194cac57b4eab0f8400ee7d5eaf9555
  dist_tree_hash=67ccab873da232b20ca2c74ee8d5263928f186413a870f067b8babd17883efed
  workspace_identity_hash=6a3e90b565ff989be1ba811722bcc9002dc30258d03c77edcd8ce6936d2a8fef
  provenance_manifest_hash=d2e9a4e4f40b61c171ce298fb9fe866a4866a0fe50443bbeb234dae05d9ced34
provenance_verify_in_container=PASS (host/container karşılaştırması yok, sadece iç tutarlılık)
image_label_stamp=PASS (scripts/stamp-image-provenance-labels.mjs; docker inspect
  ile 5 hash'in de image label'larında birebir yukarıdaki değerlerle eşleştiği
  doğrulandı)
test=PASS 88/88 files, 607/607 tests
```

Bu, sadece yerel doğrulama içindir - VPS'e hiçbir şey deploy edilmedi.
`docker-compose.yml` bu repoda yok (VPS'in `/root/deploy_package/`
altında, source repo dışında); oradaki `--build-arg` satırlarının
kaldırılması VPS-tarafı bir sonraki adım.

Git snapshot (build öncesi hâli): `outputs/session_handover/PACKAGE_16_GIT_STATUS_20260723.txt`.

## Last Five Commit Change Summary

Command:

```text
git diff --stat HEAD~5..HEAD
```

Captured output:

```text
docs/architecture/PACKAGE_15_SECURITY_FOLLOW_UP_ANALYSIS.md      |  67 +++++++
outputs/quality/v2_job_definition_grounding_design.md            |  46 +++++
src/bridge/knowledgeSync.ts                                      |  15 ++
src/bridge/ownerCommands.ts                                      | 161 +++++++++++++++++
src/bridge/structuredKnowledgePublish.ts                         | 197 +++++++++++++++++++++
src/intelligence/candidate/CandidatePolicyResolver.ts            |  65 ++++++-
src/intelligence/conversation/ConversationContextBuilder.ts       |   6 +-
src/intelligence/conversation/ConversationDecisionEngine.ts       |  22 ++-
src/intelligence/conversation/ConversationDecisionRepair.ts       |  53 +++++-
src/tests/knowledgeSync.test.ts                                  |   8 +-
src/tests/ownerLearningQueueActions.test.ts                      | 104 +++++++++++
src/tests/qualityPack1V2GoldenSkeleton.test.ts                   |  66 +++++++
src/tests/structuredKnowledgePublish.test.ts                     |  74 ++++++++
src/tests/workspaceLock.test.ts                                  |   1 +
14 files changed, 875 insertions(+), 10 deletions(-)
```

## Last Deployed Commit Before This State Update

```text
7059928 docs: analyze ssh key-only hardening follow-up
```
