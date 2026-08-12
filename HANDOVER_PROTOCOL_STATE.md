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

**Owner priority roadmap set (same day, later) - see
docs/architecture/now-os-kapsamli-durum-ve-plan.md, "Owner Onceligi"
section near the top.** Eray's three priorities: Zeka (real
grounded answers), Kapasite (100+ concurrent chats), Sureklilik (real
human handoff on failure). Approved order: (1) provider_unavailable
root cause + narrow fix [in progress, waiting], (2) human handoff
mechanism, (3) V2 grounding fix, (4) Faz 9 (queue/worker) + Faz 8
(Postgres), (5) intelligence/learning layer LAST.

**Owner red line - fourth priority:** Image processing. Candidate photo/document handling is outside current scope; media is intentionally blocked by stripMediaBase64. This feature is not yet designed or implemented. This order requires
explicit owner approval to change.

**Owner red-line priorities (explicit mapping):** Intelligence (Zeka), Capacity (Kapasite), Sustainability (Surdurulebilirlik), and Image Processing (Goruntu Isleme).

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

## P0 Access / OOM Incident Note — 2026-07-26

- SSH key access to the VPS was confirmed; the host booted from the normal Ubuntu disk (`/dev/sda1`), not Rescue.
- `now_os_backend` was in a restart loop because a stale `data/runtime.lock` contained PID 1; no host backend process was running.
- The stale lock was preserved as a backup and the backend was recovered without rebuild or image replacement.
- `healthz=200` and `readyz=200` after recovery; Evolution and PostgreSQL were not restarted.
- No matching kernel/journal OOM-killer event was found for today during this check.
- `cloudflare` was started after the reboot and reached running state.
## End-of-Day Consolidated Report — 2026-07-26

### Environment / dual_write
- Compose production source is `/root/deploy_package/now_os_backend/.env` via `docker-compose.yml` `env_file`; `now_os_backend_src/.env` is source/test configuration only.
- Production env was atomically corrected with mode `0600`:
  - `WEBHOOK_QUEUE_MODE=dual_write`
  - `OUTBOUND_QUEUE_MODE=off`
  - `WORKERS_ENABLED=false`
- A malformed, path-like non-environment key was present before the cleanup pass. It was a repeated Windows-path-shaped token rather than a valid `[A-Z][A-Z0-9_]*` variable name, so Docker could not treat it as a normal configuration key. Its exact origin is not proven; it was not created by the final fix. The pre-fix copy is retained in the protected backup directory.
- After cleanup, malformed key count is zero and duplicate key count is zero.
- Source/runtime key drift remaining: source-only `DASHBOARD_OWNER_TOKEN` and `MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED`; no production-only valid key remains. Values are intentionally not recorded here.

### A-F closeout
- A — runtime-lock fix `28aedc8`: backend-only recreate completed; health and readiness returned 200; no Evolution/Postgres restart.
- B — human-handoff and structured-grounding commits `ce039bc` / `2828f45`: deployed through the backend-only path; behavior canary remains off.
- C — Phase 8/9 capacity migration: intentionally deferred; workers remain disabled.
- D — approved Docker cleanup completed; exited containers and reclaimable image/build cache were pruned; no active service or volume was removed.
- E — `update_owner_priority.py` was removed after audit; it was untracked, so no deletion commit was possible. Provenance files and `package-lock.json` were preserved.
- F — owner-priority and safety boundaries remain recorded in this state file; no candidate content, secret, phone, JID, or raw message was added to telemetry.

### Runtime verification
- Only `now_os_backend` was recreated for the env correction.
- Container status: running/healthy, restart count zero.
- `healthz=200`, `readyz=200`.
- Connection Doctor: `inbound_queue_mode=dual_write`, `outbound_queue_mode=off`, `workers_enabled=false`, inbound shadow error rate zero.
- `receiving_degraded=true` with `no_inbound_confirmed_yet`; this is expected immediately after restart until a real inbound observation arrives, not a confirmed gateway failure.
- Evolution, PostgreSQL, WhatsApp session, cloaker, Cloudflare, webhook target, and database state were not changed.

### Current decision
- `dual_write` is active and observable.
- Production workers remain off pending the planned observation windows.
- No production behavior canary was armed and no real WhatsApp message was sent.

## Overnight Read-Only Checkpoint - 2026-08-12

- Local owner-success hardening is prepared for commit: deterministic owner-command replies now carry an explicit execution-success result, and owner/manager command replies pass through the same unbacked-success guard as legacy/model replies. Candidate replies remain unchanged.
- Focused guard tests pass (`5/5`) and the local TypeScript build passes. No production deploy was performed in this checkpoint.
- The historical approved-learning reduction from 105 to 5 is **kesin olarak aciklanamadi**. Runtime inspection found the current five-item file and older backup/analysis artifacts, but no authoritative deletion, archive, or reset record.
- The current VPS health and readiness endpoints returned 200; backend, Evolution, and PostgreSQL containers were running with restart count zero. Evolution connection state was not verified because the local read-only request received 401; no connection-state claim is made here.
- No candidate message, owner approval, canary activation, test-candidate reset, Evolution logout, or container recreation was performed by this checkpoint.

## Overnight Engineering Checkpoint - 2026-08-12

- Evolution/Baileys research: upstream issues report the same pairing/passkey, `Invalid buffer`, 515, 401/device-removed, and missing webhook symptoms. No confirmed fixed release for Evolution 2.3.7 was identified; no upgrade was performed.
- Reconnect protection: added an env-configurable 30-minute cooldown after three automatic reconnect attempts. The monitor exposes a sanitized cooldown timestamp and logs cooldown activation. Focused monitor tests pass.
- Full local verification: build PASS, full suite `685/685` PASS, `npm audit --omit=dev` reports `0 vulnerabilities`.
- Provenance helper still reports `PROVENANCE_VERIFIED=NO` because the local dist/source-tree artifact is stale or missing; this was not used to deploy and requires a separate build-artifact refresh before any deployment.
- Owner learning queue: no authoritative 2026-07-28 runtime log proving deletion/archive/reset was found; the reduction remains conclusively unexplained and is closed as an evidence gap.
- No live WhatsApp message, owner approval, canary activation, logout, pairing, Evolution recreate, backend deploy, or database change was performed in this checkpoint.
