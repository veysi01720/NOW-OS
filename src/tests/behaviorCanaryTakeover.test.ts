import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CanaryObservationTracker } from "../behavior/CanaryObservationTracker.js";
import { rewriteReplyForQuality } from "../behavior/qualityRewrite.js";
import {
  buildConversationalQualityContract,
  validateConversationalReplyQuality,
} from "../behavior/conversationalQuality.js";
import { ConversationStateService } from "../behavior/conversationStateService.js";
import type { ConversationState, ResponsePlannerInput } from "../behavior/types.js";
import { loadEnv } from "../config/env.js";

const previousEnv = new Map<string, string | undefined>();

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  previousEnv.clear();
  for (const key of Object.keys(patch)) {
    previousEnv.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function plannerInput(overrides: Partial<ResponsePlannerInput> = {}): ResponsePlannerInput {
  return {
    channelType: "private",
    mode: "answer_mode",
    senderRole: "candidate",
    normalizedText: "Bu guvenli mi?",
    currentUserStage: "new",
    lastResolvedIntent: null,
    unresolvedObjections: [],
    completedTopics: [],
    pendingTopics: [],
    isGroup: false,
    isAuthorized: false,
    answerPlan: { mode: "answer_mode", intent: "normal_chat", source_count: 1 },
    ...overrides,
  };
}

function conversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    tenantId: "now_os",
    conversationId: "corr_behavior_b6",
    channelType: "private",
    currentMode: "answer_mode",
    userStage: "new",
    lastResolvedIntent: null,
    unresolvedObjections: [],
    completedTopics: [],
    pendingTopics: [],
    lastAssistantAction: "none",
    lastUserSentiment: "neutral",
    escalationStatus: "none",
    summary: "",
    textOnlyPreference: false,
    preferredWorkMode: "video_or_voice_allowed",
    videoAllowed: true,
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.CANARY_OBSERVATION_STORE_PATH;
  delete process.env.TENANT_CANARY_SECRET;
});

