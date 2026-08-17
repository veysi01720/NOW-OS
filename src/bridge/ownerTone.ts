import { createHash } from "node:crypto";

export const OWNER_DISPLAY_NAME = "Arda";

export type OwnerToneContext =
  | "daily_report"
  | "installation_review"
  | "knowledge_review"
  | "owner_answer_required"
  | "training_gate"
  | "owner_command"
  | "generic";

export type OwnerRecipientRole = "owner" | "manager";

const OWNER_NAME_PATTERN = /\bArda\b/u;

const INTRO_BY_CONTEXT: Record<OwnerToneContext, string> = {
  daily_report: "Arda, bugunun kisa operasyon ozeti:",
  installation_review: "Arda, kurulum gorseli icin kisa durum:",
  knowledge_review: "Arda, bilgi inceleme icin kisa ozet:",
  owner_answer_required: "Arda, adaydan net bilgi isteyen bir soru geldi:",
  training_gate: "Arda, kurulum sonrasi egitim kapisi icin not:",
  owner_command: "Arda, kisa durum:",
  generic: "Arda,"
};

export function ownerAssistantToneGuidanceLines(): string[] {
  return [
    "--- Owner Communication Personality ---",
    "- The owner is Arda. When sender_role is owner, you may address him as 'Arda,' or 'Merhaba Arda' at natural intervals, not in every message.",
    "- Speak to Arda like a reliable assistant helping with his operation, not like a cold system notification.",
    "- Do not force an observation in every reply. You may add a short practical observation only when it genuinely helps the owner understand the situation.",
    "- This owner personality applies only to owner-facing replies. Candidate-facing replies must stay focused on the job, setup, and candidate's latest question."
  ];
}

export function shouldAddressOwner(context: OwnerToneContext, seed: string): boolean {
  if (context === "daily_report") return true;
  const byte = createHash("sha256").update(`${context}:${seed}`).digest()[0] ?? 0;
  return byte % 3 === 0;
}

export function applyOwnerTone(
  text: string,
  options: {
    context?: OwnerToneContext;
    seed?: string;
    recipientRole?: OwnerRecipientRole;
    forceName?: boolean;
    observation?: string | null;
  } = {}
): string {
  const context = options.context ?? "generic";
  const recipientRole = options.recipientRole ?? "owner";
  let body = text.trim();

  const observation = options.observation?.trim();
  if (observation) {
    body = `${body}\n\nKisa izlenim: ${observation}`;
  }

  if (recipientRole !== "owner" || OWNER_NAME_PATTERN.test(body)) {
    return body;
  }

  const seed = options.seed ?? body;
  if (!options.forceName && !shouldAddressOwner(context, seed)) {
    return body;
  }

  const intro = INTRO_BY_CONTEXT[context];
  if (context === "generic" || context === "owner_command") {
    return `${intro} ${body}`;
  }
  return `${intro}\n${body}`;
}
