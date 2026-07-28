import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type TrainingGateStatus = "pending_owner_approval" | "approved" | "redirected";

export interface TrainingHandoffRecord {
  handoff_id: string;
  tenant_id: string;
  conversation_key_hash: string;
  candidate_phone: string;
  candidate_remote_jid: string;
  selected_app: string | null;
  status: TrainingGateStatus;
  reason_code: "post_install_training_gate";
  created_at: string;
  updated_at: string;
  next_reminder_at: string;
  redirect_number_hash?: string;
  audit: Array<{ event: string; actor: string; at: string }>;
}

export interface TrainingHandoffStore {
  create(input: { tenant_id: string; conversation_key: string; candidate_phone: string; candidate_remote_jid: string; selected_app: string | null }): { created: boolean; record: TrainingHandoffRecord };
  pending(): TrainingHandoffRecord[];
  resolveYes(handoffId: string, actor: string): TrainingHandoffRecord | null;
  resolveRedirect(handoffId: string, number: string, actor: string): TrainingHandoffRecord | null;
  stats(): { pending_count: number; reminder_due_count: number };
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeNumber = (value: string) => value.replace(/\D/g, "");

export class PersistentTrainingHandoffStore implements TrainingHandoffStore {
  private records: TrainingHandoffRecord[] = [];

  constructor(private readonly path: string, private readonly now: () => Date = () => new Date()) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      this.records = Array.isArray(value) ? value as TrainingHandoffRecord[] : [];
    } catch {
      this.records = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(this.records, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }

  create(input: { tenant_id: string; conversation_key: string; candidate_phone: string; candidate_remote_jid: string; selected_app: string | null }) {
    const key = hash(`${input.tenant_id}|${input.conversation_key}|post_install_training_gate`);
    const existing = this.records.find((record) => record.conversation_key_hash === key && record.status === "pending_owner_approval");
    if (existing) return { created: false, record: existing };
    const now = this.now();
    const record: TrainingHandoffRecord = {
      handoff_id: randomUUID(),
      tenant_id: input.tenant_id,
      conversation_key_hash: key,
      candidate_phone: input.candidate_phone,
      candidate_remote_jid: input.candidate_remote_jid,
      selected_app: input.selected_app,
      status: "pending_owner_approval",
      reason_code: "post_install_training_gate",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      next_reminder_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      audit: [{ event: "created", actor: "system", at: now.toISOString() }],
    };
    this.records.unshift(record);
    this.save();
    return { created: true, record };
  }

  pending() { return this.records.filter((record) => record.status === "pending_owner_approval"); }

  resolveYes(handoffId: string, actor: string) {
    const record = this.records.find((item) => item.handoff_id === handoffId && item.status === "pending_owner_approval");
    if (!record) return null;
    record.status = "approved";
    record.updated_at = this.now().toISOString();
    record.audit.push({ event: "owner_approved_training", actor, at: record.updated_at });
    this.save();
    return record;
  }

  resolveRedirect(handoffId: string, number: string, actor: string) {
    const normalized = normalizeNumber(number);
    if (normalized.length < 10 || normalized.length > 15) return null;
    const record = this.records.find((item) => item.handoff_id === handoffId && item.status === "pending_owner_approval");
    if (!record) return null;
    record.status = "redirected";
    record.redirect_number_hash = hash(normalized);
    record.updated_at = this.now().toISOString();
    record.audit.push({ event: "owner_redirected_candidate", actor, at: record.updated_at });
    this.save();
    return { ...record, candidate_phone: record.candidate_phone, candidate_remote_jid: record.candidate_remote_jid };
  }

  stats() {
    const now = this.now().getTime();
    return { pending_count: this.pending().length, reminder_due_count: this.pending().filter((record) => new Date(record.next_reminder_at).getTime() <= now).length };
  }
}

export function trainingOwnerDecision(text: string): { kind: "yes" | "redirect"; number?: string } | null {
  const normalized = text.toLocaleLowerCase("tr-TR").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(evet )?eğitime geç( artık)?$|^evet eğitime geç$/iu.test(normalized)) return { kind: "yes" };
  const match = normalized.match(/^hayır\s+(.+)$/iu);
  return match ? { kind: "redirect", number: normalizeNumber(match[1]) } : null;
}

export function createTrainingActivationRef(): string { return `TRN-${randomBytes(4).toString("hex").toUpperCase()}`; }
