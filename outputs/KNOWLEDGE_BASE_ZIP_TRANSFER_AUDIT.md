# Knowledge Base ZIP Transfer Audit

Date: 2026-08-14

This is an inventory only. No ZIP content was written to the knowledge bank.

## ZIP inventory

The owner ZIP contains four files:

- `00_OKU_BENI.txt`: package metadata, source-priority rule, package date, and the current training number.
- `01_NOW_AJANS_MASTER_EGITIM.md`: master flow, current application codes, training/group rules, important updates, and the remaining integration question.
- `02_META_AI_UST_TALIMAT.txt`: assistant role/tone, initial questions, eligibility, installation permission, application codes, profile/agency rules, group rules, and prohibitions.
- `03_TAM_BILGI_BANKASI_DUZ_METIN.txt`: the complete detailed bank, including meta/identity, classification, memory, eligibility, states, first contact, job model, installation permission, routing, application-specific setup, profile, training, message banks, privacy, payments, accounts/agency, ban/technical, security, follow-up, groups, escalation, legacy reference, checklist, tests, and open questions.

## Already present in `app_facts.md`

- General work model summary, workflow, non-guarantee earnings policy, payment timing, weekend rule, IBAN correction, and non-cancellable withdrawal rule.
- General setup flow: device-specific app, registration, profile, at least one photo, moon suffix, Now Ajans verification, evidence collection, and training gate.
- Per-app setup basics for Layla/NIVI, TanChat/TanStar, Amar/Amar Lite, Linky, Soyo, Timo, and Chatta.
- The seven-app table, platform names, codes, status, and basic notes.

## ZIP content not represented in `app_facts.md`

These are the concrete gaps requiring owner review before any write:

1. Source-priority and conflict-resolution rules, assistant identity, tone, response length, and the full message classification model.
2. Memory fields and the rule not to re-ask known information; the exact initial-question policy, including prior experience and the one-time refusal behavior.
3. Full eligibility policy: Turkish-language requirement, gender-specific age limits, daily-time guidance, fee-free rule, and the exact behavior when mandatory information is refused.
4. The complete conversation-state catalog and the explicit first-contact prohibition on app/code/setup/payment detail before basic information.
5. Job-definition details: phone visibility, multiple-app policy, account retention, time splitting, no-wait alternative-app rule, and per-app training separation.
6. Installation permission vocabulary: phrases that do not authorize setup versus phrases that explicitly authorize setup.
7. Routing matrix: messaging-only, voice/video, experienced-candidate, wants-new-app, secondary-app, overseas, and post-setup alternative rules.
8. App-independence rules prohibiting cross-application mixing of setup, codes, profile evidence, earnings, withdrawal limits, bans, and training.
9. Application-specific detail beyond the current basic rows: profile-rejection branches, approval retry timing, Data Center/Gelir Veri Kaydı handling, and each app's post-setup evidence requirements.
10. Code-integrity and setup-verification checklist, including one-message evidence requirements and the exact Now Ajans/profile/photo gates.
11. Profile, bio, moments, photo-quality, and content restrictions.
12. Training formats, completion requirements, candidate declaration, handoff behavior, and the detailed general/application-specific training topics.
13. Message banks: the 100 male first messages, 100 female profile bios, and 100 gift/interaction training suggestions. These must not be flattened into active policy without a separate delivery design.
14. Privacy and communication restrictions, candidate-violation sequence, and the rule for handling requests for off-platform contact.
15. Detailed payment handling: application-specific minimum/fee wording, rejected-withdrawal behavior, return-to-balance rule, amount-change rule, tax disclaimer, delay evidence collection, and old-account balance rules.
16. Account and agency rules: password/access recovery, single-agency rule, double-agency risk, agency exit, pause/return-later behavior.
17. Ban and technical support collection fields, retry matrices, security escalation evidence, and direct-management triggers.
18. Follow-up/closing timing, explicit-close phrases, abuse handling, repetitive-question handling, and no-permanent-block rule.
19. Group operations: read/learn scope, Istanbul schedule, `@Herkes` automation, answer priority, and avoid-answering rules. The automation is intentionally backlog-only and not active.
20. Manager-escalation trigger list and the explicit “never say owner/manager/team” wording rule.
21. Legacy reference-rate tables. These remain owner-review-only and must not enter active candidate replies.
22. The ZIP's test cases and the open technical integration question.

## App table gaps

| Field | Current state | Owner review needed |
|---|---|---|
| `official_url` | Empty for all seven rows | Official download/store URLs, if they are approved for candidate use |
| `invite_code` | Present for all seven rows where the ZIP defines one | Confirm whether each code is still current |
| `agency_bind_code` / `agency_code` | Amar and Soyo are represented; most others are blank | Confirm whether blank means “not applicable” or missing data |
| Android/iOS names | Present for all seven rows | Confirm spelling/locale variants |
| `notes` | Short routing notes only | Owner-approved per-app notes, retry/approval behavior, and evidence requirements |

The training phone in the ZIP is intentionally not copied: the current design uses owner-selected post-install handoff instead of a static candidate-facing number.

## Structured facts comparison

The repository has no tracked `data/knowledge_bank/app_facts_structured.json`; it is a generated runtime artifact. On the VPS runtime copy it exists and contains `general_work_model`, Timo, and Chatta, but the artifact is not a full mirror of the ZIP's detailed sections. The missing items above therefore remain missing from the structured consumer unless they are separately published.

## ZIP ingestion pipeline

`src/bridge/zipIngestion/` is live code, not dead code. `handleIncomingMessage.ts` imports routing and runs `runZipIngestionJob`; review routes expose jobs/candidates; tests cover the pipeline. The pipeline safely extracts owner/manager ZIP text, hashes the archive, rejects unsafe paths/encrypted/nested archives/unsafe binaries, creates `pending_owner_review` learning candidates, and explicitly leaves `knowledge_modified=false` and `publish_triggered=false`. It is therefore an intake/review pipeline, not an automatic app-facts merge. Owner review plus the separate bundle/activation publish path is required.

## Owner decision required

The list above is ready for review. No missing section was added to `app_facts.md` or structured facts in this change.
