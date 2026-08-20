import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvolutionSender, SendTextInput } from "../bridge/sendTextMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { CapabilityRegistry } from "../bridge/capabilityRegistry.js";
import { SmtpOperationalAlarmNotifier } from "../observability/operationalAlarmNotifier.js";
import { DeliveryEventLedger } from "../reliability/deliveryEventLedger.js";
import { PersistentReliabilityQueueStore } from "../reliability/persistentReliabilityQueueStore.js";
import { ReliableEvolutionSender } from "../reliability/reliableEvolutionSender.js";
import { ReliabilityQueueWorker, processOutboundJob } from "../reliability/queueWorker.js";
import { applyUserStateTransition } from "../storage/userStateTransitionBoundary.js";
import { defaultUserState } from "../storage/types.js";
import { createSilentLogger, InMemoryUserStateStore } from "./testDoubles.js";

const directories: string[] = [];

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), "now-os-reliability-"));
  directories.push(path);
  return path;
}

function message(index = 1): NormalizedIncomingMessage {
  return {
    correlation_id: `corr_${index}`,
    sender_id: `90500000${String(index).padStart(4, "0")}`,
    phone_number: `90500000${String(index).padStart(4, "0")}`,
    remote_jid: `90500000${String(index).padStart(4, "0")}@s.whatsapp.net`,
    message_id: `msg_${index}`,
    message_type: "conversation",
    text: "HAM_ADAY_METNI",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-08-21T00:00:00.000Z",
    media: { kind: "image", mimetype: "image/png", file_name: "proof.png", caption: "HAM_CAPTION", base64: "HAM_BASE64" },
  };
}

class RecordingSender implements EvolutionSender {
  sends: SendTextInput[] = [];
  constructor(private readonly failures = 0) {}
  async sendText(input: SendTextInput): Promise<void> {
    this.sends.push(input);
    if (this.sends.length <= this.failures) throw new Error("provider unavailable secret=should-redact");
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("persistent reliable outbound", () => {
  it("survives restart and retries a failed outbound exactly once", async () => {
    const root = sandbox();
    const queuePath = join(root, "outbox.json");
    const ledgerPath = join(root, "ledger.json");
    const firstRaw = new RecordingSender(1);
    const first = new ReliableEvolutionSender({
      rawSender: firstRaw,
      store: new PersistentReliabilityQueueStore(queuePath),
      ledger: new DeliveryEventLedger(ledgerPath),
      logger: createSilentLogger(),
      retryBackoffMs: 0,
    });
    await expect(first.sendText({ message: message(), text: "Güvenli yanıt" })).rejects.toThrow();

    const restartedStore = new PersistentReliabilityQueueStore(queuePath);
    expect(restartedStore.listJobs()[0]?.status).toBe("RETRY_WAIT");
    const retryRaw = new RecordingSender();
    const worker = new ReliabilityQueueWorker({ queueName: "outbound", workerId: "restart-worker", store: restartedStore, logger: createSilentLogger() });
    const result = await worker.runOnce((job) => processOutboundJob(job, retryRaw));
    expect(result.status).toBe("COMPLETED");
    expect(retryRaw.sends).toHaveLength(1);
    expect(new PersistentReliabilityQueueStore(queuePath).listJobs()[0]?.status).toBe("COMPLETED");
  });

  it("deduplicates completed sends and never stores inbound text or image bytes in the ledger", async () => {
    const root = sandbox();
    const queuePath = join(root, "outbox.json");
    const ledgerPath = join(root, "ledger.json");
    const raw = new RecordingSender();
    const sender = new ReliableEvolutionSender({ rawSender: raw, store: new PersistentReliabilityQueueStore(queuePath), ledger: new DeliveryEventLedger(ledgerPath), logger: createSilentLogger() });
    const input = { message: message(), text: "Teslim edilen cevap" };
    await sender.sendText(input);
    await sender.sendText(input);
    expect(raw.sends).toHaveLength(1);
    const ledger = readFileSync(ledgerPath, "utf8");
    expect(ledger).not.toContain("HAM_ADAY_METNI");
    expect(ledger).not.toContain("HAM_BASE64");
    expect(ledger).not.toContain("HAM_CAPTION");
    const outbox = readFileSync(queuePath, "utf8");
    expect(outbox).not.toContain("HAM_ADAY_METNI");
    expect(outbox).not.toContain("HAM_BASE64");
  });

  it("delivers 200 concurrent messages without loss", async () => {
    const root = sandbox();
    const raw = new RecordingSender();
    const store = new PersistentReliabilityQueueStore(join(root, "outbox.json"), { maxCompletedEntries: 500 });
    const sender = new ReliableEvolutionSender({ rawSender: raw, store, ledger: new DeliveryEventLedger(join(root, "ledger.json")), logger: createSilentLogger() });
    await Promise.all(Array.from({ length: 200 }, (_, index) => sender.sendText({ message: message(index + 1), text: `Yanıt ${index + 1}` })));
    expect(raw.sends).toHaveLength(200);
    expect(store.listJobs().filter((job) => job.status === "COMPLETED")).toHaveLength(200);
    expect(store.counts().outbound_queue_pending).toBe(0);
  }, 20_000);

  it("persists dead-letter state and sends an independent email alarm", async () => {
    const root = sandbox();
    const store = new PersistentReliabilityQueueStore(join(root, "outbox.json"));
    const sender = new ReliableEvolutionSender({ rawSender: new RecordingSender(1), store, ledger: new DeliveryEventLedger(join(root, "ledger.json")), logger: createSilentLogger(), maxAttempts: 1 });
    await expect(sender.sendText({ message: message(), text: "Yanıt" })).rejects.toThrow();
    expect(store.counts().dead_letter_count).toBe(1);
    const sendMail = vi.fn().mockResolvedValue({ messageId: "smtp-message" });
    const notifier = new SmtpOperationalAlarmNotifier({ enabled: true, host: "smtp.test", port: 587, secure: false, from: "from@test", recipients: ["owner@test"], logger: createSilentLogger(), transporter: { sendMail } as never });
    expect(await notifier.send({ kind: "outbound_dead_letter", pending: 0, dead_letters: 1, occurred_at: new Date().toISOString() })).toEqual({ delivered: true });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("cross-layer safety invariants", () => {
  it("blocks training until installation is both done and owner-verified", () => {
    const store = new InMemoryUserStateStore();
    const current = { ...defaultUserState(), current_state: "INSTALLATION_IN_PROGRESS", installation_status: "in_progress", installation_verification_status: "ambiguous" as const };
    const denied = applyUserStateTransition({ store, conversationKey: "candidate", currentState: current, nextState: { ...current, current_state: "TRAINING_READY", training_status: "ready" }, source: "owner_verification" });
    expect(denied).toEqual({ applied: false, reason: "invariant_denied" });
    const allowed = applyUserStateTransition({ store, conversationKey: "candidate", currentState: current, nextState: { ...current, current_state: "TRAINING_READY", installation_status: "done", installation_verification_status: "clear", training_status: "ready" }, source: "owner_verification" });
    expect(allowed.applied).toBe(true);
  });

  it("allows owner capabilities only for privileged private traffic", () => {
    const registry = new CapabilityRegistry();
    expect(registry.authorize({ capability: "owner_knowledge_publish", senderRole: "owner", chatType: "private" }).authorized).toBe(true);
    expect(registry.authorize({ capability: "owner_knowledge_publish", senderRole: "candidate", chatType: "private" }).authorized).toBe(false);
    expect(registry.authorize({ capability: "owner_candidate_relay", senderRole: "owner", chatType: "group" }).authorized).toBe(false);
  });
});