describe("B6 safe takeover hardening", () => {
  it("reserves behavior observations atomically and finalizes terminal outcomes once", () => {
    const dir = mkdtempSync(join(tmpdir(), "now-os-b6-observation-"));
    const storePath = join(dir, "canary_observations.json");
    process.env.CANARY_OBSERVATION_STORE_PATH = storePath;
    process.env.TENANT_CANARY_SECRET = "test-secret";

    try {
      expect(CanaryObservationTracker.reserveObservation("corr_1", "tenant", "approval_1", "905111111111")).toBe("reserved");
      expect(CanaryObservationTracker.reserveObservation("corr_1", "tenant", "approval_1", "905111111111")).toBe("duplicate");
      expect(CanaryObservationTracker.finalizeObservation("corr_1", "FAILED_TIMEOUT")).toBe("finalized");
      expect(CanaryObservationTracker.finalizeObservation("corr_1", "SUCCESS_SENT")).toBe("already_finalized");

      const stored = JSON.parse(readFileSync(storePath, "utf8"));
      expect(stored.observations).toHaveLength(1);
      expect(stored.observations[0]).toMatchObject({
        eventKey: "corr_1",
        scope: "tenant",
        terminalStatus: "FAILED_TIMEOUT",
      });
      expect(stored.observations[0].subjectKey).not.toContain("905111111111");
      expect(JSON.stringify(stored)).not.toContain("905111111111");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps tenant canary disabled by default in env parsing", () => {
    const env = withEnv({
      PORT: "3000",
      EVOLUTION_API_BASE_URL: "http://evolution.local",
      EVOLUTION_INSTANCE: "instance",
      EVOLUTION_API_KEY: "test",
      OPENAI_API_KEY: "test",
      OPENAI_ASSISTANT_ID: "asst_test",
      OWNER_PHONE_NUMBERS: "",
      MANAGER_PHONE_NUMBERS: "",
      SYSTEM_PROMPT_VERSION: "1.0.0",
      KNOWLEDGE_BASE_VERSION: "2026.07.04",
      BACKEND_CONTEXT_VERSION: "1.0",
      STATE_MACHINE_VERSION: "1.0",
      ASSISTANT_RESPONSE_CONTRACT_VERSION: "1.0",
      BEHAVIOR_ORCHESTRATOR_ENABLED: "true",
      BEHAVIOR_CANARY_MODE: "internal",
      BEHAVIOR_TENANT_CANARY_ENABLED: undefined,
    }, () => loadEnv());

    expect(env.behaviorOrchestratorEnabled).toBe(true);
    expect(env.behaviorCanaryMode).toBe("internal");
    expect(env.behaviorTenantCanaryEnabled).toBe(false);
  });

  it("performs one controlled quality rewrite and revalidates before outbound", () => {
    const quality = buildConversationalQualityContract(
      plannerInput({ normalizedText: "Bu guvenli mi dolandirici degil dimi?" }),
      { objective: "reassure", desiredLength: "very_short", mayAskQuestion: false, shouldAvoidRepetition: false },
    );
    const first = validateConversationalReplyQuality("Patron kesin guvenli, hic risk yok.", "", quality);

    expect(first.ok).toBe(false);
    expect(first.violations).toEqual(expect.arrayContaining([
      "unsupported_absolute_claim",
      "authority_title_for_non_managerial_reply",
    ]));

    const rewrite = rewriteReplyForQuality({
      reply: "Patron kesin guvenli, hic risk yok.",
      internalBossNote: "",
      quality,
      violations: first.violations,
    });
    const second = validateConversationalReplyQuality(rewrite.reply, "", quality);

    expect(rewrite.rewriteApplied).toBe(true);
    expect(second.ok).toBe(true);
    expect(rewrite.reply.toLocaleLowerCase("tr-TR")).not.toContain("patron");
    expect(rewrite.reply.toLocaleLowerCase("tr-TR")).not.toContain("kesin guvenli");
    expect(rewrite.reply.toLocaleLowerCase("tr-TR")).not.toContain("hic risk yok");
  });

  it("flags exact live unsupported reference offers with deterministic reason code", () => {
    const quality = buildConversationalQualityContract(
      plannerInput({ normalizedText: "Bu guvenli mi dolandirici degil dimi?" }),
      { objective: "reassure", desiredLength: "short", mayAskQuestion: false, shouldAvoidRepetition: false },
    );

    expect(validateConversationalReplyQuality(
      "Referans paylaşabileceğinizi belirtebilirsiniz.",
      "",
      quality,
    ).violations).toContain("UNSUPPORTED_REFERENCE_OFFER");
    expect(validateConversationalReplyQuality(
      "Dilersen daha önce başlayanlardan referans da paylaşabilirim.",
      "",
      quality,
    ).violations).toContain("UNSUPPORTED_REFERENCE_OFFER");
  });

  it("blocks repeated owner address using recent assistant reply state", () => {
    const quality = buildConversationalQualityContract(
      plannerInput({ senderRole: "owner", isAuthorized: true, normalizedText: "rapor ver" }),
      { objective: "answer", desiredLength: "short", mayAskQuestion: false, shouldAvoidRepetition: false },
    );

    expect(validateConversationalReplyQuality(
      "Şef, kısa özet şu.",
      "",
      quality,
      { recentAssistantReplies: ["Şef, önceki cevapta durumu anlattım."] },
    ).violations).toContain("REPEATED_OWNER_ADDRESS");
  });

  it("blocks known text-only preference restatement and keeps concise acceptance", () => {
    const quality = buildConversationalQualityContract(
      plannerInput({
        senderRole: "owner",
        isAuthorized: true,
        currentUserStage: "interested",
        normalizedText: "Tamam, görüntülüyü hiç istemiyor; sadece yazışma üzerinden ilerleyelim.",
      }),
      { objective: "answer", desiredLength: "very_short", mayAskQuestion: false, shouldAvoidRepetition: true },
    );

    expect(validateConversationalReplyQuality(
      "Tamam şef, bu adayla yalnızca mesajlaşma üzerinden ilerleyelim. Layla uygun.",
      "",
      quality,
      { recentAssistantReplies: [] },
    ).ok).toBe(true);
    expect(validateConversationalReplyQuality(
      "Görüntülü zorunlu değil, tamamen metin tabanlı çalışabilir. Layla uygun.",
      "",
      quality,
      { recentAssistantReplies: [] },
    ).violations).toContain("UNNECESSARY_CONTEXT_RESTATEMENT");
  });

  it("persists text-only preference as explicit backend business state", () => {
    const service = new ConversationStateService();
    const current = conversationState();
    const plan = {
      objective: "answer" as const,
      desiredLength: "short" as const,
      mayAskQuestion: true,
      shouldUseKnowledge: true,
      shouldAcknowledgeEmotion: false,
      shouldAvoidRepetition: false,
      forbiddenTopics: [],
      requiresModelCall: true,
      quality: buildConversationalQualityContract(plannerInput(), {
        objective: "answer",
        desiredLength: "short",
        mayAskQuestion: true,
        shouldAvoidRepetition: false,
      }),
    };

    const proposal = service.proposeTransition(
      current,
      { reply: "Tamam, yazili ilerleyebiliriz.", internal_boss_note: "" },
      plan,
      "Sadece mesajlasmak istiyorum",
    );
    const result = service.validateTransition(current, proposal);

    expect(result.ok).toBe(true);
    expect(result.next.textOnlyPreference).toBe(true);
    expect(result.next.preferredWorkMode).toBe("text_only");
    expect(result.next.videoAllowed).toBe(false);
  });
});
