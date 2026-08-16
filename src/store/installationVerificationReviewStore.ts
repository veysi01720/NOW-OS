import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type InstallationReviewDecision = "pending" | "approved" | "rejected";

export interface InstallationVerificationReview {
  review_id: string;
  candidate_phone: string;
  candidate_phone_last4: string;
  selected_app: string | null;
  vision_hint: "clear" | "ambiguous";
  decision: InstallationReviewDecision;
  created_at: string;
  updated_at: string;
  correction_text?: string;
  owner_notification_sent: boolean;
  team_escalated: boolean;
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function last4(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "0");
}

export class InstallationVerificationReviewStore {
  private records: InstallationVerificationReview[] = [];

  constructor(private readonly path: string) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      this.records = Array.isArray(parsed) ? parsed as InstallationVerificationReview[] : [];
    } catch {
      this.records = [];
    }
  }

  private save(): void { atomicWrite(this.path, this.records.slice(0, 1000)); }

  create(input: { candidatePhone: string; selectedApp: string | null; visionHint: "clear" | "ambiguous"; now?: number }): InstallationVerificationReview {
    const now = new Date(input.now ?? Date.now()).toISOString();
    const existing = this.records.find((item) => item.candidate_phone === input.candidatePhone && item.decision === "pending");
    if (existing) return existing;
    const review: InstallationVerificationReview = {
      review_id: `ivr_${randomUUID()}`,
      candidate_phone: input.candidatePhone,
      candidate_phone_last4: last4(input.candidatePhone),
      selected_app: input.selectedApp,
      vision_hint: input.visionHint,
      decision: "pending",
      created_at: now,
      updated_at: now,
      owner_notification_sent: false,
      team_escalated: false,
    };
    this.records.unshift(review);
    this.save();
    return review;
  }

  pendingForLast4(value: string): InstallationVerificationReview | undefined {
    const suffix = value.replace(/\D/g, "").slice(-4);
    return this.records.find((item) => item.decision === "pending" && item.candidate_phone_last4 === suffix);
  }

  pendingForCandidate(phone: string): InstallationVerificationReview | undefined {
    return this.records.find((item) => item.decision === "pending" && item.candidate_phone === phone);
  }

  resolve(reviewId: string, decision: "approved" | "rejected", correctionText?: string): InstallationVerificationReview | undefined {
    const item = this.records.find((record) => record.review_id === reviewId && record.decision === "pending");
    if (!item) return undefined;
    item.decision = decision;
    item.correction_text = correctionText;
    item.updated_at = new Date().toISOString();
    this.save();
    return item;
  }

  markOwnerNotified(reviewId: string): void {
    const item = this.records.find((record) => record.review_id === reviewId);
    if (item) { item.owner_notification_sent = true; item.updated_at = new Date().toISOString(); this.save(); }
  }

  markTeamEscalated(reviewId: string): void {
    const item = this.records.find((record) => record.review_id === reviewId);
    if (item) { item.team_escalated = true; item.updated_at = new Date().toISOString(); this.save(); }
  }

  list(): InstallationVerificationReview[] { return [...this.records]; }
}

export function maskedReviewRef(review: InstallationVerificationReview): string {
  return createHash("sha256").update(review.review_id).digest("hex").slice(0, 8);
}
