import fs from "fs";
import path from "path";
import crypto from "crypto";
import { randomUUID } from "crypto";

export type SocialLeadStatus = 
  | "pending_review" 
  | "reviewed" 
  | "converted_to_candidate" 
  | "archived" 
  | "rejected";

export type SocialSourceType = 
  | "manual_csv" 
  | "manual_json" 
  | "copy_paste" 
  | "official_api" 
  | "webhook";

export interface SocialLeadNormalized {
  lead_ref: string;
  platform: "instagram" | "tiktok";
  source_type: SocialSourceType;
  source_label_safe: string;
  campaign_safe_ref: string;
  username_safe_hash: string;
  display_name_sanitized: string;
  message_preview_sanitized: string;
  detected_intents: string[];
  risk_flags: string[];
  status: SocialLeadStatus;
  created_at: string;
  imported_at: string;
  reviewed_at?: string;
  converted_at?: string;
  ingestion_job_ref?: string;
  dedup_hash?: string; // Internal deduplication hash
}

export class PersistentSocialLeadStore {
  private filePath: string;
  private leads: Record<string, SocialLeadNormalized> = {};

  // Salt for hashing usernames to prevent rainbow table attacks.
  // Using a deterministic salt based on the environment to ensure
  // across restarts the hashes remain consistent if needed, or simply
  // relying on SHA-256 for basic masking. V1 limitation: hardcoded salt 
  // if env is not provided, meaning it's obfuscation rather than cryptographic security.
  private hashSalt: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.hashSalt = process.env.NOW_OS_SOCIAL_HASH_SALT || "v1-social-salt-default";
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, "utf-8");
        this.leads = JSON.parse(data);
      } catch (err) {
        console.error(`[PersistentSocialLeadStore] Failed to load ${this.filePath}`, err);
        this.leads = {};
      }
    }
  }

  private save(): void {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.leads, null, 2), "utf-8");
    } catch (err) {
      console.error(`[PersistentSocialLeadStore] Failed to save ${this.filePath}`, err);
    }
  }

  public hashString(input: string): string {
    return crypto.createHash("sha256").update(input + this.hashSalt).digest("hex");
  }

  public generateDedupHash(platform: string, rawUsername: string, rawMessage: string, campaign: string): string {
    const userHash = this.hashString(rawUsername.toLowerCase().trim());
    const msgHash = this.hashString(rawMessage.toLowerCase().trim().substring(0, 50));
    return crypto.createHash("sha256").update(`${platform}_${userHash}_${msgHash}_${campaign}`).digest("hex");
  }

  public dedupExists(dedupHash: string): boolean {
    return Object.values(this.leads).some((l) => l.dedup_hash === dedupHash);
  }

  public createLead(lead: Omit<SocialLeadNormalized, "lead_ref">): SocialLeadNormalized {
    const lead_ref = `SLD-${randomUUID().substring(0, 8).toUpperCase()}`;
    const newLead: SocialLeadNormalized = {
      ...lead,
      lead_ref
    };
    this.leads[lead_ref] = newLead;
    this.save();
    return newLead;
  }

  public getByLeadRef(lead_ref: string): SocialLeadNormalized | null {
    return this.leads[lead_ref] || null;
  }

  public listLeads(): SocialLeadNormalized[] {
    return Object.values(this.leads).sort((a, b) => new Date(b.imported_at).getTime() - new Date(a.imported_at).getTime());
  }

  public listByStatus(status: SocialLeadStatus): SocialLeadNormalized[] {
    return this.listLeads().filter((l) => l.status === status);
  }

  public updateStatus(lead_ref: string, newStatus: SocialLeadStatus, actorRole?: string): SocialLeadNormalized | null {
    const lead = this.leads[lead_ref];
    if (!lead) return null;

    // Strict status transitions
    if (lead.status === "converted_to_candidate") {
      throw new Error("Cannot transition a lead that has already been converted to a candidate.");
    }

    if (lead.status === "archived" && newStatus !== "archived") {
      // V1 explicitly blocks recovering archived leads
      throw new Error("Cannot transition an archived lead.");
    }

    if (newStatus === "converted_to_candidate") {
      if (lead.status !== "pending_review" && lead.status !== "reviewed") {
        throw new Error(`Cannot convert lead to candidate from status: ${lead.status}`);
      }
      lead.converted_at = new Date().toISOString();
    } else if (newStatus === "reviewed") {
      if (lead.status !== "pending_review") {
        throw new Error(`Cannot mark as reviewed from status: ${lead.status}`);
      }
      lead.reviewed_at = new Date().toISOString();
    }

    lead.status = newStatus;
    this.save();
    return lead;
  }

  public markReviewed(lead_ref: string): SocialLeadNormalized | null {
    return this.updateStatus(lead_ref, "reviewed");
  }

  public archiveLead(lead_ref: string): SocialLeadNormalized | null {
    return this.updateStatus(lead_ref, "archived");
  }

  public markConverted(lead_ref: string): SocialLeadNormalized | null {
    return this.updateStatus(lead_ref, "converted_to_candidate");
  }

  public getMetrics() {
    const values = Object.values(this.leads);
    return {
      total_social_leads: values.length,
      pending_review_count: values.filter(v => v.status === "pending_review").length,
      reviewed_count: values.filter(v => v.status === "reviewed").length,
      converted_to_candidate_count: values.filter(v => v.status === "converted_to_candidate").length,
      archived_count: values.filter(v => v.status === "archived").length,
      rejected_count: values.filter(v => v.status === "rejected").length,
      instagram_count: values.filter(v => v.platform === "instagram").length,
      tiktok_count: values.filter(v => v.platform === "tiktok").length
    };
  }
}
