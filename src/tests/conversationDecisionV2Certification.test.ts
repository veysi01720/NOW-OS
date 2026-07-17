import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import type { AssistantClient } from "../assistant/openaiAssistantClient.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState, type UserState } from "../storage/types.js";
import { createSilentLogger, createTestEnv, FakeSender, InMemoryUserStateStore } from "./testDoubles.js";

type CertCategory =
  | "first_contact" | "single_message_intake" | "partial_intake" | "how_work_works" | "clarification"
  | "male_account_question" | "acceptance" | "ambiguous_yes" | "phone_type" | "frustrated_user"
  | "profanity_with_question" | "typo_and_slang" | "rapid_message" | "duplicate" | "queue_ordering"
  | "restart_persistence" | "policy_missing" | "provider_failure" | "reply_immutability" | "legacy_origin_block"
  | "camera_objection" | "payment_question" | "trust_question" | "topic_correction" | "short_contact"
  | "text_only_preference" | "app_selection" | "setup_ready" | "state_correction";

interface CertScenario {
  id: string;
  category: CertCategory;
  turns: string[];
  initialState?: Partial<UserState>;
  requiredState?: Partial<UserState>;
  requiredReplyIncludes?: string[];
  forbiddenReplyPhrases?: string[];
}

const FORBIDDEN = [
  "baska merak ettigin", "baska bir konuda yardimci", "detay ister misin",
  "kurulum icin hazirsin", "kuruluma hazirsin", "erkek hesabi acabilirsin",
  "erkek profil acman istenir", "garanti", "kesin guven", "sorun yasamazsiniz", "referans paylasabilirim"
];

