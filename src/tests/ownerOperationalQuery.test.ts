import { describe, expect, it } from "vitest";
import { executeOwnerOperationalQuery } from "../bridge/ownerOperationalQuery.js";
import type { OwnerNaturalLanguageDecision } from "../bridge/ownerNaturalLanguageIntent.js";
import { InMemoryReportDataSource } from "./testDoubles.js";

function decision(
  kind: NonNullable<OwnerNaturalLanguageDecision["operational_query_kind"]>,
  window = 60,
): OwnerNaturalLanguageDecision {
  return {
    intent: "operational_query",
    confidence: 0.99,
    knowledge_text: null,
    candidate_reference: null,
    relay_text: null,
    conflict_detected: false,
    ambiguity_detected: false,
    clarification_question: null,
    selected_section_ids: [],
    rejected_section_ids: [],
    apply_selection: false,
    operational_query_kind: kind,
    operational_time_window_minutes: window,
  };
}

describe("owner operational query capability", () => {
  it("answers recent inbound activity only from persistent evidence", () => {
    const source = new InMemoryReportDataSource([], undefined, undefined, [], [], [
      {
        evidence_id: "corr_candidate_1",
        occurred_at: "2026-08-21T00:55:00.000Z",
        sender_last4: "3623",
        current_state: "WORK_MODEL_ACCEPTANCE",
        sendtext_status: "success",
      },
    ]);
    const result = executeOwnerOperationalQuery({
      decision: decision("recent_inbound_activity"),
      actorRole: "owner",
      reportDataSource: source,
      now: new Date("2026-08-21T01:00:00.000Z"),
    });

    expect(result.executionSucceeded).toBe(true);
    expect(result.reply).toContain("1 aday mesajı kayda girdi");
    expect(result.reply).toContain("3623 ile biten hattan");
    expect(result.reply).toContain("1/1 mesajda bot yanıtı başarıyla gönderildi");
    expect(result.evidenceIds.length).toBeGreaterThan(1);
  });

  it("refuses to claim that no one wrote when the live data source is unavailable", () => {
    const result = executeOwnerOperationalQuery({
      decision: decision("recent_inbound_activity"),
      actorRole: "owner",
    });

    expect(result.executionSucceeded).toBe(false);
    expect(result.reply).toContain("mesaj yok diyemem");
    expect(result.reply).not.toContain("mesaj görünmüyor");
    expect(result.evidenceIds).toEqual([]);
  });

  it("returns a zero-activity answer from a successful empty snapshot", () => {
    const result = executeOwnerOperationalQuery({
      decision: decision("recent_inbound_activity", 1_440),
      actorRole: "owner",
      reportDataSource: new InMemoryReportDataSource(),
      now: new Date("2026-08-21T01:00:00.000Z"),
    });

    expect(result.executionSucceeded).toBe(true);
    expect(result.reply).toContain("kayda giren yeni aday mesajı görünmüyor");
    expect(result.evidenceIds).toHaveLength(1);
  });

  it("answers candidate overview from state records rather than chat memory", () => {
    const result = executeOwnerOperationalQuery({
      decision: decision("candidate_overview"),
      actorRole: "owner",
      reportDataSource: new InMemoryReportDataSource([
        { user_id: "u1", sender_masked: "905***", current_state: "NEW_LEAD", selected_app: null, phone_type: null, missing_fields: ["age"], expected_next_step: "ask_intake_info", last_seen_at: "2026-08-21T00:00:00.000Z" },
        { user_id: "u2", sender_masked: "905***", current_state: "INSTALLATION_IN_PROGRESS", selected_app: "Layla", phone_type: "android", missing_fields: [], expected_next_step: "verify_installation", last_seen_at: "2026-08-21T00:01:00.000Z" },
      ]),
    });

    expect(result.reply).toContain("kayıtlarda 2 aday var");
    expect(result.reply).toContain("1 aday kurulum aşamasında");
  });

  it("answers pending handoffs from the handoff store", () => {
    const result = executeOwnerOperationalQuery({
      decision: decision("pending_handoffs"),
      actorRole: "owner",
      humanHandoffStore: {
        list: () => [
          { handoff_id: "h1", status: "pending" },
          { handoff_id: "h2", status: "resolved" },
        ],
      } as any,
    });

    expect(result.executionSucceeded).toBe(true);
    expect(result.reply).toContain("1 bekleyen insan devri");
    expect(result.evidenceIds).toHaveLength(1);
  });
});
