import { createHash } from "node:crypto";
import type { NormalizedMediaAttachment } from "./normalizeEvolutionMessage.js";

export const INSTALLATION_VERIFICATION_MAX_BYTES = 2 * 1024 * 1024;
export const INSTALLATION_VERIFICATION_TTL_MS = 60 * 60 * 1000;

export type InstallationVerificationStatus = "clear" | "ambiguous";

export interface InstallationVerificationClassifierInput {
  buffer: Buffer;
  mimetype: string;
  file_name: string;
  caption: string;
}

export interface InstallationVerificationClassifierResult {
  status: InstallationVerificationStatus;
  sanitized_result: string;
}

export interface InstallationVerificationResult {
  status: InstallationVerificationStatus;
  media_sha256: string;
  media_size: number;
  media_type: string;
  sanitized_result: string;
  expires_at: string;
}

export type InstallationVerificationClassifier = (
  input: InstallationVerificationClassifierInput,
) => InstallationVerificationClassifierResult | Promise<InstallationVerificationClassifierResult>;

function decodeBase64(value: string): Buffer {
  const payload = value.replace(/^data:[^;]+;base64,/u, "");
  return Buffer.from(payload, "base64");
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function ambiguousResult(
  media: NormalizedMediaAttachment,
  buffer: Buffer,
  now: number,
  reason: string,
): InstallationVerificationResult {
  return {
    status: "ambiguous",
    media_sha256: sha256(buffer),
    media_size: buffer.length,
    media_type: media.mimetype,
    sanitized_result: reason,
    expires_at: new Date(now + INSTALLATION_VERIFICATION_TTL_MS).toISOString(),
  };
}

/**
 * Raw bytes exist only for the duration of this call. The returned object is
 * metadata and sanitized classifier output; it never contains the source bytes.
 */
export async function verifyInstallationMedia(input: {
  media: NormalizedMediaAttachment;
  now: number;
  classifier?: InstallationVerificationClassifier;
}): Promise<InstallationVerificationResult> {
  if (!input.media.base64) {
    return ambiguousResult(input.media, Buffer.alloc(0), input.now, "MEDIA_BYTES_MISSING");
  }

  const buffer = decodeBase64(input.media.base64);
  if (buffer.length === 0) {
    return ambiguousResult(input.media, buffer, input.now, "MEDIA_BYTES_EMPTY");
  }
  if (buffer.length > INSTALLATION_VERIFICATION_MAX_BYTES || (input.media.file_size ?? 0) > INSTALLATION_VERIFICATION_MAX_BYTES) {
    return ambiguousResult(input.media, buffer, input.now, "MEDIA_SIZE_EXCEEDED");
  }

  const classifier = input.classifier;
  const classified = classifier
    ? await classifier({
        buffer,
        mimetype: input.media.mimetype,
        file_name: input.media.file_name,
        caption: input.media.caption,
      })
    : { status: "ambiguous" as const, sanitized_result: "VISION_CLASSIFIER_NOT_CONFIGURED" };

  return {
    status: classified.status,
    media_sha256: sha256(buffer),
    media_size: buffer.length,
    media_type: input.media.mimetype,
    sanitized_result: classified.sanitized_result.slice(0, 240),
    expires_at: new Date(input.now + INSTALLATION_VERIFICATION_TTL_MS).toISOString(),
  };
}
