import { createCorrelationId } from "../observability/correlation.js";
import type { ChatType } from "../contracts/backendContextPayload.js";
import { createHash } from "node:crypto";

export interface NormalizedIncomingMessage {
  correlation_id: string;
  sender_id: string;
  phone_number: string;
  remote_jid: string;
  message_id: string;
  message_type: string;
  text: string;
  push_name?: string;
  chat_type: ChatType;
  is_from_me: boolean;
  is_group: boolean;
  received_at: string;
  media?: NormalizedMediaAttachment;
}

export interface NormalizedMediaAttachment {
  kind: "document" | "image" | "video" | "audio" | "unknown";
  mimetype: string;
  file_name: string;
  file_size?: number;
  caption: string;
  media_url?: string;
  download_url?: string;
  base64?: string;
}

export interface EvolutionPayloadShapeClassification {
  event_name: string;
  has_data: boolean;
  has_key: boolean;
  from_me: boolean | null;
  is_group: boolean;
  message_type: string;
  has_message_object: boolean;
  message_object_keys: string[];
  possible_text_paths_present: string[];
  normalized_text_length: number;
  normalized_text_hash: string | null;
  marker_detected: boolean;
  ignored_reason: string | null;
  event_class: "text_message" | "media_caption_message" | "delivery_or_read_receipt" | "from_me_outbound_echo" | "system_event" | "unsupported_message_type" | "real_message_text_path_missing" | "private_message_empty_payload";
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(getRecord)
    .filter((item) => Object.keys(item).length > 0);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function compactJidToPhone(jid: string): string {
  return jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = getString(value);
    if (found !== undefined && found.trim() !== "") {
      return found;
    }
  }
  return undefined;
}

function extractText(message: Record<string, unknown>, payload: Record<string, unknown>): string {
  const extendedTextMessage = getRecord(message.extendedTextMessage);
  const imageMessage = getRecord(message.imageMessage);
  const videoMessage = getRecord(message.videoMessage);
  const documentMessage = getRecord(message.documentMessage);

  return (
    firstString(
      message.conversation,
      extendedTextMessage.text,
      imageMessage.caption,
      videoMessage.caption,
      documentMessage.caption,
      payload.text,
      payload.message,
      payload.body
    ) ?? ""
  );
}

function nonEmptyRecord(...records: Record<string, unknown>[]): Record<string, unknown> {
  return records.find((record) => Object.keys(record).length > 0) ?? {};
}

