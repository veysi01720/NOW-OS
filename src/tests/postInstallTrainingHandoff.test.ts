import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersistentTrainingHandoffStore, trainingOwnerDecision } from "../store/trainingHandoffStore.js";

describe("post-install training owner gate", () => {
  it("stays pending indefinitely when the owner does not answer", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new PersistentTrainingHandoffStore(join(mkdtempSync(join(tmpdir(), "training-gate-")), "gates.json"), () => now);
    const created = store.create({ tenant_id: "now_os", conversation_key: "candidate-key", candidate_phone: "905000000000", candidate_remote_jid: "905000000000@s.whatsapp.net", selected_app: "Layla" });
    now = new Date("2026-02-15T00:00:00.000Z");
    expect(store.pending()).toHaveLength(1);
    expect(store.stats().reminder_due_count).toBe(1);
    expect(created.record.status).toBe("pending_owner_approval");
  });

  it("parses only deterministic owner decisions", () => {
    expect(trainingOwnerDecision("evet eğitime geç")).toEqual({ kind: "yes" });
    expect(trainingOwnerDecision("hayır 905551112233")).toEqual({ kind: "redirect", number: "905551112233" });
    expect(trainingOwnerDecision("belki sonra")).toBeNull();
  });
});
