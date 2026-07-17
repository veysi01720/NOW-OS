import { randomBytes, createHash } from "node:crypto";
import {
  NormalizedPlatformMessage,
  SupportedPlatform,
  SourceType,
  MessageDirection,
  ManualImportRow
} from "./types.js";

// Helper to generate a safe persistent reference (e.g., SRC-1A2B3C)
export function generateSafeRef(prefix: string): string {
  const bytes = randomBytes(4); // 8 hex chars
  return `${prefix}-${bytes.toString("hex").toUpperCase().slice(0, 6)}`;
}

// Scrubber to remove full phone numbers, tokens, api keys, and internal notes
export function sanitizeText(text: string): string {
  let sanitized = text;

  // Mask full phone numbers (e.g., +1234567890, +90 555 123 45 67)
  // Replaces the middle digits to keep the text readable but private
  sanitized = sanitized.replace(/\+?\d{1,4}[-.\s]?\(?\d{2,3}\)?[-.\s]?\d{3}[-.\s]?\d{2,4}/g, (match) => {
    return match.substring(0, 4) + "****" + match.substring(match.length - 2);
  });

  // Scrub typical tokens, keys, secrets (bearer, api_key, etc.)
  sanitized = sanitized.replace(/(bearer|token|api_key|secret|password|sess)\s*[:=]\s*[a-zA-Z0-9\-_.]+/gi, "$1=***");

  // Scrub URL query params that look like tokens or secrets
  sanitized = sanitized.replace(/([?&](token|key|auth|sig|session)=)[^&\s]+/gi, "$1***");

  // Completely scrub internal_boss_note if present
  sanitized = sanitized.replace(/internal_boss_note[\s\S]*?(?=\n|$)/gi, "[REDACTED_INTERNAL_NOTE]");

  return sanitized.trim();
}

// Light deterministic intent detection
export function detectIntentsLight(text: string): string[] {
  const intents: string[] = [];
  const lower = text.toLowerCase();

  if (lower.includes("yardım") || lower.includes("destek") || lower.includes("help") || lower.includes("sorun")) {
    intents.push("support_signal");
  }
  if (lower.includes("kurulum") || lower.includes("yükle") || lower.includes("install") || lower.includes("uygulama") || lower.includes("app")) {
    intents.push("installation_question");
  }
  if (lower.includes("para") || lower.includes("ödeme") || lower.includes("maaş") || lower.includes("ücret") || lower.includes("güven") || lower.includes("scam") || lower.includes("dolandırıcı")) {
    intents.push("payment_or_trust_question");
  }
  if (lower.includes("eğitim") || lower.includes("nasıl") || lower.includes("video") || lower.includes("öğren")) {
    intents.push("training_question");
  }
  if (lower.includes("yasak") || lower.includes("ban") || lower.includes("kural") || lower.includes("ihlal")) {
    intents.push("rule_violation_signal");
  }

  if (intents.length === 0) {
    intents.push("unknown");
  }

  return intents;
}

