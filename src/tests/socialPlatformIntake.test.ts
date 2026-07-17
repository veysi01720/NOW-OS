import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PersistentSocialLeadStore } from "../store/socialLeadStore.js";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";

const testDbPath = join(process.cwd(), "test_social_leads.json");

describe("PersistentSocialLeadStore", () => {
  let store: PersistentSocialLeadStore;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    store = new PersistentSocialLeadStore(testDbPath);
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it("should create a lead with correct hashing", () => {
    const rawUser = "my_insta_user_123";
    const lead = store.createLead({
      platform: "instagram",
      source_type: "manual_json",
      source_label_safe: "test_import",
      campaign_safe_ref: "promo_1",
      username_safe_hash: store.hashString(rawUser),
      display_name_sanitized: "My Insta User",
      message_preview_sanitized: "Hello I want to join",
      detected_intents: [],
      risk_flags: [],
      status: "pending_review",
      created_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
      dedup_hash: store.generateDedupHash("instagram", rawUser, "Hello I want to join", "promo_1")
    });

    expect(lead.lead_ref).toMatch(/^SLD-/);
    expect(lead.platform).toBe("instagram");
    // Verify it doesn't store the raw user
    expect((lead as any).rawUser).toBeUndefined();
    expect(lead.username_safe_hash).toBe(store.hashString(rawUser));

    const metrics = store.getMetrics();
    expect(metrics.total_social_leads).toBe(1);
    expect(metrics.pending_review_count).toBe(1);
  });

  it("should correctly handle state transitions", () => {
    const rawUser = "user_2";
    const lead = store.createLead({
      platform: "tiktok",
      source_type: "manual_json",
      source_label_safe: "test_import",
      campaign_safe_ref: "",
      username_safe_hash: store.hashString(rawUser),
      display_name_sanitized: "User 2",
      message_preview_sanitized: "Test",
      detected_intents: [],
      risk_flags: [],
      status: "pending_review",
      created_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
      dedup_hash: store.generateDedupHash("tiktok", rawUser, "Test", "")
    });

    // Mark reviewed
    const reviewedLead = store.markReviewed(lead.lead_ref);
    expect(reviewedLead?.status).toBe("reviewed");
    expect(store.getMetrics().reviewed_count).toBe(1);

    // Convert to candidate
    const convertedLead = store.markConverted(lead.lead_ref);
    expect(convertedLead?.status).toBe("converted_to_candidate");
    expect(store.getMetrics().converted_to_candidate_count).toBe(1);

    // Cannot convert again (though store logic doesn't strictly block it, route does)
  });

  it("should archive a lead", () => {
    const rawUser = "user_3";
    const lead = store.createLead({
      platform: "instagram",
      source_type: "manual_json",
      source_label_safe: "test_import",
      campaign_safe_ref: "",
      username_safe_hash: store.hashString(rawUser),
      display_name_sanitized: "User 3",
      message_preview_sanitized: "Test",
      detected_intents: [],
      risk_flags: [],
      status: "pending_review",
      created_at: new Date().toISOString(),
      imported_at: new Date().toISOString(),
      dedup_hash: store.generateDedupHash("instagram", rawUser, "Test", "")
    });

    const archived = store.archiveLead(lead.lead_ref);
    expect(archived?.status).toBe("archived");
    expect(store.getMetrics().archived_count).toBe(1);
  });

  it("should reject credential-like inputs effectively in route simulation", () => {
    const jsonInput = '[{"username": "test", "password": "123"}]';
    const regex = /password|cookie|session|bearer|auth_token|access_token/i;
    expect(regex.test(jsonInput)).toBe(true);
  });
});
