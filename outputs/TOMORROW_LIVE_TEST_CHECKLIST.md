# Tomorrow Live Test Checklist

This checklist is operational only. Run it only with the owner's explicit live-test decision. Do not reset a candidate state or arm approval from an unattended session.

## Terra Allowlist Test

1. Confirm the intended test number is already in `MODEL_ADAPTER_CANARY_ALLOWED_CANDIDATES`; never print it in logs or reports.
2. Confirm `MODEL_ADAPTER_LAYER_ENABLED=true`, the canary approval is valid, and its intent scope is limited to `greeting_or_first_contact` and `candidate_first_contact`.
3. In one private test conversation send `Selam iş için yazıyorum`.
4. Verify the normalized, route-selection, and canary-decision events share one sanitized correlation id.
5. Verify both pre-dispatch and model-execution decisions report `use_adapter_layer=true`, independent of the percentage bucket.
6. Verify the configured Terra/Responses adapter is selected, exactly one outbound is confirmed, and all safety counters remain zero.
7. Stop on an unsafe claim, scope violation, duplicate outbound, approval mismatch, or egress guard. Do not retry live traffic automatically.

Success criteria: Terra is selected at both decision points; sender, channel, and intent scope are correct; one safe private response is delivered; no raw phone, JID, prompt, model output, secret, or PII is logged; the persistent 20-event window records the event.

## Installation Vision Test

1. Confirm the narrow vision flag and allowlist are enabled only for the intended test number.
2. Starting from the owner-approved fresh test state, send `Merhaba iş için yazıyorum`.
3. Answer age, gender, and daily-hours intake fields with owner-approved values. For the female branch answer the experience question; for the male branch keep the three-field path.
4. Accept the grounded work-model explanation, select an approved application such as `Layla`, and confirm the selection.
5. Verify the state reaches `INSTALLATION_IN_PROGRESS` before sending media.
6. Send one clear installation screenshot. Expect sanitized classifier metadata only, `TRAINING_READY`, and the post-install training gate.
7. Send one intentionally ambiguous/incomplete screenshot. Expect no state advance and an `installation_verification_ambiguous` handoff.
8. Verify no raw image bytes, base64, image path, PII-bearing OCR text, phone number, JID, or secret appears in logs or persistent storage.

Success criteria: only the allowlisted candidate reaches vision; the clear case reaches `TRAINING_READY`; the ambiguous case remains fail-closed and creates a handoff; raw media is absent from logs and disk.
