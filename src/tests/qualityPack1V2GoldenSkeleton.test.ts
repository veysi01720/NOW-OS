import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleIncomingMessage, type HandleIncomingMessageDeps } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState, type UserState } from "../storage/types.js";
import {
  createSilentLogger,
  createTestEnv,
  FakeAssistantClient,
  FakeSender,
  InMemoryUserStateStore,
} from "./testDoubles.js";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";

const CANDIDATE_PHONE = "905550000001";
const OWNER_PHONE = "905111111111";

function normalizedText(value: string): string {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/gu, "i");
}

function candidateMessage(text: string, id: string, phone = CANDIDATE_PHONE): NormalizedIncomingMessage {
  return {
    correlation_id: `qp1_corr_${id}`,
    sender_id: phone,
    phone_number: phone,
    remote_jid: `${phone}@s.whatsapp.net`,
    message_id: id,
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-22T12:00:00.000Z",
  };
}

function ownerMessage(text: string, id: string): NormalizedIncomingMessage {
  return {
    ...candidateMessage(text, id, OWNER_PHONE),
    correlation_id: `qp1_owner_corr_${id}`,
  };
}

function decision(input: {
  text: string;
  intent?: string;
  actions?: string[];
  statePatch?: Record<string, unknown>;
  facts?: string[];
  nextAction?: string;
  direct?: boolean;
}): string {
  return JSON.stringify({
    decision_version: "2.0",
    intent: { primary: input.intent ?? "candidate_next_step", secondary: [], confidence: 0.94 },
    direct_question: {
      present: input.direct ?? false,
      question_summary: input.direct ? "Aday dogrudan bilgi istiyor" : null,
      answered_in_reply: true,
    },
    reply: {
      text: input.text,
      language: "tr",
      tone: "natural_concise",
      contains_question: input.text.includes("?"),
    },
    chosen_actions: input.actions ?? ["answer_user_question"],
    state_patch: input.statePatch ?? {},
    policy_facts_used: input.facts ?? [],
    next_action: input.nextAction ?? "none",
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false,
    },
  });
}

function makeDeps(responses: string[] = [], initialState?: Partial<UserState>): HandleIncomingMessageDeps & {
  assistantClient: FakeAssistantClient;
  sender: FakeSender;
  userStateStore: InMemoryUserStateStore;
  logger: ReturnType<typeof createSilentLogger>;
} {
  const userStateStore = new InMemoryUserStateStore();
  if (initialState) {
    userStateStore.updateState(CANDIDATE_PHONE, {
      ...defaultUserState(),
      ...initialState,
      missing_fields: [...(initialState.missing_fields ?? [])],
    });
  }

  const assistantClient = new FakeAssistantClient(responses);
  const sender = new FakeSender();
  const logger = createSilentLogger();

  return {
    env: createTestEnv({
      conversationDecisionV2Enabled: true,
      approvedApps: ["Layla", "Soyo", "Amar", "Timo"],
    }),
    assistantClient,
    sender,
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userStateStore,
    userRunLock: new UserRunLock(),
    logger,
  };
}

function workModelAcceptanceState(): Partial<UserState> {
  return {
    current_state: "WORK_MODEL_ACCEPTANCE",
    age: 27,
    gender: "erkek",
    daily_hours: 4,
    eligibility_status: "eligible",
    work_model_disclosed: true,
    model_acceptance: "pending",
    selected_app: null,
    phone_type: null,
    installation_status: "not_started",
    training_status: "not_started",
    missing_fields: ["model_acceptance"],
    expected_next_step: "ask_work_model_acceptance",
  };
}

