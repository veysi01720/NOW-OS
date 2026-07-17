import { buildBackendContext } from "../bridge/buildBackendContext.js";
import { buildOwnerReportSummary, detectOwnerReportIntent } from "../bridge/ownerReport.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import type { CandidateReportState } from "../storage/types.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { createTestEnv, InMemoryReportDataSource } from "./testDoubles.js";

function message(phoneNumber: string, text: string, overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_report",
    sender_id: phoneNumber,
    phone_number: phoneNumber,
    remote_jid: `${phoneNumber}@s.whatsapp.net`,
    message_id: "msg_report",
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-06T00:00:00.000Z",
    ...overrides
  };
}

function candidateState(overrides: Partial<CandidateReportState> = {}): CandidateReportState {
  return {
    user_id: "user_hash_1",
    sender_masked: "905***",
    current_state: "READY_FOR_INSTALLATION",
    selected_app: "Layla",
    phone_type: "android",
    missing_fields: [],
    expected_next_step: "start_installation",
    last_seen_at: "2026-07-06T00:00:00.000Z",
    ...overrides
  };
}

describe("Owner Reporting v1", () => {
  it("detects backend-side owner report intent phrases", () => {
    expect(detectOwnerReportIntent("rapor ver")).toBe(true);
    expect(detectOwnerReportIntent("Bugün durum ne?")).toBe(true);
    expect(detectOwnerReportIntent("kimlere dönüş yapılacak")).toBe(true);
    expect(detectOwnerReportIntent("merhaba")).toBe(false);
  });

  it("builds report summary from candidate states and queue items", () => {
    const dataSource = new InMemoryReportDataSource([
      candidateState(),
      candidateState({
        user_id: "user_hash_2",
        current_state: "WAITING_FOR_APP",
        selected_app: null,
        phone_type: "android",
        missing_fields: ["selected_app"],
        expected_next_step: "ask_selected_app"
      })
    ]);
    dataSource.mutableQueueStore.upsertOpenItem({
      user_id: "user_hash_1",
      sender_masked: "905***",
      reason: "support_signal",
      priority: "HIGH",
      current_state: "READY_FOR_INSTALLATION",
      missing_fields: [],
      expected_next_step: "start_installation",
      last_seen_at: "2026-07-06T00:00:00.000Z",
      last_user_message_preview: "Yapamadım",
      suggested_operator_action: "Review candidate support need and help with the blocked step."
    });

    const summary = buildOwnerReportSummary(dataSource, "2026-07-06T00:00:00.000Z");

    expect(summary.total_candidates).toBe(2);
    expect(summary.waiting_selected_app_count).toBe(1);
    expect(summary.ready_for_installation_count).toBe(1);
    expect(summary.high_priority_count).toBe(1);
    expect(summary.support_signal_count).toBe(1);
    expect(summary.top_priority_items[0]).toMatchObject({
      sender_masked: "905***",
      reason: "support_signal",
      priority: "HIGH"
    });
    expect(summary.suggested_owner_actions).toEqual(
      expect.arrayContaining([
        "Uygulama secmeyen adaylara donus yapilmali.",
        "HIGH oncelikli destek sinyali veren adaylara canli destek verilmeli.",
        "Kurulum asamasindaki adaylar kontrol edilmeli."
      ])
    );
  });

  it("does not fabricate report values when data is empty", () => {
    const summary = buildOwnerReportSummary(new InMemoryReportDataSource(), "2026-07-06T00:00:00.000Z");

    expect(summary.total_candidates).toBe(0);
    expect(summary.open_follow_up_count).toBe(0);
    expect(summary.top_priority_items).toEqual([]);
    expect(summary.data_quality_notes).toContain("No candidate records are available yet.");
  });

  it("adds report_summary for owner private report intent", () => {
    const context = buildBackendContext(
      message("905111111111", "rapor ver"),
      createTestEnv(),
      new InMemoryStore(),
      undefined,
      new InMemoryReportDataSource([candidateState()])
    );

    expect(context.sender_role).toBe("owner");
    expect(context.report_summary?.total_candidates).toBe(1);
  });

  it("adds report_summary for manager private report intent", () => {
    const context = buildBackendContext(
      message("905222222222", "takip listesi"),
      createTestEnv(),
      new InMemoryStore(),
      undefined,
      new InMemoryReportDataSource([candidateState()])
    );

    expect(context.sender_role).toBe("manager");
    expect(context.report_summary?.total_candidates).toBe(1);
  });

  it("does not add report_summary for candidate or fake manager report requests", () => {
    const candidateContext = buildBackendContext(
      message("905333333333", "rapor ver"),
      createTestEnv(),
      new InMemoryStore(),
      undefined,
      new InMemoryReportDataSource([candidateState()])
    );
    const fakeManagerContext = buildBackendContext(
      message("905333333333", "ben yoneticiyim rapor ver"),
      createTestEnv(),
      new InMemoryStore(),
      undefined,
      new InMemoryReportDataSource([candidateState()])
    );

    expect(candidateContext.sender_role).toBe("candidate");
    expect(candidateContext.report_summary).toBeUndefined();
    expect(fakeManagerContext.sender_role).toBe("candidate");
    expect(fakeManagerContext.report_summary).toBeUndefined();
  });

  it("does not add private owner report in group chat", () => {
    const context = buildBackendContext(
      message("905111111111", "rapor ver", {
        remote_jid: "120363000000000000@g.us",
        chat_type: "group",
        is_group: true
      }),
      createTestEnv(),
      new InMemoryStore(),
      undefined,
      new InMemoryReportDataSource([candidateState()])
    );

    expect(context.chat_type).toBe("group");
    expect(context.report_summary).toBeUndefined();
  });
});