export const golden_conversation_pack_v1: CertScenario[] = [
  { id: "cert_001", category: "first_contact", turns: ["Selam, is icin yazdim"], requiredReplyIncludes: ["yas", "cinsiyet", "saat"] },
  { id: "cert_002", category: "single_message_intake", turns: ["27 erkek 4"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla", "mesaj"] },
  { id: "cert_003", category: "single_message_intake", turns: ["27 e 4"], requiredState: { age: 27 }, requiredReplyIncludes: ["cinsiyet", "saat"] },
  { id: "cert_004", category: "single_message_intake", turns: ["27 yas erkegim dort saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_005", category: "single_message_intake", turns: ["27 yas erkek 4 saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_006", category: "single_message_intake", turns: ["27,erkek,gunde4"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_007", category: "single_message_intake", turns: ["erkek 27 gunluk dort saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_008", category: "single_message_intake", turns: ["yasim 27 erkegim 4 saat ayiririm"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_009", category: "single_message_intake", turns: ["27 erkek yaklasik 4-5 saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_010", category: "partial_intake", turns: ["Selam", "27", "erkek", "4 saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_011", category: "how_work_works", turns: ["27 erkek 4", "Bu isi nasil yapacagim?"], requiredReplyIncludes: ["sohbet"] },
  { id: "cert_012", category: "how_work_works", turns: ["27 erkek 4", "bu is tam olarak ne"], requiredReplyIncludes: ["Layla", "sohbet"] },
  { id: "cert_013", category: "clarification", turns: ["27 erkek 4", "Calisma modelini anlamadim"], requiredReplyIncludes: ["basit", "mesaj"] },
  { id: "cert_014", category: "clarification", turns: ["27 erkek 4", "Nasil yani?"], requiredReplyIncludes: ["basit"] },
  { id: "cert_015", category: "clarification", turns: ["27 erkek 4", "Daha basit anlat"], requiredReplyIncludes: ["basit"] },
  { id: "cert_016", category: "clarification", turns: ["27 erkek 4", "Tam anlamadim"], requiredReplyIncludes: ["basit"] },
  { id: "cert_017", category: "clarification", turns: ["27 erkek 4", "Ne demek istiyorsun?"], requiredReplyIncludes: ["basit"] },
  { id: "cert_018", category: "clarification", turns: ["27 erkek 4", "Bir ornek versene"], requiredReplyIncludes: ["ornek"] },
  { id: "cert_019", category: "clarification", turns: ["27 erkek 4", "Mesajlasma nasil olacak?"], requiredReplyIncludes: ["mesaj"] },
  { id: "cert_020", category: "clarification", turns: ["27 erkek 4", "Kamera acacak miyim?"], requiredReplyIncludes: ["kamera"] },
  { id: "cert_021", category: "male_account_question", turns: ["27 erkek 4", "Erkek hesabi mi acacagiz?"], requiredReplyIncludes: ["dogrulanmis", "yok"] },
  { id: "cert_022", category: "male_account_question", turns: ["27 erkek 4", "erkek profil mi gerekiyor"], requiredReplyIncludes: ["dogrulanmis", "yok"] },
  { id: "cert_023", category: "acceptance", turns: ["27 erkek 4", "Tamam, bu model bana uygun"], requiredState: { model_acceptance: "accepted" }, requiredReplyIncludes: ["uygulama", "telefon"] },
  { id: "cert_024", category: "ambiguous_yes", turns: ["Selam", "evet"], requiredReplyIncludes: ["yas", "cinsiyet"] },
  { id: "cert_025", category: "phone_type", turns: ["27 erkek 4", "Tamam uygun", "Android"], requiredState: { phone_type: "android" }, requiredReplyIncludes: ["uygulama"] },
  { id: "cert_026", category: "phone_type", turns: ["27 erkek 4", "Tamam uygun", "iphone"], requiredState: { phone_type: "ios" }, requiredReplyIncludes: ["uygulama"] },
  { id: "cert_027", category: "setup_ready", turns: ["27 erkek 4", "Tamam uygun", "Android", "Layla"], requiredState: { model_acceptance: "accepted", phone_type: "android", selected_app: "Layla" }, requiredReplyIncludes: ["kurulum"] },
  { id: "cert_028", category: "frustrated_user", turns: ["27 erkek 4", "Anlat dedim ya"], requiredReplyIncludes: ["net"] },
  { id: "cert_029", category: "profanity_with_question", turns: ["27 erkek 4", "ya bu ne bicim is nasil yapacagim"], requiredReplyIncludes: ["sohbet"] },
  { id: "cert_030", category: "topic_correction", turns: ["27 erkek 4", "onu sormadim baska seyi soruyorum"], requiredReplyIncludes: ["hangi kismi"] },
  { id: "cert_031", category: "topic_correction", turns: ["27 erkek 4", "hayir baska seyi soruyorum"], requiredReplyIncludes: ["hangi kismi"] },
  { id: "cert_032", category: "camera_objection", turns: ["27 erkek 4", "erkegim ama kamera acmak istemiyorum"], requiredReplyIncludes: ["kamera", "zorunlu degil"] },
  { id: "cert_033", category: "short_contact", turns: ["Mrb is"], requiredReplyIncludes: ["yas", "cinsiyet", "saat"] },
  { id: "cert_034", category: "short_contact", turns: ["is var mi"], requiredReplyIncludes: ["yas", "cinsiyet", "saat"] },
  { id: "cert_035", category: "short_contact", turns: ["bilgi"], requiredReplyIncludes: ["yas", "cinsiyet", "saat"] },
  { id: "cert_036", category: "state_correction", turns: ["27", "erkek 4 saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_037", category: "state_correction", turns: ["erkek", "27 4 saat"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_038", category: "state_correction", turns: ["4 saat", "27 erkek"], requiredState: { age: 27, gender: "erkek", daily_hours: 4 }, requiredReplyIncludes: ["Layla"] },
  { id: "cert_039", category: "payment_question", turns: ["27 erkek 4", "para isi nasil oluyor"], requiredReplyIncludes: ["dogrulanmis"] },
  { id: "cert_040", category: "trust_question", turns: ["27 erkek 4", "guvenli mi"], requiredReplyIncludes: ["dogrulanmis"], forbiddenReplyPhrases: ["kesin garanti"] },
  { id: "cert_041", category: "frustrated_user", turns: ["27 erkek 4", "olmuyor ya sinirlendim"], requiredReplyIncludes: ["sade"] },
  { id: "cert_042", category: "camera_objection", turns: ["27 erkek 4", "kamerasiz olur mu"], requiredReplyIncludes: ["kamera", "zorunlu degil"] },
  { id: "cert_043", category: "text_only_preference", turns: ["27 erkek 4", "sadece yazisma olur mu"], requiredReplyIncludes: ["mesaj"] },
  { id: "cert_044", category: "clarification", turns: ["27 erkek 4", "kisa anlat"], requiredReplyIncludes: ["kisaca"] },
  { id: "cert_045", category: "acceptance", turns: ["27 erkek 4", "olur"], requiredState: { model_acceptance: "accepted" }, requiredReplyIncludes: ["uygulama"] },
  { id: "cert_046", category: "phone_type", turns: ["27 erkek 4", "olur", "telefon android"], requiredState: { phone_type: "android" }, requiredReplyIncludes: ["uygulama"] },
  { id: "cert_047", category: "app_selection", turns: ["27 erkek 4", "olur", "Layla"], requiredState: { selected_app: "Layla" }, requiredReplyIncludes: ["telefon"] },
  { id: "cert_048", category: "reply_immutability", turns: ["MODEL_UNIQUE_REPLY_78421"], initialState: { age: 27, gender: "erkek", daily_hours: 4, eligibility_status: "eligible", work_model_disclosed: true, model_acceptance: "accepted", selected_app: "Layla", phone_type: "android", current_state: "READY_FOR_INSTALLATION", missing_fields: [], expected_next_step: "start_installation" }, requiredReplyIncludes: ["MODEL_UNIQUE_REPLY_78421"] },
  { id: "cert_049", category: "legacy_origin_block", turns: ["27 erkek 4", "Bu isi nasil yapacagim?"], requiredReplyIncludes: ["sohbet"] },
  { id: "cert_050", category: "restart_persistence", turns: ["27 erkek 4", "Tamam uygun", "Android", "Layla"], requiredState: { model_acceptance: "accepted", phone_type: "android", selected_app: "Layla" }, requiredReplyIncludes: ["kurulum"] }
];

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

function message(text: string, id: string, sender = "905550000001"): NormalizedIncomingMessage {
  return {
    correlation_id: `cert_corr_${id}`,
    sender_id: sender,
    phone_number: sender,
    remote_jid: `${sender}@s.whatsapp.net`,
    message_id: id,
    message_type: "conversation",
    text,
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-13T00:00:00.000Z"
  };
}

function decision(input: { text: string; intent?: string; actions?: string[]; statePatch?: Record<string, unknown>; facts?: string[]; nextAction?: string; direct?: boolean }) {
  return JSON.stringify({
    decision_version: "2.0",
    intent: { primary: input.intent ?? "candidate_next_step", secondary: [], confidence: 0.94 },
    direct_question: { present: input.direct ?? false, question_summary: input.direct ? "Aday dogrudan aciklama istiyor" : null, answered_in_reply: true },
    reply: { text: input.text, language: "tr", tone: "natural_concise", contains_question: /\?/.test(input.text) },
    chosen_actions: input.actions ?? ["answer_user_question"],
    state_patch: input.statePatch ?? {},
    policy_facts_used: input.facts ?? [],
    next_action: input.nextAction ?? "none",
    requires_escalation: false,
    escalation_reason: null,
    risk_flags: [],
    self_check: { answered_latest_message: true, asked_known_information_again: false, invented_policy: false, offered_setup_too_early: false, used_generic_closing: false }
  });
}

function extractContext(content: string): any {
  const direct = content.match(/<conversation_decision_context_json>\n([\s\S]*?)\n<\/conversation_decision_context_json>/);
  if (direct) return JSON.parse(direct[1]);
  const backend = content.match(/<backend_context_json>\n([\s\S]*?)\n<\/backend_context_json>/);
  if (!backend) throw new Error("backend context missing");
  const parsed = JSON.parse(backend[1]);
  if (!parsed.conversation_decision_v2) throw new Error("conversation decision context missing");
  return parsed.conversation_decision_v2;
}

class CertificationAssistantClient implements AssistantClient {
  public createThreadCalls = 0;
  public runCalls: Array<{ threadId: string; content: string }> = [];
  public malformedMode: "none" | "old_contract" | "malformed" | "empty" | "throw" | "invalid_then_valid" = "none";
  private invalidServed = false;

  async createThread(): Promise<string> { this.createThreadCalls += 1; return `cert_thread_${this.createThreadCalls}`; }

  async runAssistant(threadId: string, content: string): Promise<string> {
    this.runCalls.push({ threadId, content });
    if (this.malformedMode === "throw") throw new Error("synthetic provider timeout");
    if (this.malformedMode === "empty") return "";
    if (this.malformedMode === "old_contract") return JSON.stringify({ contract_version: "1.0", reply: "Legacy reply", internal_boss_note: "" });
    if (this.malformedMode === "malformed") return "{not-json";
    if (this.malformedMode === "invalid_then_valid" && !this.invalidServed) { this.invalidServed = true; return decision({ text: "Baska merak ettigin bir sey var mi?", actions: ["answer_user_question"] }); }
    return this.replyForContext(extractContext(content));
  }

  private replyForContext(context: any): string {
    const latest = normalize(context.latest_message.text);
    const state = context.candidate_state;
    const facts = (context.canonical_policy_facts ?? []).map((fact: any) => fact.id);
    const intakeMissing = [state.age === null ? "yasini" : null, state.gender === null ? "cinsiyetini" : null, state.daily_hours === null ? "gunluk kac saat ayirabilecegini" : null].filter(Boolean);

    if (/model_unique_reply_78421/i.test(latest)) return decision({ text: "MODEL_UNIQUE_REPLY_78421", intent: "ask_how_work_is_done", actions: ["answer_user_question"], direct: true, facts: facts.includes("male_candidate_work_model") ? ["male_candidate_work_model"] : [] });
    if (intakeMissing.length > 0) return decision({ text: `Dogru yonlendirebilmem icin ${intakeMissing.join(", ")} yazar misin?`, intent: "collect_candidate_intake", actions: [...(state.age === null ? ["ask_missing_age"] : []), ...(state.gender === null ? ["ask_missing_gender"] : []), ...(state.daily_hours === null ? ["ask_missing_daily_hours"] : [])], nextAction: state.age === null ? "ask_missing_age" : state.gender === null ? "ask_missing_gender" : "ask_missing_daily_hours" });
    if (latest.includes("erkek hes") || latest.includes("erkek profil")) return decision({ text: "Erkek hesabi ya da erkek profil acilacagina dair dogrulanmis kural yok. Bu detayi uydurmayalim; gerekiyorsa ekip netlestirir.", intent: "account_profile_question", actions: ["answer_user_question"], facts: facts.includes("male_account_policy_boundary") ? ["male_account_policy_boundary"] : [], direct: true });
    if (/(anlamadim|nasil yani|daha basit|tam anlamadim|ne demek|ornek|mesajlasma nasil|kamera acacak|kisa anlat|anlat dedim)/u.test(latest)) return decision({ text: latest.includes("kamera") ? "Kamera tarafinda dogrulanmis zorunluluk soylemiyoruz. Basitce aday uygulamada mesajlara yaziyla cevap vererek ilerler." : latest.includes("ornek") ? "Ornek olarak: uygulamada sana gelen mesaja kisa ve duzgun cevap verirsin; ekip de hangi adimda ne yapacagini soyler." : latest.includes("kisa") ? "Kisaca: calisma modeli su; Layla icinde mesajlasma uzerinden yaziyla cevap verirsin." : "Daha basit anlatayim: Layla icinde sohbetlere yaziyla cevap vererek ilerlersin. Once bu mesajlasma agirlikli modelin sana uyup uymadigini netlestiriyoruz.", intent: "clarify_previous_explanation", actions: ["answer_user_question", "clarify_previous_explanation", "explain_work_model"], facts: facts.filter((id: string) => ["male_candidate_work_model", "candidate_work_steps_chat_based"].includes(id)), direct: true });
    if (/(nasil yapacagim|bu isi nasil|bu is tam|tam olarak ne|kamera|yazisma|guvenli|para isi|kamerasiz)/u.test(latest)) return decision({ text: latest.includes("guvenli") || latest.includes("para") ? "Dogrulanmis bilgi disina cikmadan soyleyeyim: surec ekip yonlendirmesiyle uygulama icinden ilerler; kesin soz vermiyoruz, takildigin kismi ekip netlestirir." : latest.includes("kamera") || latest.includes("yazisma") || latest.includes("kamerasiz") ? "Kamera zorunlu degil diye yonlendirebiliriz; Layla mesajlasma agirlikli ilerlemek isteyen aday icin uygundur." : "Layla icinde sohbetlere yaziyla cevap vererek ilerlersin. Ekip adimlari soyler; kurulumdan once bu calisma modelinin sana uygun oldugunu netlestirelim.", intent: context.latest_message.inferred_intent === "ask_job_definition" ? "ask_job_definition" : "ask_how_work_is_done", actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"], statePatch: { work_model_disclosed: true, work_model_acceptance: "pending" }, facts: facts.filter((id: string) => ["male_candidate_work_model", "work_model_acceptance_required", "candidate_work_steps_chat_based"].includes(id)), nextAction: "request_work_model_acceptance", direct: true });
    if (/(tamam|uygun|olur|evet)/u.test(latest) && state.work_model_acceptance === "accepted") { const actions = ["answer_user_question", "record_work_model_acceptance"]; if (!state.selected_app) actions.push("ask_selected_app"); if (!state.phone_type) actions.push("ask_phone_type"); return decision({ text: state.selected_app || state.phone_type ? "Tamam, kabul? aldim. Eksik kalan uygulama veya telefon bilgisini netlestirip kuruluma gececegiz." : "Tamam, calisma modelini kabul ettin. Hangi uygulama ve hangi telefon tipiyle ilerleyecegini netlestirelim.", intent: "record_work_model_acceptance", actions, facts: facts.includes("work_model_acceptance_required") ? ["work_model_acceptance_required"] : [], nextAction: !state.selected_app ? "ask_selected_app" : !state.phone_type ? "ask_phone_type" : "begin_setup" }); }
    if (latest.includes("android") || latest.includes("iphone")) return decision({ text: "Telefon tipini aldim. Simdi hangi onayli uygulama uzerinden ilerleyecegini netlestirelim.", intent: "collect_phone_type", actions: ["answer_user_question", "ask_selected_app"], statePatch: latest.includes("android") ? { phone_type: "android" } : { phone_type: "ios" }, nextAction: "ask_selected_app" });
    if (latest.includes("layla")) return decision({ text: state.phone_type ? "Layla bilgisini aldim. Artik kurulum adimina ekip yonlendirmesiyle gecebiliriz." : "Layla bilgisini aldim. Kuruluma gecmeden once telefon tipini netlestirelim.", intent: "collect_selected_app", actions: state.phone_type ? ["answer_user_question", "begin_setup"] : ["answer_user_question", "ask_phone_type"], statePatch: { selected_app: "Layla" }, nextAction: state.phone_type ? "begin_setup" : "ask_phone_type" });
    if (latest.includes("sinirlendim") || latest.includes("olmuyor")) return decision({ text: "Haklisin, bunu sadelestirelim. Once nerede takildigini tek adimda soyle; ona gore kisa sekilde ilerleyelim.", intent: "handle_user_frustration", actions: ["handle_user_frustration", "answer_user_question"], direct: true });
    if (latest.includes("onu sormadim") || latest.includes("baska seyi")) return decision({ text: "Tamam, yanlis yerden ilerlemeyeyim. Hangi kismi soruyorsun: calisma modeli mi, uygulama secimi mi?", intent: "clarify_ambiguous_input", actions: ["answer_user_question", "explain_work_model", "clarify_ambiguous_input"], nextAction: "clarify_ambiguous_input" });
    return decision({ text: "Layla mesajlasma agirlikli ilerlemek isteyen aday icin uygundur; once bu calisma modelinin sana uygun oldugunu netlestirelim.", intent: "candidate_next_step", actions: ["answer_user_question", "explain_work_model", "request_work_model_acceptance"], statePatch: { work_model_disclosed: true, work_model_acceptance: "pending" }, facts: facts.filter((id: string) => ["male_candidate_work_model", "work_model_acceptance_required"].includes(id)), nextAction: "request_work_model_acceptance" });
  }
}

function makeDeps(options: { client?: CertificationAssistantClient; state?: Partial<UserState>; sender?: string } = {}) {
  const userStateStore = new InMemoryUserStateStore();
  const sender = options.sender ?? "905550000001";
  if (options.state) userStateStore.updateState(sender, { ...defaultUserState(), ...options.state, missing_fields: [...(options.state.missing_fields ?? [])] });
  const client = options.client ?? new CertificationAssistantClient();
  return { env: createTestEnv({ conversationDecisionV2Enabled: true, modelAdapterLayerEnabled: true, approvedApps: ["Layla", "Soyo", "Amar", "Timo"] }), assistantClient: client, sender: new FakeSender(), threadStore: new InMemoryThreadStore(), memoryStore: new InMemoryStore(), messageDedupeStore: new InMemoryMessageDedupeStore(), userStateStore, userRunLock: new UserRunLock(), logger: createSilentLogger(), client };
}

async function runScenario(scenario: CertScenario, runId = "r1") {
  const d = makeDeps({ state: scenario.initialState });
  const replies: string[] = [];
  for (const [index, text] of scenario.turns.entries()) { await handleIncomingMessage(message(text, `${scenario.id}_${runId}_${index}`), d); const sent = d.sender.sends.at(-1)?.text; if (sent) replies.push(sent); }
  const finalReply = replies.at(-1) ?? "";
  const finalState = d.userStateStore.states.get("905550000001") ?? defaultUserState();
  const traces = d.logger.events.filter((event) => event.event_type === "CONVERSATION_DECISION_V2_TRACE");
  return { d, replies, finalReply, finalState, traces };
}

function assertNoForbidden(text: string, extra: string[] = []) { for (const phrase of [...FORBIDDEN, ...extra]) expect(normalize(text), phrase).not.toContain(normalize(phrase)); }

describe("Conversation Decision V2 final certification pack", () => {
  it("defines golden_conversation_pack_v1 with 50 sanitized scenarios", () => {
    expect(golden_conversation_pack_v1).toHaveLength(50);
    expect(new Set(golden_conversation_pack_v1.map((item) => item.category)).size).toBeGreaterThanOrEqual(20);
    const serialized = JSON.stringify(golden_conversation_pack_v1);
    expect(serialized).not.toContain("@s.whatsapp.net");
    expect(serialized).not.toContain("@g.us");
    expect(serialized).not.toMatch(/\bsk-[A-Za-z0-9_-]+\b/);
  });

  it("passes all golden scenarios through the real candidate V2 route with noop outbound", async () => {
    let modelOrigin = 0;
    let totalReplies = 0;
    for (const scenario of golden_conversation_pack_v1) {
      const result = await runScenario(scenario);
      expect(result.finalReply, scenario.id).not.toBe("");
      assertNoForbidden(result.finalReply, scenario.forbiddenReplyPhrases);
      for (const expected of scenario.requiredReplyIncludes ?? []) expect(normalize(result.finalReply), scenario.id).toContain(normalize(expected));
      if (scenario.requiredState) for (const [key, value] of Object.entries(scenario.requiredState)) expect((result.finalState as any)[key], `${scenario.id}:${key}`).toBe(value);
      expect(result.d.sender.sends.length, scenario.id).toBe(scenario.turns.length);
      expect(result.d.client.runCalls.length, scenario.id).toBeLessThanOrEqual(scenario.turns.length * 2);
      expect(result.traces.length, scenario.id).toBeGreaterThan(0);
      for (const trace of result.traces) { expect(trace.final_reply_origin, scenario.id).not.toMatch(/legacy|template|contract_v1/i); expect(trace.model_call_count, scenario.id).toBeLessThanOrEqual(2); if (trace.final_reply_origin === "conversation_decision_v2_model") modelOrigin += 1; }
      totalReplies += result.d.sender.sends.length;
    }
    expect(modelOrigin).toBeGreaterThanOrEqual(50);
    expect(totalReplies).toBeGreaterThanOrEqual(50);
  });

  it("runs critical scenarios three times with stable semantic behavior", async () => {
    const critical = golden_conversation_pack_v1.filter((item) => ["first_contact", "single_message_intake", "how_work_works", "clarification", "male_account_question", "acceptance", "ambiguous_yes", "frustrated_user", "profanity_with_question"].includes(item.category)).slice(0, 12);
    let runs = 0;
    for (const scenario of critical) for (let index = 0; index < 3; index += 1) { const result = await runScenario(scenario, `critical_${index}`); expect(result.finalReply, scenario.id).not.toBe(""); assertNoForbidden(result.finalReply, scenario.forbiddenReplyPhrases); expect(result.d.sender.sends.length, scenario.id).toBe(scenario.turns.length); expect(result.traces.every((trace) => Number(trace.model_call_count) <= 2), scenario.id).toBe(true); runs += 1; }
    expect(runs).toBe(36);
  });

  it("passes full candidate path three times without repeated intake or premature setup", async () => {
    const turns = ["Selam, is icin yazdim", "27 yasindayim, erkegim, gunde 4 saat ayirabilirim", "Bu isi tam olarak nasil yapacagim?", "Calisma modelini anlamadim, daha acik anlatir misin?", "Erkek hesabi mi acacagiz?", "Tamam, bu model bana uygun", "Android kullaniyorum", "Layla"];
    for (let run = 0; run < 3; run += 1) { const result = await runScenario({ id: `full_path_${run}`, category: "queue_ordering", turns }); expect(result.finalState.age).toBe(27); expect(result.finalState.gender).toBe("erkek"); expect(result.finalState.daily_hours).toBe(4); expect(result.finalState.model_acceptance).toBe("accepted"); expect(result.finalState.phone_type).toBe("android"); expect(result.finalState.selected_app).toBe("Layla"); expect(normalize(result.finalReply)).toContain("kurulum"); expect(normalize(result.replies.slice(2, 5).join("\n"))).not.toContain("yasini"); expect(normalize(result.replies.slice(0, 5).join("\n"))).not.toContain("kurulum icin hazirsin"); expect(result.d.sender.sends).toHaveLength(turns.length); }
  });

  it("keeps model reply immutable on valid decisions", async () => {
    const state = { age: 27, gender: "erkek", daily_hours: 4, eligibility_status: "eligible" as const, work_model_disclosed: true, model_acceptance: "accepted" as const, selected_app: "Layla", phone_type: "android", current_state: "READY_FOR_INSTALLATION", missing_fields: [], expected_next_step: "start_installation" };
    const result = await runScenario({ id: "immutability", category: "reply_immutability", turns: ["MODEL_UNIQUE_REPLY_78421"], initialState: state });
    expect(result.finalReply).toBe("MODEL_UNIQUE_REPLY_78421");
    expect(result.traces.at(-1)).toEqual(expect.objectContaining({ final_reply_origin: "conversation_decision_v2_model", reply_mutated_after_model: false }));
  });

  it("blocks old contract, malformed, empty and provider failures without legacy business replies", async () => {
    for (const mode of ["old_contract", "malformed", "empty", "throw", "invalid_then_valid"] as const) { const client = new CertificationAssistantClient(); client.malformedMode = mode; const d = makeDeps({ client }); await handleIncomingMessage(message("27 erkek 4", `provider_${mode}`), d); expect(d.sender.sends).toHaveLength(1); assertNoForbidden(d.sender.sends[0].text); expect(d.sender.sends[0].text).not.toContain("Layla kurulumu icin hazirsin"); expect(client.runCalls.length).toBeLessThanOrEqual(2); }
  });

  it("dedupes duplicate inbound and preserves single outbound", async () => { const d = makeDeps(); const inbound = message("27 erkek 4", "duplicate_one"); const first = await handleIncomingMessage(inbound, d); const second = await handleIncomingMessage(inbound, d); expect(first.status).toBe("sent"); expect(second.status).toBe("duplicate_ignored"); expect(d.sender.sends).toHaveLength(1); });

  it("serializes rapid same-sender messages and keeps different senders isolated", async () => {
    const d = makeDeps();
    const rapid = ["Selam", "27", "erkek", "4 saat", "Bu isi nasil yapacagim?", "Daha acik anlat"];
    await Promise.all(rapid.map((text, index) => handleIncomingMessage(message(text, `rapid_${index}`), d)));
    const state = d.userStateStore.states.get("905550000001");
    expect(state?.age).toBe(27); expect(state?.gender).toBe("erkek"); expect(state?.daily_hours).toBe(4); expect(d.sender.sends.length).toBe(rapid.length);
    const d2 = makeDeps();
    await Promise.all([handleIncomingMessage(message("27 erkek 4", "parallel_a", "905550000001"), d2), handleIncomingMessage(message("28 erkek 5", "parallel_b", "905550000002"), d2)]);
    expect(d2.sender.sends).toHaveLength(2); expect(d2.userStateStore.states.get("905550000001")?.age).toBe(27); expect(d2.userStateStore.states.get("905550000002")?.age).toBe(28);
  });
});
