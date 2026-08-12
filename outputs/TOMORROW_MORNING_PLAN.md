# Tomorrow Morning Plan

## 1. Connection Check

- Read `connectionState/nowakademi_bot` only; do not logout, pair, recreate, or send a WhatsApp message.
- Read `connection-doctor` and confirm `receiving_degraded`, recent inbound, and webhook health.
- Do not repeat pairing attempts while the instance is open or while the cooldown is active.

## 2. If Connection Is Still Unhealthy

- Preserve the current session and collect the Evolution/Baileys status code and error class.
- Review the known `Invalid buffer`, 515, and 401/device-removed evidence.
- Evaluate an Evolution upgrade only in isolated staging first; no production upgrade from this checklist.
- The upstream reports reviewed tonight do not identify a confirmed fixed release for the current pairing/passkey cohort.

## 3. If Connection Is Healthy

- Use `outputs/TOMORROW_LIVE_TEST_CHECKLIST.md` for the Terra allowlist test and the installation vision test.
- Obtain fresh owner approval only for the intended narrow canary scope.
- Keep outbound and candidate state changes within the approved test scope.

## 4. Operational Rule

- Never perform repeated rapid logout/pairing attempts. The reconnect circuit breaker now applies a 30-minute cooldown after three attempts.
