import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import {
  createSilentLogger,
  createTestEnv,
  FakeAssistantClient,
  FakeSender,
  InMemoryUserStateStore
} from "./testDoubles.js";
import { writeValidKnowledgeBankFixture } from "./fixtures/knowledgeBankFixture.js";
import { buildDeterministicSafetyDecision } from "../intelligence/conversation/ConversationDecisionRepair.js";
import { inferConversationIntent } from "../intelligence/conversation/ConversationContextBuilder.js";
import { PersistentHumanHandoffStore } from "../store/humanHandoffStore.js";

const defaultKnowledgeDir = mkdtempSync(join(tmpdir(), "nowos-conversation-v2-facts-"));
writeValidKnowledgeBankFixture(defaultKnowledgeDir);
const previousKnowledgeBankDir = process.env.KNOWLEDGE_BANK_DIR;
beforeAll(() => {
  process.env.KNOWLEDGE_BANK_DIR = defaultKnowledgeDir;
});
afterAll(() => {
  if (previousKnowledgeBankDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
  else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeBankDir;
  rmSync(defaultKnowledgeDir, { recursive: true, force: true });
});

const PREVIOUS_WORK_MODEL_REPLY =
  "Bilgilerini aldım. Onaylı uygulamada mesajlaşma ağırlıklı ve kamera açmadan ilerleyen çalışma modelini açıklıyorum. Kuruluma geçmeden önce bu çalışma modelinin sana uygun olduğunu netleştirelim. Uygun mu?";

function message(text: string, id: string): NormalizedIncomingMessage {
  return {
    correlation_id: `corr_${id}`,
    sender_id: "905550000001",
    phone_number: "905550000001",
    remote_jid: "905550000001@s.whatsapp.net",
    message_id: id,
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-13T00:00:00.000Z"
  };
}

function decision(overrides: any = {}) {
  const base = {
    decision_version: "2.0",
    intent: { primary: "candidate_next_step", secondary: [], confidence: 0.9 },
    direct_question: { present: false, question_summary: null, answered_in_reply: true },
    reply: {
      text: "Layla uzerinden sohbet mesajlarina duzenli cevap vererek ilerlersin. Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; kurulumdan once bu calisma modelinin sana uygun oldugunu netlestirelim. Uygun mu?",
      language: "tr",
      tone: "natural_concise",
      contains_question: true
    },
    chosen_actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"],
    state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
    policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
    next_action: "request_work_model_acceptance",
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    self_check: {
      answered_latest_message: true,
      asked_known_information_again: false,
      invented_policy: false,
      offered_setup_too_early: false,
      used_generic_closing: false
    }
  };
  return JSON.stringify({ ...base, ...overrides });
}

function deps(responses: string[], envOverrides: Parameters<typeof createTestEnv>[0] = {}) {
  return {
    env: createTestEnv({
      conversationDecisionV2Enabled: true,
      approvedApps: ["Layla", "Soyo", "Amar", "Timo"],
      ...envOverrides
    }),
    assistantClient: new FakeAssistantClient(responses),
    sender: new FakeSender(),
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userStateStore: new InMemoryUserStateStore(),
    userRunLock: new UserRunLock(),
    knowledgeBankDir: defaultKnowledgeDir,
    logger: createSilentLogger()
  };
}

describe("Conversation Decision V2 candidate route", () => {
  it("routes an unrelated question to a light non-escalating reply, even with stale memory", () => {
    expect(inferConversationIntent("Arda kim?")).toBe("off_topic");
    const result = buildDeterministicSafetyDecision({
      request_id: "corr_off_topic",
      decision_version: "conversation_v2",
      tenant_id: "now_os",
      instance_id: "antigravity",
      channel: "private",
      role: "candidate",
      latest_message: {
        id: "msg_off_topic",
        text: "Arda kim?",
        timestamp: "2026-08-14T10:00:00.000Z",
        language: "tr",
        inferred_intent: "off_topic",
      },
      recent_messages: [
        { role: "assistant", text: "Bu cevabi guvenli sekilde netlestiremedim. Yanlis yonlendirmemek icin ekip kontrol etsin." },
      ],
      candidate_state: {
        age: null,
        gender: null,
        daily_hours: null,
        work_model_acceptance: null,
        selected_app: null,
        phone_type: null,
      },
      derived_state: {
        intake_complete: false,
        eligibility_status: "unresolved",
        dialogue_phase: "NEW_LEAD",
      },
      facts_extracted_from_current_message: [],
      canonical_policy_facts: [],
      structured_facts: { app_facts_source_status: "loaded", app_facts_source_hash: "fixture", app_facts: [], general_work_model: null, policy_sections: null, errors: [] },
      allowed_actions: ["answer_user_question", "respond_to_off_topic_question"],
      forbidden_actions: [],
      runtime_constraints: { max_reply_length: 800, max_questions: 1, must_answer_direct_question_first: true, facts_must_be_grounded: true, behavior_prompt_version: "conversation_behavior_v2.1" },
    }, "invalid_model_decision");

    expect(result.reply.text).toBe("Bu konu is veya kurulum tarafina girmiyor; isleyis, uygulama ya da kurulum adimlarinda yardimci olayim.");
    expect(result.reply.text).not.toMatch(/ekip|yonetici|kontrol/iu);
    expect(result.requires_escalation).toBe(false);
    expect(result.escalation_reason).toBeNull();
    expect(result.chosen_actions).toEqual(["respond_to_off_topic_question"]);
  });

  it("turns a single captured age into the next intake question instead of an escalation fallback", () => {
    const result = buildDeterministicSafetyDecision({
      request_id: "corr_partial_age",
      decision_version: "conversation_v2",
      tenant_id: "now_os",
      instance_id: "antigravity",
      channel: "private",
      role: "candidate",
      latest_message: {
        id: "msg_partial_age",
        text: "27",
        timestamp: "2026-08-13T10:21:07.000Z",
        language: "tr",
        inferred_intent: null,
      },
      recent_messages: [],
      candidate_state: {
        age: 27,
        gender: null,
        daily_hours: null,
        work_model_acceptance: null,
        selected_app: null,
        phone_type: null,
      },
      derived_state: {
        intake_complete: false,
        eligibility_status: "eligible",
        dialogue_phase: "NEW_LEAD",
      },
      facts_extracted_from_current_message: ["age"],
      canonical_policy_facts: [],
      structured_facts: {
        app_facts_source_status: "loaded",
        app_facts_source_hash: "fixture",
        app_facts: [],
        general_work_model: null,
        policy_sections: null,
        errors: [],
      },
      allowed_actions: ["answer_user_question", "ask_missing_gender", "ask_missing_daily_hours"],
      forbidden_actions: [],
      runtime_constraints: {
        max_reply_length: 800,
        max_questions: 1,
        must_answer_direct_question_first: true,
        facts_must_be_grounded: true,
        behavior_prompt_version: "conversation_behavior_v2.1",
      },
    }, "invalid_model_decision");

    expect(result).not.toBeNull();
    expect(result?.next_action).toBe("ask_missing_gender");
    expect(result?.chosen_actions).toEqual([
      "answer_user_question",
      "ask_missing_gender",
      "ask_missing_daily_hours",
    ]);
    expect(result?.reply.text).toContain("cinsiyetini");
    expect(result?.reply.text).toContain("gunluk ayirabilecegin sureyi");
    expect(result?.requires_escalation).toBe(false);
  });

  it("blocks generic closers and incomplete job-definition answers", async () => {
    const incomplete = "İş, Layla uygulamasında sohbet ederek ilerliyor. Kamera zorunlu değil, ekip adım adım yönlendirecek. Başka sormak istediğin var mı?";
    const complete = "Çalışma telefon ve uygulama üzerinden ilerler; profil hazırlanır ve uygulama içindeki kişilerle sohbet edilir.";
    const testDeps = deps([
      decision({
        intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.8 },
        reply: { text: incomplete, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["answer_user_question", "explain_work_model"],
        policy_facts_used: ["male_candidate_work_model", "candidate_work_steps_chat_based"]
      }),
      decision({
        intent: { primary: "ask_job_definition", secondary: [], confidence: 0.95 },
        direct_question: { present: true, question_summary: "Aday işin ne olduğunu soruyor", answered_in_reply: true },
        reply: { text: complete, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question", "explain_work_model", "ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
        policy_facts_used: ["general_work_model"],
        next_action: "ask_missing_age"
      })
    ]);

    const previousKnowledgeDir = process.env.KNOWLEDGE_BANK_DIR;
    const knowledgeDir = mkdtempSync(join(tmpdir(), "nowos-job-definition-facts-"));
    writeValidKnowledgeBankFixture(knowledgeDir);
    process.env.KNOWLEDGE_BANK_DIR = knowledgeDir;
    try {
      await handleIncomingMessage(message("Selam iş nedir", "job-definition"), testDeps);
    } finally {
      if (previousKnowledgeDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
      else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeDir;
      rmSync(knowledgeDir, { recursive: true, force: true });
    }

    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(complete);
    expect(testDeps.sender.sends[0]?.text).not.toContain("Başka sormak istediğin");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          intent: "ask_job_definition",
          final_reply_origin: "deterministic_safety_response",
          mutation_source: "final_validation_safety_response",
          validation_reason_codes: expect.arrayContaining(["JOB_EXPLANATION_INCOMPLETE"]),
          quality_reason_codes: expect.arrayContaining(["JOB_EXPLANATION_INCOMPLETE"])
        })
      ])
    );
  });

  it("keeps greeting and first-contact replies on the V2 model path instead of safe fallback", async () => {
    const greetingReply = "Merhaba, iş için ilerleyebilmem adına yaşını, cinsiyetini ve günlük kaç saat ayırabileceğini yazar mısın?";
    const staleStateGreetingReply = "Merhaba, buradayım. Kaldığımız yerden devam edebiliriz; hangi adımda destek istediğini yazabilirsin.";
    const testDeps = deps([
      decision({
        intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.95 },
        reply: { text: greetingReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
        policy_facts_used: [],
        next_action: "ask_missing_age"
      }),
      decision({
        intent: { primary: "greeting_or_first_contact", secondary: [], confidence: 0.95 },
        reply: { text: staleStateGreetingReply, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question"],
        policy_facts_used: []
      })
    ]);

    await handleIncomingMessage(message("Selam iş için yazdım", "first-contact"), testDeps);
    testDeps.userStateStore.states.set("905550000001", {
      current_state: "READY_FOR_INSTALLATION",
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: "Layla",
      phone_type: "android",
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: [],
      expected_next_step: "start_installation"
    } as any);
    await handleIncomingMessage(message("Selam", "stale-greeting"), testDeps);

    expect(testDeps.sender.sends[0]?.text).toBe(greetingReply);
    expect(testDeps.sender.sends[1]?.text).toBe(staleStateGreetingReply);
    expect(testDeps.sender.sends.map((item) => item.text).join("\n")).not.toContain("Bu cevabı güvenli şekilde netleştiremedim");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          intent: "candidate_first_contact",
          final_reply_origin: "conversation_decision_v2_model",
          mutation_source: null
        }),
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          intent: "greeting_or_first_contact",
          final_reply_origin: "conversation_decision_v2_model",
          mutation_source: null
        })
      ])
    );
  });

  it("uses the model for work-model acceptance nudges without direct questions", async () => {
    const testDeps = deps([decision({
      reply: { text: "Telefon ve uygulama uzerinden ilerlersin. Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; bu model sana uygun mu?", language: "tr", tone: "natural_concise", contains_question: true },
      chosen_actions: ["acknowledge_information", "explain_work_model", "request_work_model_acceptance"],
      state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
      policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
      next_action: "request_work_model_acceptance"
    })]);
    const previousKnowledgeDir = process.env.KNOWLEDGE_BANK_DIR;
    const knowledgeDir = mkdtempSync(join(tmpdir(), "nowos-fast-path-facts-"));
    writeValidKnowledgeBankFixture(knowledgeDir);
    process.env.KNOWLEDGE_BANK_DIR = knowledgeDir;
    testDeps.userStateStore.states.set("905550000001", {
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
      expected_next_step: "ask_work_model_acceptance"
    } as any);

    try {
      await handleIncomingMessage(message("Selam is icin yazdim", "fast-work-model"), testDeps);
    } finally {
      if (previousKnowledgeDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
      else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeDir;
      rmSync(knowledgeDir, { recursive: true, force: true });
    }

    expect(testDeps.assistantClient.runCalls).toHaveLength(1);
    expect(testDeps.assistantClient.createThreadCalls).toBe(1);
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toMatch(/telefon ve uygulama/i);
    expect(testDeps.sender.sends[0]?.text).toMatch(/model sana uygun mu/i);
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/kamera|goruntulu/iu);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
        event_type: "CONVERSATION_DECISION_V2_TRACE",
          final_reply_origin: "conversation_decision_v2_model",
          model_call_count: 1
        })
      ])
    );
  });

  it("reuses the stable conversation thread for V2 model calls", async () => {
    const firstReply = "Merhaba, ilerleyebilmem icin yas, cinsiyet ve gunluk kac saat ayirabilecegini yazar misin?";
    const secondReply = "Bilgilerini aldim. Onayli uygulama icinde sohbetlere yaziyla cevap vererek ilerlersin. Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; kurulumdan once bu calisma modeli sana uygun mu?";
    const testDeps = deps([
      decision({
        intent: { primary: "candidate_first_contact", secondary: [], confidence: 0.95 },
        reply: { text: firstReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["ask_missing_age", "ask_missing_gender", "ask_missing_daily_hours"],
        policy_facts_used: [],
        next_action: "ask_missing_age"
      }),
      decision({
        intent: { primary: "candidate_next_step", secondary: [], confidence: 0.95 },
        reply: { text: secondReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["acknowledge_information", "explain_work_model", "request_work_model_acceptance"],
        state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
        policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
        next_action: "request_work_model_acceptance"
      })
    ]);

    await handleIncomingMessage(message("Selam is icin yazdim", "thread-reuse-1"), testDeps);
    await handleIncomingMessage(message("27 erkek 4", "thread-reuse-2"), testDeps);

    expect(testDeps.assistantClient.createThreadCalls).toBe(1);
    expect(testDeps.assistantClient.runCalls).toHaveLength(2);
    expect(testDeps.assistantClient.runCalls.map((call) => call.threadId)).toEqual(["thread_1", "thread_1"]);
  });

  it("repairs missing WORK_MODEL_DISCLOSURE actions after compact intake", async () => {
    const repairedReply =
      "Onayli uygulama icinde gelen sohbetlere yaziyla cevap vererek ilerlersin. Bu calisma modeli sana uygunsa uygun yazman yeterli. Erkek adaylarda calisma kadin profili acilmasi ve kadin fotograflari kullanilmasi uzerinden ilerler; bu model senin icin uygunsa acik onayinla devam ederiz.";
    const testDeps = deps([
      decision({
        reply: {
          text: "Bilgilerini aldim; once yasini tekrar netlestirelim.",
          language: "tr",
          tone: "natural_concise",
          contains_question: true
        },
        chosen_actions: ["answer_user_question", "ask_missing_age"],
        state_patch: {},
        next_action: "ask_missing_age"
      }),
      decision({
        reply: { text: repairedReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"],
        state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
        policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
        next_action: "request_work_model_acceptance"
      })
    ]);

    await handleIncomingMessage(message("27 erkek 4 saat", "work-model-disclosure-repair"), testDeps);

    expect(testDeps.assistantClient.runCalls).toHaveLength(2);
    expect(testDeps.assistantClient.runCalls[0]?.content).toContain("WORK_MODEL_DISCLOSURE positive example");
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("WORK_MODEL_DISCLOSURE_ACTIONS_MISSING");
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("explain_work_model");
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("request_work_model_acceptance");
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(repairedReply);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          final_reply_origin: "conversation_decision_v2_model_repair",
          mutation_source: expect.stringContaining("model_repair")
        })
      ])
    );
  });

  it("does not repeat the exact production work-model paragraph on clarification", async () => {
    const simpleClarification = "Basitce soyle: onayli uygulamada gelen sohbetlere yaziyla cevap vererek ilerlersin. Erkek adaylarda calisma kadin profili acilmasi ve kadin fotograflari kullanilmasi uzerinden ilerler. Once bu mesajlasma agirlikli calisma biciminin sana uyup uymadigini netlestiriyoruz.";
    const testDeps = deps([
      decision({ reply: { text: PREVIOUS_WORK_MODEL_REPLY, language: "tr", tone: "natural_concise", contains_question: true } }),
      decision({
        intent: { primary: "clarify_previous_explanation", secondary: [], confidence: 0.95 },
        direct_question: { present: true, question_summary: "Aday çalışma modelini anlamadığını söylüyor", answered_in_reply: true },
        reply: { text: PREVIOUS_WORK_MODEL_REPLY, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["answer_user_question", "clarify_previous_explanation", "explain_work_model", "request_work_model_acceptance"]
      }),
      decision({
        intent: { primary: "clarify_previous_explanation", secondary: [], confidence: 0.95 },
        direct_question: { present: true, question_summary: "Aday çalışma modelini anlamadığını söylüyor", answered_in_reply: true },
        reply: { text: simpleClarification, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question", "clarify_previous_explanation", "explain_work_model"]
      })
    ]);

    await handleIncomingMessage(message("27 erkek 4", "m1"), testDeps);
    await handleIncomingMessage(message("Çalışma modelini anlamadım", "m2"), testDeps);

    expect(testDeps.assistantClient.runCalls).toHaveLength(3);
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("conversation_behavior_v2.1");
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("clarify_previous_explanation");
    expect(testDeps.sender.sends[1]?.text).toBe(simpleClarification);
    expect(testDeps.sender.sends[1]?.text).not.toBe(PREVIOUS_WORK_MODEL_REPLY);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          intent: "clarify_previous_explanation",
          final_reply_origin: "conversation_decision_v2_model_repair",
          reply_mutated_after_model: true,
          mutation_source: expect.stringContaining("model_repair")
        })
      ])
    );
  });

  it("guides Terra away from repeating a recent work-model acceptance closing", async () => {
    const testDeps = deps([
      decision({
        reply: { text: "Calisma modelini anlattim. Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; bu model sana uygun mu?", language: "tr", tone: "natural_concise", contains_question: true },
      }),
      decision({
        intent: { primary: "candidate_next_step", secondary: [], confidence: 0.9 },
        reply: { text: "Evet, bu noktayi aciklayayim ve sonraki adimi netlestireyim.", language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question", "explain_work_model"],
        state_patch: {},
        next_action: "reply_only",
      }),
    ]);

    await handleIncomingMessage(message("27 erkek 4 saat", "acceptance-preference-1"), testDeps);
    await handleIncomingMessage(message("Bu iste sonra ne olacak?", "acceptance-preference-2"), testDeps);

    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("A conversational preference");
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("do not automatically ask the same closing again");
    expect(testDeps.sender.sends[1]?.text).not.toMatch(/calisma modeli sana uygun mu/iu);
  });

  it("preserves a valid unique model reply without stage template overwrite", async () => {
    const unique = "MODEL_UNIQUE_REPLY_78421 Sana sureci kisa anlatayim: uygulama icinde yaziyla sohbetlere cevap verirsin; sonraki adim telefon ve uygulama bilgisini netlestirmek.";
    const testDeps = deps([
      decision({
        intent: { primary: "ask_how_work_is_done", secondary: [], confidence: 0.95 },
        direct_question: { present: true, question_summary: "Aday isin nasil yapilacagini soruyor", answered_in_reply: true },
        reply: { text: unique, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question"],
        state_patch: {},
        policy_facts_used: []
      })
    ]);
    const existing = testDeps.userStateStore.states.get("905550000001");
    testDeps.userStateStore.states.set("905550000001", {
      ...(existing ?? {}),
      current_state: "WORK_MODEL_ACCEPTANCE",
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: [],
      expected_next_step: "none"
    } as any);

    await handleIncomingMessage(message("Bu işi nasıl yapacağım?", "unique"), testDeps);

    expect(testDeps.assistantClient.runCalls).toHaveLength(1);
    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(unique);
  });

  it("calls the model for semantic candidate messages and blocks generic template fallback", async () => {
    const testDeps = deps([
      decision({
        intent: { primary: "ask_how_work_is_done", secondary: [], confidence: 0.9 },
        direct_question: { present: true, question_summary: "Aday işin nasıl yapılacağını soruyor", answered_in_reply: true },
        reply: {
          text: "Onayli uygulamada sohbetlere yaziyla cevap vererek ilerlersin. Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; once bu calisma modeli sana uyuyor mu?",
          language: "tr",
          tone: "natural_concise",
          contains_question: true
        }
      })
    ]);

    await handleIncomingMessage(message("27 erkek 4", "how-work"), testDeps);

    expect(testDeps.assistantClient.runCalls).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toContain("sohbetlere");
    expect(testDeps.sender.sends[0]?.text).not.toContain("Başka merak");
  });

  it("answers the male account question without inventing unsupported profile rules", async () => {
    const answer = "Erkek adaylarda calisma kadin profili acilmasi ve uygun kadin fotograflari kullanilmasi uzerinden ilerler; bu model sana uygunsa acik onayinla devam ederiz.";
    const testDeps = deps([
      decision({
        intent: { primary: "ask_how_work_is_done", secondary: ["account_profile_question"], confidence: 0.92 },
        direct_question: { present: true, question_summary: "Aday erkek hesabı açılıp açılmayacağını soruyor", answered_in_reply: true },
        reply: { text: answer, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question"],
        state_patch: {},
        policy_facts_used: []
      })
    ]);
    testDeps.userStateStore.states.set("905550000001", {
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
      expected_next_step: "ask_work_model_acceptance"
    } as any);

    await handleIncomingMessage(message("Erkek hesabı mı açacağız?", "male-account"), testDeps);

    expect(testDeps.sender.sends[0]?.text).toMatch(/(kadin|profil|foto)/iu);
    expect(testDeps.sender.sends[0]?.text).not.toContain("ekip");
    expect(testDeps.sender.sends[0]?.text).not.toContain("kurulum");
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/sahte kimlik|izinsiz|yasak|uydur|iddia edemem/iu);
  });

  it("preempts a missing structured app download link and queues owner review without model guessing", async () => {
    const handoffDir = mkdtempSync(join(tmpdir(), "missing-link-handoff-"));
    const handoffStore = new PersistentHumanHandoffStore(join(handoffDir, "handoffs.json"));
    const testDeps = {
      ...deps([], { approvedApps: ["Layla", "TanChat", "Soyo", "Amar", "Timo", "Linky"] }),
      humanHandoffStore: handoffStore,
    };
    testDeps.userStateStore.states.set("905550000001", {
      current_state: "READY_FOR_INSTALLATION",
      age: 27,
      gender: "erkek",
      daily_hours: 4,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: "TanChat",
      phone_type: "android",
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: [],
      expected_next_step: "start_installation",
    } as any);

    try {
      await handleIncomingMessage(message("TanChat'i nereden indiririm?", "tanchat-missing-link"), testDeps);
    } finally {
      rmSync(handoffDir, { recursive: true, force: true });
    }

    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    expect(handoffStore.list()).toHaveLength(1);
    expect(handoffStore.list()[0]?.reason_code).toBe("structured_app_field_missing");
    const candidateReply = testDeps.sender.sends.at(-1)?.text ?? "";
    expect(candidateReply).toMatch(/kontrol|donecegim|yanitlayacagim|dÃ¶neceÄŸim|yanÄ±tlayacaÄŸÄ±m/iu);
    expect(candidateReply).not.toMatch(/play store|app store|apk|market/iu);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_FAST_PATH_SELECTED",
          fast_path: "structured_app_field_missing",
          model_call_count: 0,
        }),
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          final_reply_origin: "deterministic_safety_response",
          mutation_source: "structured_app_field_missing",
          model_call_count: 0,
        }),
      ]),
    );
  });

  it("uses the shared acceptance normalizer for Uygub and skips the model after capture", async () => {
    const testDeps = deps([]);
    testDeps.userStateStore.states.set("905550000001", {
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
    } as any);

    await handleIncomingMessage(message("Uygub", "uygub-acceptance"), testDeps);

    const state = testDeps.userStateStore.states.get("905550000001");
    expect(state?.model_acceptance).toBe("accepted");
    expect(state?.current_state).toBe("WAITING_FOR_APP");
    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    expect(testDeps.sender.sends[0]?.text).toMatch(/kabul ettigini aldim/i);
    expect(testDeps.sender.sends[0]?.text).toMatch(/Android mi iPhone mu/i);
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/hangi onayli uygulama|hangi uygulama/iu);
    expect(testDeps.sender.sends[0]?.text).not.toMatch(/uygun demek istediysen|uygun mu/iu);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_FAST_PATH_SELECTED",
          fast_path: "model_acceptance_captured",
          model_call_count: 0,
        }),
      ]),
    );
  });

  it("recommends a single app after phone capture and accepts the next yes without re-asking app name", async () => {
    const testDeps = deps([], { approvedApps: ["Layla", "Soyo", "Amar", "Timo"] });
    testDeps.userStateStore.states.set("905550000001", {
      current_state: "WAITING_FOR_PHONE_TYPE",
      age: 24,
      gender: "erkek",
      daily_hours: 7,
      eligibility_status: "eligible",
      work_model_disclosed: true,
      model_acceptance: "accepted",
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["selected_app", "phone_type"],
      expected_next_step: "ask_selected_app_or_phone_type",
    } as any);

    await handleIncomingMessage(message("android", "known-facts-phone"), testDeps);

    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    const recommendation = testDeps.sender.sends[0]?.text ?? "";
    expect(recommendation).toMatch(/Android bilgisini aldim/iu);
    expect(recommendation).toMatch(/Layla ile devam edelim mi/iu);
    expect(recommendation).not.toMatch(/hangi uygulama|uygulamanin adini|uygulamanın adını/iu);
    expect(testDeps.userStateStore.states.get("905550000001")?.phone_type).toBe("android");
    expect(testDeps.userStateStore.states.get("905550000001")?.selected_app).toBeNull();

    testDeps.memoryStore.appendBotReply("905550000001", recommendation);
    await handleIncomingMessage(message("Evet", "known-facts-app-confirm"), testDeps);

    const state = testDeps.userStateStore.states.get("905550000001");
    expect(state?.selected_app).toBe("Layla");
    expect(state?.phone_type).toBe("android");
    expect(state?.current_state).toBe("INSTALLATION_IN_PROGRESS");
    expect(state?.missing_fields).toEqual([]);
    expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    const setupReply = testDeps.sender.sends.at(-1)?.text ?? "";
    expect(setupReply).toMatch(/Layla kurulum linki|Kayittan sonra/iu);
    expect(setupReply).not.toMatch(/teyit eder misin|hangi uygulama|uygulamanin adini|uygun mu/iu);
    expect(testDeps.logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event_type: "CONVERSATION_DECISION_V2_FAST_PATH_SELECTED",
        fast_path: "known_fact_progress",
        model_call_count: 0,
      }),
    ]));
  });

  it("repairs and then deterministically appends the required female profile rule for male candidates", async () => {
    const incompleteModelReply =
      "Onayli uygulamada profil hazirlanir ve uygulamadaki sohbetlere yaziyla cevap vererek ilerlersin. Bu calisma modeli sana uygunsa uygun yazman yeterli.";
    const incompleteRepairReply =
      "Bilgilerini aldim. Erkek adaylar icin kadin profil/fotograf kurali ayrica acik onayla anlatilir. Bu model sana uygun mu?";
    const testDeps = deps([
      decision({
        intent: { primary: "candidate_next_step", secondary: [], confidence: 0.95 },
        reply: { text: incompleteModelReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"],
        state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
        policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
        next_action: "request_work_model_acceptance",
      }),
      decision({
        intent: { primary: "candidate_next_step", secondary: [], confidence: 0.95 },
        reply: { text: incompleteRepairReply, language: "tr", tone: "natural_concise", contains_question: true },
        chosen_actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"],
        state_patch: { work_model_disclosed: true, work_model_acceptance: "pending" },
        policy_facts_used: ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"],
        next_action: "request_work_model_acceptance",
      }),
    ]);
    const previousKnowledgeDir = process.env.KNOWLEDGE_BANK_DIR;
    const knowledgeDir = mkdtempSync(join(tmpdir(), "female-profile-rule-facts-"));
    writeValidKnowledgeBankFixture(knowledgeDir);
    const structuredPath = join(knowledgeDir, "app_facts_structured.json");
    const structured = JSON.parse(readFileSync(structuredPath, "utf8"));
    structured.policy_sections.profile_bio_photo_rules =
      "Erkek adaylarda kadin profili acilir ve kadin fotograflari kullanilir; bu model aday uygunlugu ve acik onayla ilerler.";
    writeFileSync(structuredPath, `${JSON.stringify(structured, null, 2)}\n`, "utf8");
    process.env.KNOWLEDGE_BANK_DIR = knowledgeDir;
    testDeps.knowledgeBankDir = knowledgeDir;

    try {
      await handleIncomingMessage(message("27 erkek 4", "female-profile-completion"), testDeps);
    } finally {
      if (previousKnowledgeDir === undefined) delete process.env.KNOWLEDGE_BANK_DIR;
      else process.env.KNOWLEDGE_BANK_DIR = previousKnowledgeDir;
      rmSync(knowledgeDir, { recursive: true, force: true });
    }

    expect(testDeps.assistantClient.runCalls).toHaveLength(2);
    expect(testDeps.assistantClient.runCalls[1]?.content).toContain("REQUIRED_PROFILE_RULE_OMITTED");
    const reply = testDeps.sender.sends[0]?.text ?? "";
    expect(reply).toMatch(/kadin.{0,100}(profil|foto).{0,100}(acil|kullan)|foto.{0,100}kadin.{0,100}(acil|kullan)/iu);
    expect(reply).not.toMatch(/ayrica.*anlatilir|sonra.*anlat|daha sonra.*anlat/iu);
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          quality_reason_codes: expect.arrayContaining(["REQUIRED_PROFILE_RULE_OMITTED"]),
          mutation_source: expect.stringContaining("deterministic_reply_completion"),
        }),
      ]),
    );
  });
});
