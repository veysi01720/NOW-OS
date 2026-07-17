import type { NormalizedIncomingMessage, NormalizedMediaAttachment } from "../normalizeEvolutionMessage.js";

export interface ZipRoutingDecision {
  document_message_detected: boolean;
  zip_candidate_detected: boolean;
  caption_prefix_detected: boolean;
  sender_authorized: boolean;
  unsupported_archive_detected: boolean;
}

export function isZipAttachment(attachment: NormalizedMediaAttachment | undefined): boolean {
  if (!attachment) return false;
  const filename = attachment.file_name.toLowerCase();
  const mimetype = attachment.mimetype.toLowerCase();
  return (
    filename.endsWith(".zip") ||
    mimetype === "application/zip" ||
    mimetype === "application/x-zip-compressed" ||
    (mimetype === "application/octet-stream" && filename.endsWith(".zip"))
  );
}

export function isUnsupportedArchive(attachment: NormalizedMediaAttachment | undefined): boolean {
  if (!attachment) return false;
  const filename = attachment.file_name.toLowerCase();
  const mimetype = attachment.mimetype.toLowerCase();
  return (
    filename.endsWith(".rar") ||
    filename.endsWith(".7z") ||
    filename.endsWith(".exe") ||
    filename.endsWith(".apk") ||
    mimetype.includes("x-rar") ||
    mimetype.includes("x-7z") ||
    mimetype.includes("application/vnd.android.package")
  );
}

export function hasZipPrefix(text: string): boolean {
  return text.trim().toLowerCase().startsWith("#zip");
}

export function detectZipRouting(input: {
  message: NormalizedIncomingMessage;
  senderRole: string;
}): ZipRoutingDecision {
  const attachment = input.message.media;
  const document = attachment?.kind === "document";
  return {
    document_message_detected: document,
    zip_candidate_detected: isZipAttachment(attachment),
    caption_prefix_detected: hasZipPrefix(input.message.text),
    sender_authorized: input.senderRole === "owner" || input.senderRole === "manager",
    unsupported_archive_detected: isUnsupportedArchive(attachment)
  };
}