function textHash(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function collectTextPaths(
  root: Record<string, unknown>,
  data: Record<string, unknown>,
  envelope: Record<string, unknown>,
  message: Record<string, unknown>,
): string[] {
  const extendedTextMessage = getRecord(message.extendedTextMessage);
  const imageMessage = getRecord(message.imageMessage);
  const videoMessage = getRecord(message.videoMessage);
  const documentMessage = getRecord(message.documentMessage);
  const rootMessage = getRecord(root.message);
  const rootExtendedTextMessage = getRecord(rootMessage.extendedTextMessage);

  const candidates: Array<[string, unknown]> = [
    ["data.message.conversation", message.conversation],
    ["data.message.extendedTextMessage.text", extendedTextMessage.text],
    ["data.message.imageMessage.caption", imageMessage.caption],
    ["data.message.videoMessage.caption", videoMessage.caption],
    ["data.message.documentMessage.caption", documentMessage.caption],
    ["data.body", data.body],
    ["body", root.body],
    ["text", root.text ?? data.text ?? envelope.text],
    ["message", root.message ?? data.message ?? envelope.message],
    ["message.conversation", rootMessage.conversation],
    ["message.extendedTextMessage.text", rootExtendedTextMessage.text],
  ];

  return candidates
    .filter(([, value]) => hasNonEmptyString(value))
    .map(([path]) => path);
}

function extractMedia(message: Record<string, unknown>, payload: Record<string, unknown>): NormalizedMediaAttachment | undefined {
  const documentMessage = getRecord(message.documentMessage);
  const imageMessage = getRecord(message.imageMessage);
  const videoMessage = getRecord(message.videoMessage);
  const audioMessage = getRecord(message.audioMessage);
  const source =
    Object.keys(documentMessage).length > 0
      ? { kind: "document" as const, record: documentMessage }
      : Object.keys(imageMessage).length > 0
        ? { kind: "image" as const, record: imageMessage }
        : Object.keys(videoMessage).length > 0
          ? { kind: "video" as const, record: videoMessage }
          : Object.keys(audioMessage).length > 0
            ? { kind: "audio" as const, record: audioMessage }
            : undefined;

  const payloadBase64 = firstString(payload.base64, payload.mediaBase64);
  if (!source && !payloadBase64) {
    return undefined;
  }

  const record = source?.record ?? {};
  const fileSize = getNumber(record.fileLength) ?? getNumber(record.fileSize) ?? getNumber(payload.fileSize);
  return {
    kind: source?.kind ?? "unknown",
    mimetype: firstString(record.mimetype, payload.mimetype) ?? "",
    file_name: firstString(record.fileName, payload.fileName, payload.filename) ?? "",
    ...(fileSize !== undefined ? { file_size: fileSize } : {}),
    caption: firstString(record.caption, payload.caption) ?? "",
    ...(firstString(record.url, record.mediaUrl, payload.mediaUrl) ? { media_url: firstString(record.url, record.mediaUrl, payload.mediaUrl) } : {}),
    ...(firstString(record.downloadUrl, payload.downloadUrl) ? { download_url: firstString(record.downloadUrl, payload.downloadUrl) } : {}),
    ...(payloadBase64 ? { base64: payloadBase64 } : {})
  };
}

function receivedAtFromTimestamp(value: unknown): string {
  const timestamp = getNumber(value);
  if (timestamp === undefined) {
    return new Date().toISOString();
  }

  const millis = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(millis).toISOString();
}

export function normalizeEvolutionMessage(payload: unknown): NormalizedIncomingMessage {
  const root = getRecord(payload);
  const data = getRecord(root.data);
  const messages = getRecordArray(data.messages);
  const envelope = messages[0] ?? data;
  const key = nonEmptyRecord(getRecord(envelope.key), getRecord(data.key), getRecord(root.key));
  const message = nonEmptyRecord(getRecord(envelope.message), getRecord(data.message), getRecord(root.message));

  const remoteJid = firstString(key.remoteJid, envelope.remoteJid, data.remoteJid, root.remoteJid) ?? "";
  const participant = firstString(key.participant, envelope.participant, data.participant, root.participant);
  const isGroup = remoteJid.includes("@g.us");
  const chatType: ChatType = isGroup ? "group" : "private";
  const senderJid = isGroup ? participant ?? remoteJid : remoteJid;
  const phoneNumber = compactJidToPhone(senderJid);
  const messageId = firstString(key.id, envelope.id, data.id, root.id, root.messageId) ?? createCorrelationId();
  const messageType = firstString(envelope.messageType, data.messageType, root.messageType, root.event) ?? "text";
  const text = extractText(message, { ...root, ...data, ...envelope }).trim();
  const media = extractMedia(message, { ...root, ...data, ...envelope });
  const pushName = firstString(envelope.pushName, data.pushName, root.pushName, root.push_name);
  const fromMe =
    getBoolean(key.fromMe) ?? getBoolean(envelope.fromMe) ?? getBoolean(data.fromMe) ?? getBoolean(root.fromMe) ?? false;

  return {
    correlation_id: createCorrelationId(),
    sender_id: phoneNumber,
    phone_number: phoneNumber,
    remote_jid: remoteJid,
    message_id: messageId,
    message_type: messageType,
    text,
    ...(pushName ? { push_name: pushName } : {}),
    chat_type: chatType,
    is_from_me: fromMe,
    is_group: isGroup,
    received_at: receivedAtFromTimestamp(
      envelope.messageTimestamp ?? data.messageTimestamp ?? root.messageTimestamp ?? root.timestamp
    ),
    ...(media ? { media } : {})
  };
}

export function classifyEvolutionPayloadShape(
  payload: unknown,
  normalized?: NormalizedIncomingMessage,
): EvolutionPayloadShapeClassification {
  const root = getRecord(payload);
  const data = getRecord(root.data);
  const messages = getRecordArray(data.messages);
  const envelope = messages[0] ?? data;
  const key = nonEmptyRecord(getRecord(envelope.key), getRecord(data.key), getRecord(root.key));
  const message = nonEmptyRecord(getRecord(envelope.message), getRecord(data.message), getRecord(root.message));
  const remoteJid = firstString(key.remoteJid, envelope.remoteJid, data.remoteJid, root.remoteJid) ?? normalized?.remote_jid ?? "";
  const isGroup = remoteJid.includes("@g.us");
  const fromMe = getBoolean(key.fromMe) ?? getBoolean(envelope.fromMe) ?? getBoolean(data.fromMe) ?? getBoolean(root.fromMe) ?? normalized?.is_from_me ?? null;
  const messageType = firstString(envelope.messageType, data.messageType, root.messageType, root.event, normalized?.message_type) ?? "unknown";
  const eventName = firstString(root.event, data.event, envelope.event, root.eventName) ?? "unknown";
  const text = normalized?.text ?? extractText(message, { ...root, ...data, ...envelope }).trim();
  const possibleTextPaths = collectTextPaths(root, data, envelope, message);
  const hasMessageObject = Object.keys(message).length > 0;
  const messageObjectKeys = Object.keys(message).sort().slice(0, 20);
  const markerDetected = /SMOKE3D-|SMOKE2B|OWNER TRACE|BOT TRACE|INBOUND CONFIRM/i.test(text);

  let eventClass: EvolutionPayloadShapeClassification["event_class"] = "private_message_empty_payload";
  if (fromMe === true) eventClass = "from_me_outbound_echo";
  else if (/receipt|ack|status|presence|connection|update/i.test(`${eventName} ${messageType}`)) eventClass = "delivery_or_read_receipt";
  else if (/protocolMessage|senderKeyDistributionMessage|reactionMessage|pollUpdateMessage/i.test(messageType) || messageObjectKeys.some((keyName) => /protocolMessage|senderKeyDistributionMessage|reactionMessage|pollUpdateMessage/i.test(keyName))) eventClass = "system_event";
  else if (text.trim() !== "") eventClass = possibleTextPaths.some((path) => /caption/i.test(path)) ? "media_caption_message" : "text_message";
  else if (hasMessageObject) eventClass = possibleTextPaths.length === 0 ? "real_message_text_path_missing" : "unsupported_message_type";

  const ignoredReason =
    text.trim() !== ""
      ? null
      : fromMe === true
        ? "from_me_outbound_echo"
        : eventClass === "delivery_or_read_receipt" || eventClass === "system_event"
          ? eventClass
          : hasMessageObject
            ? "text_path_missing_or_unsupported_message_type"
            : "private_message_empty_payload";

  return {
    event_name: eventName,
    has_data: Object.keys(data).length > 0,
    has_key: Object.keys(key).length > 0,
    from_me: fromMe,
    is_group: isGroup,
    message_type: messageType,
    has_message_object: hasMessageObject,
    message_object_keys: messageObjectKeys,
    possible_text_paths_present: possibleTextPaths,
    normalized_text_length: text.trim().length,
    normalized_text_hash: textHash(text),
    marker_detected: markerDetected,
    ignored_reason: ignoredReason,
    event_class: eventClass,
  };
}
