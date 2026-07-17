import { vi } from "vitest";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { createTestEnv } from "./testDoubles.js";
import { UserState, UserIdentityInput } from "../storage/types.js";

class TestUserStateStore {
  public states = new Map<string, UserState>();

  getOrCreateState(userId: string, defaults: UserState, _identity?: UserIdentityInput): UserState {
    const existing = this.states.get(userId);
    if (existing !== undefined) {
      return { ...existing, missing_fields: [...existing.missing_fields] };
    }
    const created = { ...defaults, missing_fields: [...defaults.missing_fields] };
    this.states.set(userId, created);
    return { ...created, missing_fields: [...created.missing_fields] };
  }

  updateState(userId: string, state: UserState, _identity?: UserIdentityInput): void {
    this.states.set(userId, { ...state, missing_fields: [...state.missing_fields] });
  }
}

class TestEventLogStore {
  recordEvent() {}
}

const env = createTestEnv({
  behaviorOrchestratorEnabled: true,
  modelAdapterLayerEnabled: true,
  behaviorCanaryMode: "off"
});

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: `corr_${Math.random()}`,
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: `msg_${Math.random()}`,
    message_type: "conversation",
    text: "",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: new Date().toISOString(),
    ...overrides
  };
}

describe("Candidate Intake Regression Fixture", () => {
  it("forces candidate to provide age, gender and daily time before progressing", async () => {
    const memoryStore = new InMemoryStore();
    const userStateStore = new TestUserStateStore();
    const eventLogStore = new TestEventLogStore();
    const deps = {
      env,
      sender: {
        sendText: vi.fn().mockResolvedValue({ success: true, messageId: "msg_out" })
      },
      memoryStore,
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore,
      eventLogStore,
      userRunLock: new UserRunLock(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      modelExecutionService: {
        execute: vi.fn().mockResolvedValue({ rawText: '{"contract_version":"1.0","reply":"Test","internal_boss_note":""}' })
      } as any
    };

    // 1. "Selam / İş nedir?"
    await handleIncomingMessage(message({ text: "Selam / İş nedir?" }), deps as any);
    
    // Model call blocked, intake reply sent
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();
    expect(deps.sender.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Merhaba, doğru yönlendirme yapabilmem için yaşını, cinsiyetini ve günlük ortalama kaç saat ayırabileceğini yazar mısın?"
      })
    );

    // 2. "Sadece Layla mı?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Sadece Layla mı?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 3. "Yaş cinsiyet önemli mi?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Yaş cinsiyet önemli mi?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 4. "Erkek profili ile bu iş nasıl yapılacak?"
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "Erkek profili ile bu iş nasıl yapılacak?" }), deps as any);
    expect(deps.modelExecutionService.execute).not.toHaveBeenCalled();

    // 5. Provide info
    vi.clearAllMocks();
    await handleIncomingMessage(message({ text: "25 kadın 4 saat ayırabilirim" }), deps as any);
    
    // Now model execution should happen
    expect(deps.modelExecutionService.execute).toHaveBeenCalled();
  });
});
