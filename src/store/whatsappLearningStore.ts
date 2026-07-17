import { createHash } from "node:crypto";
import * as fs from "node:fs";

export interface WhatsAppLearningMessage {
  message_ref: string;
  source_type: "whatsapp_export" | "evolution_history" | "manual_training_text" | "copy_paste";
  speaker_role: "owner" | "manager" | "candidate" | "publisher" | "unknown";
  conversation_type: "onboarding" | "payment" | "installation" | "training" | "objection" | "support" | "followup" | "general" | "owner_platform_update" | "approved_app_update" | "setup_code_update" | "typo_tolerance_backend";
  message_text_sanitized: string;
  
  detected_jargon: string[];
  detected_faq: string[];
  detected_objection: string[];
  detected_training_point: string[];
  detected_risk_flags: string[];
  
  source_label_safe: string;
  import_batch_ref: string;
  created_at: string;
}

export interface PersistentWhatsAppLearningStore {
  createMessage(msg: WhatsAppLearningMessage): void;
  listMessages(): WhatsAppLearningMessage[];
  listByBatch(batchRef: string): WhatsAppLearningMessage[];
  dedupExists(speaker_role: string, text: string, source_type: string): boolean;
  getSummary(): {
    total: number;
    jargon_count: number;
    faq_count: number;
    objection_count: number;
    training_point_count: number;
  };
}

export class FileWhatsAppLearningStore implements PersistentWhatsAppLearningStore {
  private messages: WhatsAppLearningMessage[] = [];

  constructor(private storageFilePath: string) {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const data = fs.readFileSync(this.storageFilePath, "utf8");
        this.messages = JSON.parse(data);
      }
    } catch (err) {
      console.warn("Could not load whatsapp learning store", err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.messages, null, 2));
    } catch (err) {
      console.warn("Could not save whatsapp learning store", err);
    }
  }

  createMessage(msg: WhatsAppLearningMessage): void {
    this.messages.push(msg);
    this.save();
  }

  listMessages(): WhatsAppLearningMessage[] {
    return [...this.messages];
  }

  listByBatch(batchRef: string): WhatsAppLearningMessage[] {
    return this.messages.filter(m => m.import_batch_ref === batchRef);
  }

  dedupExists(speaker_role: string, text: string, source_type: string): boolean {
    const hash = createHash("sha256").update(text).digest("hex");
    return this.messages.some(m => 
      m.speaker_role === speaker_role && 
      m.source_type === source_type && 
      createHash("sha256").update(m.message_text_sanitized).digest("hex") === hash
    );
  }

  getSummary() {
    let jargon_count = 0;
    let faq_count = 0;
    let objection_count = 0;
    let training_point_count = 0;

    for (const m of this.messages) {
      if (m.detected_jargon.length > 0) jargon_count++;
      if (m.detected_faq.length > 0) faq_count++;
      if (m.detected_objection.length > 0) objection_count++;
      if (m.detected_training_point.length > 0) training_point_count++;
    }

    return {
      total: this.messages.length,
      jargon_count,
      faq_count,
      objection_count,
      training_point_count
    };
  }
}
