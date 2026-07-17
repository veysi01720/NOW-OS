import { createHash, randomUUID } from "node:crypto";
import type { BundleManifest } from "./types.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class BundleBuilder {
  buildBundle(candidates: any[], previousVersion: string | null): BundleManifest {
    const modules = [
      "01_core_rules", "02_role_channel_policies", "03_app_registry", 
      "04_platform_device_facts", "05_link_catalog", "06_onboarding_workflows",
      "07_payment_faq", "08_work_mode_rules", "09_objection_handling", 
      "10_support_escalation", "11_owner_playbook", "12_manager_playbook", 
      "13_group_policy", "14_approved_jargon", "15_approved_learning", 
      "16_safety_claim_boundaries"
    ];

    const approvedCandidates = candidates.filter(c => c.status === "APPROVED");
    const rejectedCandidates = candidates.filter(c => c.status === "REJECTED");
    const pendingCandidates = candidates.filter(c => c.status === "PENDING" || c.status === "pending_owner_review");

    const bundleDataStr = JSON.stringify(approvedCandidates);
    const realHash = sha256(bundleDataStr);

    return {
      bundle_version: "bundle_" + Date.now(),
      bundle_hash: realHash,
      source_import_ids: ["import_1"],
      approved_candidate_count: approvedCandidates.length,
      rejected_candidate_count: rejectedCandidates.length,
      pending_candidate_count: pendingCandidates.length,
      conflict_count: 0,
      module_count: modules.length,
      document_count: approvedCandidates.length,
      created_at: new Date().toISOString(),
      publish_status: "NOT_PUBLISHED",
      publish_ready: pendingCandidates.length === 0,
      previous_bundle_version: previousVersion
    };
  }
}