// Builds a completely raw-identifier-free deduplication key
export function buildNormalizedMessageDedupKey(msg: NormalizedPlatformMessage): string {
  // Use timestamp bucket (e.g., minute level) to absorb minor clock drift
  let timeBucket = "unknown";
  if (msg.timestamp) {
    try {
      const d = new Date(msg.timestamp);
      if (!isNaN(d.getTime())) {
        // Round to nearest minute
        d.setSeconds(0, 0);
        timeBucket = d.toISOString();
      }
    } catch {
      // ignore
    }
  }

  const payload = [
    msg.platform,
    msg.source_safe_ref,
    msg.sender_safe_ref,
    timeBucket,
    msg.message_text_sanitized,
    msg.external_context_hash ?? "none"
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

function parsePlatform(val: string | undefined): SupportedPlatform {
  if (!val) return "unknown";
  const lower = val.toLowerCase();
  if (["whatsapp", "telegram", "instagram", "tiktok", "manual_csv", "manual_json"].includes(lower)) {
    return lower as SupportedPlatform;
  }
  return "unknown";
}

function parseSourceType(val: string | undefined): SourceType {
  if (!val) return "unknown";
  const lower = val.toLowerCase();
  if (["private_chat", "group", "channel", "comment", "dm", "export_file"].includes(lower)) {
    return lower as SourceType;
  }
  return "unknown";
}

function parseDirection(val: string | undefined): MessageDirection {
  if (!val) return "unknown";
  const lower = val.toLowerCase();
  if (lower === "inbound" || lower === "outbound") {
    return lower as MessageDirection;
  }
  return "unknown";
}

function generateContextHash(rawId: string | undefined): string | undefined {
  if (!rawId || rawId.trim() === "") return undefined;
  return createHash("sha256").update(rawId).digest("hex");
}

function sanitizeLabel(label: string | undefined): string | undefined {
  if (!label || label.trim() === "") return undefined;
  return label.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 50).toLowerCase();
}

// A simple dictionary to store mapping between raw IDs and safe refs in memory
// In a real database, this would be persisted to avoid collisions or re-mapping.
// For SPEC-025A, we simulate it.
class SafeRefMapper {
  private idToSafeRef = new Map<string, string>();
  private safeRefs = new Set<string>();

  getOrCreate(prefix: string, rawId: string | undefined): string {
    if (!rawId || rawId.trim() === "") {
      return generateSafeRef(prefix);
    }
    const key = `${prefix}:${rawId}`;
    if (this.idToSafeRef.has(key)) {
      return this.idToSafeRef.get(key)!;
    }
    
    // Collision guard
    let safe: string;
    let attempts = 0;
    do {
      safe = generateSafeRef(prefix);
      attempts++;
    } while (this.safeRefs.has(safe) && attempts < 10);
    
    this.safeRefs.add(safe);
    this.idToSafeRef.set(key, safe);
    return safe;
  }
}

const mapper = new SafeRefMapper();

function rowToNormalized(row: ManualImportRow, batchRef: string): NormalizedPlatformMessage | null {
  const text = row.message?.trim() || "";
  if (!text) return null; // Reject empty

  const platform = parsePlatform(row.platform);
  const sourceType = parseSourceType(row.source_type);
  const direction = parseDirection(row.direction);
  const timestamp = row.timestamp || new Date().toISOString();

  const sanitizedText = sanitizeText(text);

  return {
    platform,
    source_type: sourceType,
    source_safe_ref: mapper.getOrCreate("SRC", row.source_id),
    sender_safe_ref: mapper.getOrCreate("SND", row.sender_id),
    sender_role_hint: direction === "outbound" ? "operator" : "candidate",
    message_text_sanitized: sanitizedText,
    timestamp,
    direction,
    attachments_meta_sanitized: [],
    detected_intents: detectIntentsLight(sanitizedText),
    risk_flags: [],
    import_batch_ref: batchRef,
    campaign_safe_ref: generateContextHash(row.campaign_id),
    source_label_safe: sanitizeLabel(row.source_label),
    external_context_hash: generateContextHash(row.source_id) // Example
  };
}

export function parseManualJsonImport(jsonString: string): NormalizedPlatformMessage[] {
  const batchRef = generateSafeRef("ING");
  try {
    const parsed = JSON.parse(jsonString);
    const rows: ManualImportRow[] = Array.isArray(parsed) ? parsed : [parsed];
    
    const results: NormalizedPlatformMessage[] = [];
    for (const row of rows) {
      const msg = rowToNormalized(row, batchRef);
      if (msg) results.push(msg);
    }
    return results;
  } catch (error) {
    // Return empty array on parse failure; in real system, might return error status.
    return [];
  }
}

export function parseManualCsvImport(csvString: string): NormalizedPlatformMessage[] {
  const batchRef = generateSafeRef("ING");
  const results: NormalizedPlatformMessage[] = [];
  const lines = csvString.split("\n");
  if (lines.length < 2) return results; // No data or just header

  const header = lines[0].toLowerCase().split(",").map(h => h.trim());
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Very naive CSV parser for SPEC-025A (doesn't handle commas in quotes)
    // A proper CSV library would be used in production.
    // For synthetic testing, we assume simple fields.
    const parts = line.split(",").map(p => p.trim());
    
    const row: ManualImportRow = {};
    for (let j = 0; j < header.length; j++) {
      if (j < parts.length) {
        (row as any)[header[j]] = parts[j];
      }
    }
    
    const msg = rowToNormalized(row, batchRef);
    if (msg) results.push(msg);
  }
  
  return results;
}
