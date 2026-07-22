# Quality Pack 1 Live Conversation Mining - Sanitized

Generated: 2026-07-22

Scope: read-only mining from production `now-os-store.json`, backend logs, and existing sanitized WhatsApp learning imports. No phone numbers, JIDs, names, tokens, raw IDs, or secrets are included here.

## Summary

- A) Parrot/repeated bot reply: 4 sanitized observations found.
- A) Candidate-scope observations converted to regression tests: 2.
- B) Re-asking known candidate info after it was provided: 0 usable live examples found.
- C) Generic job-definition answer missing app/policy specifics: 0 usable live examples found.
- D) Owner tone/jargon override ignored: 0 usable live examples found.

Quality Pack 1 live conversion is partial: 2/10 real golden assertions were added. No synthetic examples were created.

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
