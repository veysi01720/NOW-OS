import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SenderRole } from "../config/roles.js";
import type { ChatType } from "../contracts/backendContextPayload.js";
import { routeCoreMode, type CoreIntent, type CoreMode } from "./modeRouter.js";

export interface AnswerPlan {
  sender_role: SenderRole;
  mode: CoreMode;
  intent: CoreIntent;
  relevant_app_fact: Record<string, string> | null;
  relevant_link_item: Record<string, string> | null;
  relevant_knowledge_rules: string[];
  hard_rules: string[];
  style_rules: string[];
  escalation_required: boolean;
  confidence: number;
  source_count: number;
  knowledge_status?: "KNOWN" | "UNKNOWN";
}

function readKnowledgeFile(name: string): string {
  const filePath = resolve(process.cwd(), "data", "knowledge_bank", name);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function parseTableRows(markdown: string): Array<Record<string, string>> {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 3) return [];
  const headers = lines[0].split("|").map((part) => part.trim()).filter(Boolean);
  return lines.slice(2).map((line) => {
    const values = line.split("|").map((part) => part.trim()).filter(Boolean);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function getCanonicalAppFacts(): Array<Record<string, string>> {
  const markdown = readKnowledgeFile("app_facts.md");
  if (!markdown) return [];
  return parseTableRows(markdown);
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll("ı", "i").replaceAll("İ", "i").trim();
}

function findAppRow(rows: Array<Record<string, string>>, text: string): Record<string, string> | null {
  const normalized = normalize(text);
  
  // Exact or alias match ONLY
  const matches = rows.filter((row) => {
    const aliases = [row.app, row.android_name, row.ios_name]
      .filter(Boolean)
      .map((a) => normalize(a));
    return aliases.some((a) => normalized.includes(a));
  });

  if (matches.length === 1) {
    return matches[0];
  }
  
  return null;
}

function knowledgeRulesFor(intent: CoreIntent): string[] {
  switch (intent) {
    case "app_routing":
      return ["app_routing_rules", "approved_apps_only"];
    case "trust_objection":
      return ["workflow_rules.trust_objection", "no_guarantee"];
    case "payment_withdrawal":
      return ["workflow_rules.withdrawal_limit", "no_fake_numbers"];
    case "link_request":
      return ["knowledge_usage_policy.links_only_from_catalog"];
    case "manager_escalation":
      return ["escalation_rules.manager_handoff"];
    case "technical_issue":
      return ["workflow_rules.ask_screen_or_photo"];
    case "invite_code":
      return ["app_facts.invite_code", "workflow_rules.invite_code"];
    default:
      return ["core_system_rules"];
  }
}

export function buildAnswerPlan(input: {
  text: string;
  senderRole: SenderRole;
  chatType: ChatType;
}): AnswerPlan {
  const route = routeCoreMode({
    text: input.text,
    senderRole: input.senderRole,
    chatType: input.chatType
  });

  const effectiveAppFacts = getCanonicalAppFacts();
  const linkCatalog = parseTableRows(readKnowledgeFile("link_catalog.md"));
  const relevantAppFact = findAppRow(effectiveAppFacts, input.text);
  const relevantLinkItem = relevantAppFact
    ? linkCatalog.find((row) => row.app === relevantAppFact.app) ?? null
    : null;
  const sourceCount = [relevantAppFact, relevantLinkItem].filter(Boolean).length + knowledgeRulesFor(route.intent).length;
  const missingLink = route.mode === "link_request_mode" && (!relevantLinkItem || !relevantLinkItem.official_url);
  const timoDetail = normalize(input.text).includes("timo") && route.intent === "manager_escalation";

  return {
    sender_role: input.senderRole,
    mode: route.mode,
    intent: route.intent,
    relevant_app_fact: relevantAppFact,
    relevant_link_item: relevantLinkItem,
    relevant_knowledge_rules: knowledgeRulesFor(route.intent),
    hard_rules: [
      "do_not_invent_links",
      "do_not_invent_codes",
      "do_not_invent_app_names",
      "do_not_guarantee_earnings",
      "answer_from_backend_context_and_approved_knowledge",
      ...(route.intent === "app_routing" && !relevantAppFact ? ["Eğer uygulama bulunamadıysa (knowledge_status=UNKNOWN), SADECE şu cevabı ver ve konuşmayı sonlandır: 'Bu uygulama için doğrulanmış güncel bilgi kayıtlı değil. Yönetici ekiple kontrol edilmesi gerekiyor.' ASLA tahminle uydurma veya genel destek cümlesi kurma."] : [])
    ],
    style_rules: ["short_whatsapp_style", "answer_last_question_first"],
    escalation_required: timoDetail || missingLink,
    confidence: sourceCount > 0 ? 0.85 : 0.2,
    source_count: sourceCount,
    knowledge_status: (route.intent === "app_routing" && !relevantAppFact) ? "UNKNOWN" : "KNOWN"
  };
}