function extractJsonBlock(content: string, tag: string): any {
  const match = content.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n<\\/${tag}>`));
  if (!match) throw new Error(`${tag} block missing`);
  return JSON.parse(match[1]);
}

function latestRunContent(deps: { assistantClient: FakeAssistantClient }): string {
  const content = deps.assistantClient.runCalls.at(-1)?.content;
  if (!content) throw new Error("assistant run content missing");
  return content;
}

describe("Quality Pack 1 V2 golden skeletons", () => {
  let knowledgeBankDir: string;
  let previousKnowledgeBankDir: string | undefined;

  beforeEach(() => {
    previousKnowledgeBankDir = process.env.KNOWLEDGE_BANK_DIR;
    knowledgeBankDir = mkdtempSync(join(tmpdir(), "qp1-knowledge-bank-"));
    writeValidKnowledgeBankFixture(knowledgeBankDir, { includeTimo: true });
    process.env.KNOWLEDGE_BANK_DIR = knowledgeBankDir;
  });

  afterEach(() => {
    if (previousKnowledgeBankDir === undefined) {
      delete process.env.KNOWLEDGE_BANK_DIR;
    } else {
      process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeBankDir;
    }
    rmSync(knowledgeBankDir, { recursive: true, force: true });
  });

  it("captures whether official app facts reach the V2 assistant prompt for job-definition answers", async () => {
    const reply =
      "Isin temel kismi Layla icinde gelen sohbetlere yaziyla cevap vermek. Kamera zorunlu diye bir kural soylemiyoruz; once yas, cinsiyet ve gunluk saat bilgisini netlestirelim.";
    const deps = makeDeps([
      decision({
        text: reply,
        intent: "ask_job_definition",
        actions: ["answer_user_question", "explain_work_model", "ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
        facts: ["candidate_work_steps_chat_based"],
        nextAction: "ask_missing_age",
        direct: true,
      }),
    ]);

    await handleIncomingMessage(candidateMessage("is nedir?", "job-definition"), deps);

    const prompt = latestRunContent(deps);
    const backendContext = extractJsonBlock(prompt, "backend_context_json");
    const decisionContext = extractJsonBlock(prompt, "conversation_decision_context_json");

    expect(backendContext.structured_facts.app_facts_source_status).toBe("loaded");
    expect(JSON.stringify(backendContext.structured_facts.app_facts)).toContain("NIVI");
    expect(decisionContext.latest_message.inferred_intent).toBe("ask_job_definition");
    expect(decisionContext.canonical_policy_facts.map((fact: any) => fact.id)).toContain("candidate_default_work_model");
    expect(prompt).toContain("Use only canonical_policy_facts and candidate_state.");
  });

  it("carries candidate-provided prerequisites into the next V2 prompt context", async () => {
    const deps = makeDeps([
      decision({
        text: "Bilgilerini aldim. Layla icinde sohbetlere yaziyla cevap vererek ilerlersin; bu calisma modeli sana uygun mu?",
        intent: "candidate_next_step",
        actions: ["acknowledge_information", "explain_work_model", "request_work_model_acceptance"],
        statePatch: { work_model_disclosed: true, work_model_acceptance: "pending" },
        facts: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
        nextAction: "request_work_model_acceptance",
      }),
      decision({
        text: "Evet, az once verdigin yas, cinsiyet ve saat bilgilerini dikkate alarak devam ediyorum.",
        intent: "candidate_next_step",
        actions: ["answer_user_question"],
        facts: ["male_candidate_work_model", "candidate_work_steps_chat_based"],
      }),
    ]);

    await handleIncomingMessage(candidateMessage("27 erkek gunde 4 saat", "prereq-1"), deps);
    await handleIncomingMessage(candidateMessage("Tamam devam", "prereq-2"), deps);

    const secondPrompt = latestRunContent(deps);
    const decisionContext = extractJsonBlock(secondPrompt, "conversation_decision_context_json");

    expect(decisionContext.candidate_state).toEqual(expect.objectContaining({
      age: 27,
      gender: "erkek",
      daily_hours: 4,
    }));
    expect(decisionContext.derived_state.intake_complete).toBe(true);
    expect(decisionContext.facts_extracted_from_current_message).toContain("model_acceptance");
  });

  it("repairs a live work-model parrot reply instead of sending the same answer again", async () => {
    const liveDuplicateReply =
      "Bilgilerini aldim. Onayli uygulama icinde temel is, gelen sohbet veya mesajlara yaziyla duzenli cevap vermek. Kamera ya da goruntulu calisma zorunlu diye bir kural soylemiyoruz; mesajlasma agirlikli ilerleyebilirsin. Kuruluma gecmeden once bu calisma modeli sana uygun mu?";
    const repeatSafeFastPathReply =
      "Selam, buradayim. Calisma modeli mesajlara yaziyla cevap verme uzerine; hangi nokta takildiysa onu netlestireyim. Bu model sana uygunsa 'uygun' yazman yeterli.";
    const deps = makeDeps([], workModelAcceptanceState());
    deps.memoryStore.appendBotReply(CANDIDATE_PHONE, liveDuplicateReply);

    await handleIncomingMessage(candidateMessage("Selam", "live-parrot-work-model"), deps);

    expect(deps.sender.sends).toHaveLength(1);
    expect(deps.sender.sends[0]?.text).toBe(repeatSafeFastPathReply);
    expect(deps.sender.sends[0]?.text).not.toBe(liveDuplicateReply);
    expect(deps.assistantClient.runCalls).toHaveLength(0);
    expect(deps.logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "CONVERSATION_DECISION_V2_TRACE",
        final_reply_origin: "deterministic_work_model_acceptance_fast_path",
        model_call_count: 0,
      }),
    ]));
  });

  it("repairs a live frustration parrot reply before repeating the stale setup template", async () => {
    const liveDuplicateReply = "Tamam, bilgiler tamam. Simdi kurulum adimina gecebiliriz.";
    const repairedReply =
      "Haklisin, once net anlatayim: is mesajlara yaziyla cevap verme uzerine. Hesap veya profil icin dogrulanmis kural yoksa onu soylemem.";
    const deps = makeDeps([
      decision({
        text: liveDuplicateReply,
        intent: "candidate_next_step",
        actions: ["answer_user_question"],
        facts: ["candidate_work_steps_chat_based"],
      }),
      decision({
        text: repairedReply,
        intent: "candidate_next_step",
        actions: ["answer_user_question", "handle_user_frustration"],
        facts: ["candidate_work_steps_chat_based"],
      }),
    ], {
      current_state: "READY_FOR_INSTALLATION",
      age: 25,
      gender: "erkek",
      daily_hours: 7,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: "Layla",
      phone_type: "android",
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: [],
      expected_next_step: "start_installation",
    });
    deps.memoryStore.appendBotReply(CANDIDATE_PHONE, liveDuplicateReply);

    await handleIncomingMessage(candidateMessage("Dalga mi geciyorsunuz efendim", "live-parrot-frustration"), deps);

    expect(deps.sender.sends).toHaveLength(1);
    expect(deps.sender.sends[0]?.text).toBe(repairedReply);
    expect(deps.sender.sends[0]?.text).not.toBe(liveDuplicateReply);
    expect(deps.assistantClient.runCalls).toHaveLength(2);
    expect(deps.logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "CONVERSATION_DECISION_V2_TRACE",
        quality_reason_codes: expect.arrayContaining(["RECENT_REPLY_REPEATED"]),
        mutation_source: "model_repair",
      }),
    ]));
  });

  it("captures the owner tone override in the legacy Assistants prompt until live examples define assertions", async () => {
    const deps = makeDeps([
      JSON.stringify({
        contract_version: "1.0",
        reply: "Bunu inceleme kuyruguna aldim. Onaylaninca aktif olacak.",
        internal_boss_note: "",
      }),
    ]);

    await handleIncomingMessage(ownerMessage("Bundan sonra daha sade ve netsiz jargon olmadan konus", "tone-override"), deps);

    const prompt = latestRunContent(deps);
    const backendContext = extractJsonBlock(prompt, "backend_context_json");

    expect(backendContext.sender_role).toBe("owner");
    expect(backendContext.owner_instruction_override).toBeDefined();
    expect(backendContext.owner_instruction_override.rule).toContain("internal_boss_note");
  });

  it("answers guarantee and payment pressure with the deterministic V2 safety boundary", async () => {
    const deps = makeDeps([
      decision({
        text: "Garanti kazanc var, kesin odeme alirsin.",
        intent: "payment_question",
        actions: ["answer_user_question"],
        direct: true,
      }),
      decision({
        text: "Haftalik 10000 TL kesin odeme var.",
        intent: "payment_question",
        actions: ["answer_user_question"],
        direct: true,
      }),
    ], workModelAcceptanceState());

    await handleIncomingMessage(candidateMessage("Garanti kazanc var mi, kesin odeme alir miyim?", "payment-boundary"), deps);

    const reply = deps.sender.sends[0]?.text ?? "";
    expect(reply).toContain("Dogrulanmis kazanc veya odeme detayi yok");
    expect(reply).toContain("Vaat vermeden ekip netlestirsin");
    expect(normalizedText(reply)).not.toMatch(/garanti|kesin|haftalik|aylik|\btl\b/u);
    expect(deps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          final_reply_origin: "deterministic_safety_response",
          mutation_source: "deterministic_safety_response",
          quality_reason_codes: expect.arrayContaining(["UNSUPPORTED_CLAIM"]),
        }),
      ])
    );
  });

  it("answers camera, account, and profile pressure with the deterministic V2 policy boundary", async () => {
    const deps = makeDeps([
      decision({
        text: "Kamera acman ve erkek profil acman gerekiyor.",
        intent: "account_profile_question",
        actions: ["answer_user_question"],
        direct: true,
      }),
      decision({
        text: "Erkek hesap acilacak, kamera zorunlu.",
        intent: "account_profile_question",
        actions: ["answer_user_question"],
        direct: true,
      }),
    ], workModelAcceptanceState());

    await handleIncomingMessage(candidateMessage("Kamera acacak miyim, erkek hesap veya profil zorunlu mu?", "camera-account-boundary"), deps);

    const reply = deps.sender.sends[0]?.text ?? "";
    expect(reply).toContain("Kamera veya goruntulu calisma zorunlu diye onayli kural soylemiyoruz");
    expect(reply).toContain("Erkek hesap/profil acma zorunlulugu da dogrulanmis degil");
    expect(normalizedText(reply)).not.toMatch(/acman gerekiyor|kamera acmalisin|erkek hesap acilacak/u);
    expect(deps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          final_reply_origin: "deterministic_safety_response",
          mutation_source: "deterministic_safety_response",
          quality_reason_codes: expect.arrayContaining(["MODEL_ACCEPTANCE_BYPASSED"]),
        }),
      ])
    );
  });
});
