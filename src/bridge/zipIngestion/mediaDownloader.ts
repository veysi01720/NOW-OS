import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import type { EnvConfig } from "../../config/env.js";
import type { NormalizedMediaAttachment } from "../normalizeEvolutionMessage.js";

export interface MediaDownloadResult {
  buffer: Buffer;
  source: "base64" | "url";
}

export class MediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaDownloadError";
  }
}

export async function downloadEvolutionMedia(input: {
  attachment: NormalizedMediaAttachment;
  env: EnvConfig;
  timeoutMs: number;
  maxRetries: number;
  maxBytes: number;
}): Promise<MediaDownloadResult> {
  if (input.attachment.base64) {
    const clean = input.attachment.base64.includes(",")
      ? input.attachment.base64.split(",").pop() ?? ""
      : input.attachment.base64;
    const buffer = Buffer.from(clean, "base64");
    if (buffer.length > input.maxBytes) {
      throw new MediaDownloadError("ZIP_TOO_LARGE");
    }
    return { buffer, source: "base64" };
  }

  const url = input.attachment.media_url ?? input.attachment.download_url;
  if (!url) {
    throw new MediaDownloadError("MEDIA_DOWNLOAD_SOURCE_MISSING");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          apikey: input.env.evolutionApiKey
        }
      });
      if (!response.ok) {
        throw new MediaDownloadError(`MEDIA_DOWNLOAD_HTTP_${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length > input.maxBytes) {
        throw new MediaDownloadError("ZIP_TOO_LARGE");
      }
      return { buffer, source: "url" };
    } catch (error) {
      lastError = error;
      if (attempt < input.maxRetries) {
        await delay(150);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new MediaDownloadError("MEDIA_DOWNLOAD_FAILED");
}
