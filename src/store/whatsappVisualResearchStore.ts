import { createHash } from "node:crypto";
import * as fs from "node:fs";

export interface WhatsAppVisualResearchItem {
  visual_ref: string; // WVR-XXXXXX
  import_batch_ref: string;
  source_label_safe: string;
  file_name_safe: string; // For text-only this can just be the chat txt name
  image_hash: string; // For text-only this can be a hash of the text or empty
  image_type: string; // 'txt' for text-only
  linked_message_refs: string[];
  nearby_context_sanitized: string[]; // for text-only, this can store the entire parsed context
  visual_category: string; // for text-only this is 'text_research'
  confidence: number;
  risk_flags: string[];
  skip_reason?: string;
  research_summary_sanitized?: string;
  created_at: string;
  mode?: "visual_research" | "text_research_only" | "mixed_research";
  message_count_sanitized?: number;
  jargon_count?: number;
  faq_count?: number;
  objection_count?: number;
  setup_instruction_count?: number;
  payment_question_count?: number;
  invite_code_mentions_count?: number;
  short_reply_style_examples_count?: number;
  bot_like_or_repetitive_reply_examples_count?: number;
  media_placeholder_count?: number;
  risky_or_sensitive_count?: number;
  recommended_owner_review_count?: number;
}

export interface PersistentWhatsAppVisualResearchStore {
  createItem(item: WhatsAppVisualResearchItem): void;
  listItems(): WhatsAppVisualResearchItem[];
  listByBatch(batchRef: string): WhatsAppVisualResearchItem[];
  dedupExists(imageHash: string, sourceLabelSafe: string): boolean;
  getSummary(): {
    total_items: number;
    processed_images: number;
    skipped_media: number;
    sensitive_risk_count: number;
    setup_screen_count: number;
    payment_screen_count: number;
    error_screen_count: number;
    invite_code_screen_count: number;
    profile_screen_count: number;
    unrelated_photo_count: number;
  };
}

export class FileWhatsAppVisualResearchStore implements PersistentWhatsAppVisualResearchStore {
  private items: WhatsAppVisualResearchItem[] = [];

  constructor(private storageFilePath: string) {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const data = fs.readFileSync(this.storageFilePath, "utf8");
        this.items = JSON.parse(data);
      }
    } catch (err) {
      console.warn("Could not load whatsapp visual research store", err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.items, null, 2));
    } catch (err) {
      console.warn("Could not save whatsapp visual research store", err);
    }
  }

  createItem(item: WhatsAppVisualResearchItem): void {
    this.items.push(item);
    this.save();
  }

  listItems(): WhatsAppVisualResearchItem[] {
    return [...this.items];
  }

  listByBatch(batchRef: string): WhatsAppVisualResearchItem[] {
    return this.items.filter(i => i.import_batch_ref === batchRef);
  }

  dedupExists(imageHash: string, sourceLabelSafe: string): boolean {
    return this.items.some(i => i.image_hash === imageHash && i.source_label_safe === sourceLabelSafe);
  }

  getSummary() {
    let processed_images = 0;
    let skipped_media = 0;
    let sensitive_risk_count = 0;
    let setup_screen_count = 0;
    let payment_screen_count = 0;
    let error_screen_count = 0;
    let invite_code_screen_count = 0;
    let profile_screen_count = 0;
    let unrelated_photo_count = 0;

    for (const item of this.items) {
      if (item.skip_reason) {
        skipped_media++;
        continue;
      }
      if (item.image_type !== "txt") {
        processed_images++;
      }
      
      if (item.risk_flags.includes("sensitive_private_info")) sensitive_risk_count++;
      
      switch(item.visual_category) {
        case "app_setup_screen": setup_screen_count++; break;
        case "payment_withdrawal_screen": payment_screen_count++; break;
        case "wallet_balance_screen": payment_screen_count++; break;
        case "error_screen": error_screen_count++; break;
        case "invite_code_screen": invite_code_screen_count++; break;
        case "profile_photo_screen": profile_screen_count++; break;
        case "unrelated_person_photo": unrelated_photo_count++; break;
      }
    }

    return {
      total_items: this.items.length,
      processed_images,
      skipped_media,
      sensitive_risk_count,
      setup_screen_count,
      payment_screen_count,
      error_screen_count,
      invite_code_screen_count,
      profile_screen_count,
      unrelated_photo_count
    };
  }
}
