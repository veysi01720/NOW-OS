# Human Handoff Escalation Mapping

This is a policy/design mapping only. It does not enable automatic WhatsApp
notifications.

## Triggers

- Different agency is visible.
- The second approved-code attempt still does not show Now Ajans.
- App ban or repeated app access failure.
- Payment is older than three business days.
- Repeated communication or IBAN policy violation.
- Harassment, threat, blackmail, fraud suspicion, or personal safety risk.
- A second appropriate profile photo is rejected.
- The candidate cannot add the required username marker.
- An app-specific technical issue remains unclear after the documented retry.

## Handoff record

Create a deduplicated handoff record with a sanitized reason code, urgency,
tenant, conversation hash, correlation id, and audit timestamps. Raw phone,
JID, message text, and secrets are not written to logs.

## Candidate-facing rule

The bot must not say that it is asking the owner, manager, or team. It gives
the safe next step and continues only with verified information. Internal
handoff remains an operator-facing action.

## Notification state

The current notification default remains disabled. Enabling owner WhatsApp
notifications requires a separate approval and deployment decision.
