# Morning Status - 2026-08-16

## Current state

- Terra/Responses is the global model route; V2/Assistants is retired from active traffic.
- Stage-based policy context is active for intake, app selection, and installation.
- Owner knowledge transfer uses `#bilgi`, `#bekleyenler`, `#onayla <ID>`, and `#uygula`; training content remains separate from candidate context.
- The last deployed source was `58acd65`. A narrow prompt hardening change is prepared locally for app-selection state capture; it is not deployed yet.

## Advertising readiness

**Not ready to declare.** Backend health/readiness checks pass and no `provider_unavailable` events were found in the last 24 hours, but WhatsApp connection authentication returned 401 during the read-only check and the last real Terra chain had one app-selection variance in five runs. Connection/session state and the post-deploy regression corpus must be revalidated before advertising.

## First three morning actions

1. Deploy the prepared app-selection prompt hardening through the P0 gate, without touching Evolution.
2. Run the no-outbound real Terra regression corpus at least five times per behavior and record every failure, especially app-selection state patches.
3. Verify the Evolution API key/session with the correct operational credential and confirm `open` without logout or pairing retries; then run the controlled owner visual-flow test.

## Known risks

- Evolution 2.3.7 has the known pairing-notification `Invalid buffer` / 515 / 401 instability; repeated logout/pairing attempts are prohibited.
- Real model variance can produce a semantically good app answer without a state patch; the new prompt contract addresses this but needs live no-outbound evidence.
- Runtime knowledge is the production source of truth and intentionally can differ from the Git template; backup, manifest, and startup guard checks are the deploy gate.
- Full regression coverage must include typos, policy grounding, owner escalation, visual owner approval, and exclusion of training content from candidate context.
