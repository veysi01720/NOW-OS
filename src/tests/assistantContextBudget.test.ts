import { sanitizeAndBudgetContext, estimateTokens, BUDGET_LIMITS } from "../utils/contextBudget.js";
import type { BackendContextPayloadV1 } from "../contracts/backendContextPayload.js";
import { describe, it, expect } from "vitest";

function generateLargeContext(): BackendContextPayloadV1 {
  const context: any = {
    backend_context_version: "1.0",
    correlation_id: "test",
    sender_role: "owner",
    chat_type: "private",
    sender: { sender_id: "905", phone_number: "905" },
    chat: { remote_jid: "905@s.whatsapp.net", message_id: "123", message_type: "text", is_from_me: false, is_group: false },
    state: {},
    memory: {},
    versions: {},
    user_message: { text: "hello", received_at: "now" },
    report_summary: {
      top_group_followups: Array.from({ length: 50 }, (_, i) => ({ reason: `reason_${i}` })),
      top_publisher_followups: Array.from({ length: 50 }, (_, i) => ({ reason: `reason_${i}` })),
      top_priority_items: Array.from({ length: 150 }, (_, i) => ({ reason: `reason_${i}` }))
    },
    daily_report: {
      group_summary: {
        top_group_followups: Array.from({ length: 50 }, (_, i) => ({ reason: `reason_${i}` }))
      }
    },
    learning_review: {
      latest_pending_suggestions: Array.from({ length: 50 }, (_, i) => ({ class: `class_${i}` }))
    },
    knowledge_publish: { publish_ready: true },
    knowledge_sync: { sync_ready: true }
  };
  return context as BackendContextPayloadV1;
}

describe("assistantContextBudget", () => {
  it("normal_user drops operational sections", () => {
    const normalCtx = generateLargeContext();
    const res1 = sanitizeAndBudgetContext(normalCtx, "normal_user");
    expect(res1.context.report_summary).toBeUndefined();
    expect(res1.context.daily_report).toBeUndefined();
    expect(res1.context.knowledge_publish).toBeUndefined();
    expect(res1.metrics.compacted).toBe(false);
    expect(res1.metrics.estimated_tokens_after).toBeLessThan(BUDGET_LIMITS.NORMAL_USER_TARGET);
  });

  it("owner_manager caps arrays", () => {
    const ownerCtx = generateLargeContext();
    const res2 = sanitizeAndBudgetContext(ownerCtx, "owner_manager");
    const topPriorityLength = res2.context.report_summary?.top_priority_items?.length ?? 0;
    expect(topPriorityLength).toBeLessThanOrEqual(10);
  });

  it("Retry mechanism reduces target aggressively", () => {
    const ownerCtx = generateLargeContext();
    const res2 = sanitizeAndBudgetContext(ownerCtx, "owner_manager");
    const res3 = sanitizeAndBudgetContext(ownerCtx, "owner_manager", true);
    expect(res3.metrics.array_caps_applied).toContain("retry_penalty");
    expect(res3.metrics.estimated_tokens_after).toBeLessThanOrEqual(res2.metrics.estimated_tokens_after);
  });

  it("Emergency Compact triggers on hard cap", () => {
    const hugeCtx = generateLargeContext();
    hugeCtx.memory.conversation_summary = "A".repeat(100000); // Trigger hard cap
    const res4 = sanitizeAndBudgetContext(hugeCtx, "owner_manager");
    expect(res4.metrics.hard_cap_triggered).toBe(true);
    expect(res4.context.report_summary).toBeUndefined();
    expect(res4.context.user_message.text).toBe("hello");
  });
});
