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

const PREVIOUS_WORK_MODEL_REPLY =
  "Bilgilerini aldım. Erkek adaylar için onaylı yönlendirme şu: Layla, mesajlaşma ağırlıklı ve kamera açmadan ilerlemek isteyen adaylar için uygundur. Kuruluma geçmeden önce bu çalışma modelinin sana uygun olduğunu netleştirelim. Uygun mu?";

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
      text: "Layla üzerinden sohbet mesajlarına düzenli cevap vererek ilerlersin. Kamera zorunlu değil; kurulumdan önce bu çalışma modelinin sana uygun olduğunu netleştirelim. Uygun mu?",
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

function deps(responses: string[]) {
  return {
    env: createTestEnv({
      conversationDecisionV2Enabled: true,
      approvedApps: ["Layla", "Soyo", "Amar", "Timo"]
    }),
    assistantClient: new FakeAssistantClient(responses),
    sender: new FakeSender(),
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userStateStore: new InMemoryUserStateStore(),
    userRunLock: new UserRunLock(),
    logger: createSilentLogger()
  };
}

describe("Conversation Decision V2 candidate route", () => {
  it("blocks generic closers and incomplete job-definition answers", async () => {
    const incomplete = "İş, Layla uygulamasında sohbet ederek ilerliyor. Kamera zorunlu değil, ekip adım adım yönlendirecek. Başka sormak istediğin var mı?";
    const complete = "İşin temel kısmı, onaylı uygulama içinde gelen sohbetlere yazıyla düzgün cevap vermek. Kamera zorunlu diye bir kural söylemiyoruz; mesajlaşma ağırlıklı ilerleyebilirsin. Şimdi uygun ilerleyebilmem için yaş, cinsiyet ve günlük ayırabileceğin süreyi netleştirelim.";
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
        policy_facts_used: [],
        next_action: "ask_missing_age"
      })
    ]);

    await handleIncomingMessage(message("Selam iş nedir", "job-definition"), testDeps);

    expect(testDeps.sender.sends).toHaveLength(1);
    expect(testDeps.sender.sends[0]?.text).toBe(complete);
    expect(testDeps.sender.sends[0]?.text).not.toContain("Başka sormak istediğin");
    expect(testDeps.logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "CONVERSATION_DECISION_V2_TRACE",
          intent: "ask_job_definition",
          final_reply_origin: "conversation_decision_v2_model_repair",
          mutation_source: "model_repair",
          validation_reason_codes: expect.arrayContaining(["GENERIC_CONVERSATION_CLOSER"]),
          quality_reason_codes: expect.arrayContaining(["GENERIC_CONVERSATION_CLOSER", "JOB_EXPLANATION_INCOMPLETE"])
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
      work_model_disclosed: false,
      model_acceptance: "pending",
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

  it("does not repeat the exact production work-model paragraph on clarification", async () => {
    const simpleClarification = "Basitçe şöyle: Layla içinde gelen sohbetlere yazıyla cevap vererek ilerlersin. Kamera zorunlu diye bir kural yok; önce bu mesajlaşma ağırlıklı çalışma biçiminin sana uyup uymadığını netleştiriyoruz.";
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
          mutation_source: "model_repair"
        })
      ])
    );
  });

  it("preserves a valid unique model reply without stage template overwrite", async () => {
    const unique = "MODEL_UNIQUE_REPLY_78421 çalışma modeli net; sorunu yanıtladım.";
    const testDeps = deps([
      decision({
        reply: { text: unique, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question"],
        state_patch: {},
        policy_facts_used: ["male_candidate_work_model"]
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
      model_acceptance: "pending",
      selected_app: null,
      phone_type: null,
      installation_status: "not_started",
      training_status: "not_started",
      missing_fields: ["model_acceptance"],
      expected_next_step: "ask_work_model_acceptance"
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
          text: "Layla içinde sohbetlere yazıyla cevap vererek ilerlersin. Ekip yönlendirmesi dışındaki hesap/profil detaylarını uydurmadan netleştiririz; önce bu çalışma modeli sana uyuyor mu?",
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
    const answer = "Erkek hesabı açılacağına dair doğrulanmış bir kural yok. Bu kısmı uydurmayalım; ekip hangi profil adımı gerekiyorsa onu ayrıca netleştirir.";
    const testDeps = deps([
      decision({
        intent: { primary: "ask_how_work_is_done", secondary: ["account_profile_question"], confidence: 0.92 },
        direct_question: { present: true, question_summary: "Aday erkek hesabı açılıp açılmayacağını soruyor", answered_in_reply: true },
        reply: { text: answer, language: "tr", tone: "natural_concise", contains_question: false },
        chosen_actions: ["answer_user_question"],
        state_patch: {},
        policy_facts_used: ["male_account_policy_boundary"]
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

    expect(testDeps.sender.sends[0]?.text).toBe(answer);
    expect(testDeps.sender.sends[0]?.text).not.toContain("kurulum");
  });
});
