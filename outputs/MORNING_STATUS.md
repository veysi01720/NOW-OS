# Morning Status - 2026-08-16

## Current state

- Terra/Responses is the global model route; V2/Assistants is retired from active traffic.
- Stage-based policy context is active for intake, app selection, and installation.
- Owner knowledge transfer uses `#bilgi`, `#bekleyenler`, `#onayla <ID>`, and `#uygula`; training content remains separate from candidate context.
- The last deployed source was `19d254b`. App-selection and phone-type state capture both reached `5/5` in the post-deploy real Terra chain.

## Advertising readiness

**Not ready to declare.** Backend health/readiness checks pass, startup guard is valid, npm audit is clean, and the real Terra intake chain is `5/5`. WhatsApp connection authentication still returned 401 during the read-only check, so the new line/session must be verified before advertising.

## First three morning actions

1. Resolve the Evolution API credential/session read-only check and confirm `open` without logout or pairing retries.
2. Run the remaining independent candidate-policy corpus (payment, profile, security boundary, off-topic, installation and visual owner approval) at least five times each with dedicated assertions.
3. Run the controlled owner visual-flow test; verify owner approval is required and no raw image is persisted.

## Known risks

- Evolution 2.3.7 has the known pairing-notification `Invalid buffer` / 515 / 401 instability; repeated logout/pairing attempts are prohibited.
- The real chain now covers the model state-patch contract at `5/5`; independent policy corpus coverage remains to be collected.
- Runtime knowledge is the production source of truth and intentionally can differ from the Git template; backup, manifest, and startup guard checks are the deploy gate.
- Full regression coverage must include typos, policy grounding, owner escalation, visual owner approval, and exclusion of training content from candidate context.
