# Emergency Rollback Runbook

## Behavior Rollback

Set behavior orchestration off:

```text
BEHAVIOR_ORCHESTRATOR_ENABLED=false
```

This returns traffic to the legacy behavior path without DB rollback.

## Queue Rollback

- Disable queue-only.
- Disable production workers.
- Keep or return to legacy sync handling.
- Leave shadow writes disabled or observational only.

## Fast ACK Rollback

Set fast ACK off and confirm upstream receives the legacy response after processing.

## Worker Rollback

Stop production workers and keep shadow queues for diagnosis only.

## Knowledge Publish Rollback

Use the publish snapshot and binding rollback process. Do not edit active knowledge manually during an incident.

## Webhook Or Session Problems

Use connection doctor and gateway logs first. Confirm reachability and session state before changing anything.

## Hard No-Go Actions

Do not perform these during emergency rollback:

- DB reset
- Evolution instance deletion
- New instance creation
- Random webhook target changes
- Production knowledge deletion
- Secret or token logging
- Raw phone or raw JID logging
- Raw group identifier logging
- Raw text or full prompt logging
