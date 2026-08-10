# Image Verification Design

## Scope

Accept an incoming screenshot only when the candidate is in an installation-verification state and the message is private. Images received outside that state remain on the existing media-stripping path.

## Memory Safety

Keep `stripMediaBase64` as the default. Add a narrowly scoped, size-limited exception for installation verification: reject oversized payloads before decoding, process one image at a time, avoid retaining base64 in conversation state, and release buffers after classification. Use a short processing TTL and reject unsupported formats.

## Review Model

The owner-provided requirement implies verification of a setup screenshot, not unrestricted visual conversation. The first version should use a bounded vision/OCR classification to extract only a sanitized verification result. Ambiguous or failed classifications must create a human handoff for owner/manager review; the model must not invent a setup completion.

## Storage and Privacy

Prefer no durable image storage. Keep only a sanitized result, content hash, dimensions, media type, correlation reference, and retention expiry. If temporary storage is technically required, use an encrypted private runtime directory, strict file permissions, a short TTL, and guaranteed cleanup. Do not log raw media, base64, filenames containing personal data, phone numbers, or OCR text.

## Acceptance Gates

- State, private-chat, media-type, and size gates pass before image processing.
- Raw media is absent from logs and conversation state.
- Processing failure is fail-closed and creates a reviewable handoff.
- No setup state transition occurs without a validated result.
- Feature remains disabled until owner approval and no-outbound acceptance pass.
