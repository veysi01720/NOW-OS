import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenAIOwnerNaturalLanguageIntentClassifier } from "../src/bridge/ownerNaturalLanguageIntent.js";
import { buildOwnerKnowledgeActivationReply } from "../src/bridge/ownerTone.js";

const apiKey = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
if (!apiKey || !model) throw new Error("OPENAI_API_KEY_AND_OPENAI_RESPONSES_MODEL_REQUIRED");

const knowledgePath = resolve(process.env.KNOWLEDGE_BANK_DIR ?? resolve("data", "knowledge_bank"), "app_facts.md");
const activeKnowledge = existsSync(knowledgePath) ? readFileSync(knowledgePath, "utf8") : "";
const classifier = await createOpenAIOwnerNaturalLanguageIntentClassifier({ apiKey, model, timeoutMs: 60_000 });
const cases = [
  "Yaş, cinsiyet ve günlük süre madde madde sorulsun.",
  "Kurulum görseli owner onayı olmadan tamamlanmış sayılmasın.",
  "Çekim talepleri yalnızca günlük alınır.",
  "Layla davet kodu çalışmazsa fotoğraf eklenip tekrar denensin.",
  "Adaya daha önce verdiği bilgiler yeniden sorulmasın.",
];
const forbidden = /owner_transfer_sections|structured_facts|decision_context|canonical_policy_facts|rollback_pointer|active_version_hash|[a-f0-9]{24,}|(?:[A-Za-z]:\\|\/root\/)/iu;
const results: Array<Record<string, unknown>> = [];

for (const message of cases) {
  const decision = await classifier.classify({
    message,
    activeKnowledge,
    pendingKnowledge: [],
    pendingCandidateSuffixes: [],
    pendingHandoffs: [],
  });
  const reply = buildOwnerKnowledgeActivationReply(decision.knowledge_text ?? message);
  const pass = decision.intent === "knowledge_addition"
    && decision.confidence >= 0.65
    && !forbidden.test(reply)
    && reply.length < 260;
  results.push({ message, intent: decision.intent, confidence: decision.confidence, reply, pass });
}

const passed = results.filter((result) => result.pass === true).length;
process.stdout.write(`${JSON.stringify({ model, mode: "real_terra_no_outbound", passed, total: cases.length, results }, null, 2)}\n`);
if (passed !== cases.length) process.exitCode = 1;
