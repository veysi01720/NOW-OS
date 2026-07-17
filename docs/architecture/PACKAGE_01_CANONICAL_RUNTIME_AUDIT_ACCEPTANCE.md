# Package 01 - Canonical Runtime Audit Acceptance

## Package Result

- Package id: `PACKAGE-01`
- Package name: `Canonical Runtime Audit`
- Status: `COMPLETE_WITH_TRACKED_FINDINGS`
- Production mutation: `NO`
- Source code mutation: `NO`
- Documentation-only closeout: `YES`
- Ready for owner acceptance: `YES`

## Scope Completed

- Local workspace duplication was inventoried.
- Read-only VPS access was verified.
- Canonical source root was verified.
- Compose project, service, container, command and port were verified.
- Health and readiness were verified.
- Running image id and container id were recorded.
- Key host/container hashes were compared.
- Source-ahead and image-missing files were identified.
- Evolution instance, state, webhook target and event subscription were verified.
- Active feature-flag defaults were verified.
- Candidate, owner/manager and group decision routes were mapped.
- The active outbound owner was identified.
- Recent runtime event counts were sanitized and classified.
- VPS duplicate sender evidence was checked.
- Local duplicate runtime and credential-equivalence risk was classified.
- Build provenance gaps were recorded.

## Definition Of Done

| Gate | Result | Evidence |
| --- | --- | --- |
| Canonical source identified | `PASS` | `/root/deploy_package/now_os_backend` |
| Canonical runtime identified | `PASS` | VPS `now_os_backend` |
| Runtime command identified | `PASS` | `node dist/server.js` |
| Source/image baseline recorded | `PASS` | image and file hashes |
| Active decision path identified | `PASS` | V2 Assistants path |
| Responses production use classified | `PASS` | not active |
| Active outbound owner identified | `PASS` | `EvolutionApiSender` |
| Evolution binding verified | `PASS` | open instance and canonical webhook |
| Duplicate VPS sender found | `NO` | container/process/port audit |
| Local runtime risk classified | `PASS` | non-canonical, currently fail-closed |
| Secrets or raw PII logged | `NO` | sanitized inspection |
| Production changed | `NO` | read-only package |

## Tracked Findings

### P1-F01 - Build provenance is not authoritative

- Severity: `HIGH`
- Evidence: no Git repository, source/package image labels are `unknown`, and the
  stored deployment manifest references an older image.
- Impact: a source tree cannot be reliably tied to a running image without
  explicit hashes.
- Required follow-up: build provenance hardening before the first new deploy.

### P1-F02 - Canonical source is ahead of production

- Severity: `MEDIUM`
- Evidence: six host-only source files and one changed test are not in the
  running image.
- Impact: source inspection alone can misreport production capabilities.
- Required follow-up: preserve this delta and decide it only in the Responses
  foundation package.

### P1-F03 - Local duplicate runtimes remain active

- Severity: `HIGH`
- Evidence: local backend, legacy bridge, assistant API, RAG API and n8n are
  running.
- Impact: wrong-runtime testing, accidental model calls and operator confusion.
- Required follow-up: `PACKAGE-01B Local Runtime Quarantine` before implementation.

### P1-F04 - Local backend shares production OpenAI binding

- Severity: `HIGH`
- Evidence: OpenAI key and Assistant binding equality was confirmed without
  printing their values.
- Impact: accidental quota use and calls through a non-canonical workspace.
- Required follow-up: remove active production binding from local runtime during
  Package 01B. Preserve credential history and rollback evidence.

### P1-F05 - Inbound receiving is degraded

- Severity: `MEDIUM`
- Evidence: gateway is reachable but recent inbound observation is absent.
- Impact: live canary and WhatsApp smoke are not currently reliable acceptance
  gates.
- Required follow-up: reliability observation before any live canary.

### P1-F06 - V1 and V2 decision contracts coexist

- Severity: `MEDIUM`
- Evidence: candidate traffic uses Conversation Decision V2 while general
  owner/manager traffic uses Assistant Response Contract V1.
- Impact: divergent behavior and validation paths.
- Required follow-up: Package 02 Architecture Ownership Seal and staged Responses
  migration.

### P1-F07 - Stale VPS Cloudflare-to-5678 process

- Severity: `LOW`
- Evidence: Cloudflare targets localhost `5678` while no VPS service listens on
  that port.
- Impact: operational ambiguity and unnecessary process footprint.
- Required follow-up: dependency audit and later legacy cleanup. Do not remove in
  Package 1.

## Protected Assets

The following assets were not changed and remain protected:

- `now_os_backend`
- `nowakademi_evolution`
- `nowakademi_db`
- PostgreSQL volume
- WhatsApp session and instance
- canonical webhook
- production state and conversation history
- `data/runtime.lock`
- `data/now-os-store.json`
- the running rollback-capable image
- source-only Responses/V3 work

## Package Boundary

Package 1 is an audit and baseline package. It does not fix findings, stop local
services, change credentials, rebuild images or deploy source. Mixing those
actions into this package would destroy the value of the captured baseline.

## Required Next Sequence

1. Owner accepts Package 1 closeout.
2. Run Package 01B Local Runtime Quarantine without deletion.
3. Run Package 02 Architecture Ownership Seal.
4. Harden build provenance before the first code-bearing production deploy.
5. Begin Responses foundation only after the ownership seal is accepted.

## Acceptance Decision

`PACKAGE_01_STATUS=COMPLETE_WITH_TRACKED_FINDINGS`

The package is complete because all unknown runtime ownership questions in its
scope were either verified or converted into explicit, assigned findings. The
findings are blockers for later canary/deploy work, not failures of the audit.

