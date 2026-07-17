import type { ConversationalQualityContract } from "./types.js";

export interface QualityRewriteInput {
  reply: string;
  internalBossNote: string;
  quality: ConversationalQualityContract;
  violations: string[];
}

export interface QualityRewriteResult {
  reply: string;
  rewriteApplied: boolean;
  reasons: string[];
}

export const B6_QUALITY_SAFE_FALLBACK_REPLY =
  "Süreci sana adım adım anlatacağım. Aklına takılan her şeyi rahatça sorabilirsin; önce detayları inceleyip sonra karar verebilirsin.";

const ABSOLUTE_CLAIM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bkesin güvenli\b/giu, "süreci uygulama içinden birlikte kontrol edebiliriz"],
  [/\bkesin guvenli\b/giu, "süreci uygulama içinden birlikte kontrol edebiliriz"],
  [/\bhiç risk yok\b/giu, "şüphe duyduğun yerde ekrandan birlikte kontrol ederiz"],
  [/\bhic risk yok\b/giu, "şüphe duyduğun yerde ekrandan birlikte kontrol ederiz"],
  [/\bgaranti kazanç\b/giu, "kazanç kişiye ve sürece göre değişir"],
  [/\bgaranti kazanc\b/giu, "kazanç kişiye ve sürece göre değişir"],
  [/\bkesin kazanırsın\b/giu, "sonucu garanti gibi anlatmayalım"],
  [/\bkesin kazanirsin\b/giu, "sonucu garanti gibi anlatmayalım"],
];

const UNSUPPORTED_REFERENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/referans\s+(paylaşabileceğimi|paylasabilecegimi|paylaşabileceğinizi|paylasabileceginizi|paylaşabilirim|paylasabilirim|gösterebilirim|gosterebilirim)[^.!?\n]*/giu, "süreci açıkça anlatabilirim"],
  [/daha\s+önce\s+başlayanlardan\s+referans[^.!?\n]*/giu, "önce detayları inceleyip sonra karar verebilirsin"],
  [/daha\s+once\s+baslayanlardan\s+referans[^.!?\n]*/giu, "önce detayları inceleyip sonra karar verebilirsin"],
  [/kazanç\s+kanıtı[^.!?\n]*/giu, "süreçle ilgili net sorularını yanıtlayabilirim"],
  [/kazanc\s+kaniti[^.!?\n]*/giu, "süreçle ilgili net sorularını yanıtlayabilirim"],
];

const GENERIC_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/değerli kullanıcımız[, ]*/giu, ""],
  [/degerli kullanicimiz[, ]*/giu, ""],
  [/sizlere yardımcı olmaktan mutluluk duyarız[.! ]*/giu, ""],
  [/sizlere yardimci olmaktan mutluluk duyariz[.! ]*/giu, ""],
  [/başka bir konuda yardımcı olabilir miyim[?!. ]*/giu, ""],
  [/baska bir konuda yardimci olabilir miyim[?!. ]*/giu, ""],
  [/aşağıdaki adımları dikkatlice takip ediniz[.! ]*/giu, ""],
  [/asagidaki adimlari dikkatlice takip ediniz[.! ]*/giu, ""],
];

function normalizeWhitespace(text: string): string {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function trimToSentenceBudget(text: string, maxSentences: number): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length <= maxSentences) return text;
  return sentences.slice(0, maxSentences).join(" ");
}

export function rewriteReplyForQuality(input: QualityRewriteInput): QualityRewriteResult {
  let reply = input.reply;
  const reasons: string[] = [];

  if (input.internalBossNote.trim() && reply.includes(input.internalBossNote.trim())) {
    reply = reply.replaceAll(input.internalBossNote.trim(), "");
    reasons.push("removed_internal_note_echo");
  }

  if (input.violations.includes("authority_title_for_non_managerial_reply")) {
    reply = reply.replace(/^\s*(şef|sef|dayı|dayi|patron)[,\s:;-]*/iu, "");
    reasons.push("removed_non_managerial_title");
  }

  if (input.violations.includes("unsupported_absolute_claim")) {
    for (const [pattern, replacement] of ABSOLUTE_CLAIM_REPLACEMENTS) {
      reply = reply.replace(pattern, replacement);
    }
    reasons.push("softened_absolute_claims");
  }

  if (input.violations.includes("UNSUPPORTED_REFERENCE_OFFER")) {
    for (const [pattern, replacement] of UNSUPPORTED_REFERENCE_REPLACEMENTS) {
      reply = reply.replace(pattern, replacement);
    }
    reasons.push("removed_unsupported_reference_offer");
  }

  if (input.violations.includes("UNSUPPORTED_HARD_CLAIM")) {
    for (const [pattern, replacement] of ABSOLUTE_CLAIM_REPLACEMENTS) {
      reply = reply.replace(pattern, replacement);
    }
    reply = reply.replace(/\bgaranti\b/giu, "net olmayan");
    reply = reply.replace(/sorun\s+yaşamazsınız/giu, "takıldığın yerde birlikte kontrol ederiz");
    reply = reply.replace(/sorun\s+yasamazsiniz/giu, "takıldığın yerde birlikte kontrol ederiz");
    reasons.push("softened_hard_claims");
  }

  if (input.violations.includes("REPEATED_OWNER_ADDRESS")) {
    reply = reply.replace(/^\s*(şef|sef|dayı|dayi|patron)[,\s:;-]*/iu, "");
    reasons.push("removed_repeated_owner_address");
  }

  if (input.violations.includes("UNNECESSARY_CONTEXT_RESTATEMENT")) {
    reply = reply
      .replace(/görüntülü\s+zorunlu\s+değil[^.!?\n]*[.!?]?/giu, "")
      .replace(/goruntulu\s+zorunlu\s+degil[^.!?\n]*[.!?]?/giu, "")
      .replace(/tamamen\s+metin\s+tabanlı\s+çalışabilir[^.!?\n]*[.!?]?/giu, "")
      .replace(/tamamen\s+metin\s+tabanli\s+calisabilir[^.!?\n]*[.!?]?/giu, "");
    reasons.push("removed_text_only_restatement");
  }

  if (input.violations.includes("generic_service_script")) {
    for (const [pattern, replacement] of GENERIC_PHRASE_REPLACEMENTS) {
      reply = reply.replace(pattern, replacement);
    }
    reasons.push("removed_generic_service_phrases");
  }

  if (input.violations.includes("repeated_paragraph")) {
    const seen = new Set<string>();
    reply = reply
      .split(/\n+/u)
      .map((part) => part.trim())
      .filter((part) => {
        const key = part.toLocaleLowerCase("tr-TR");
        if (!part || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join("\n");
    reasons.push("deduplicated_paragraphs");
  }

  if (input.violations.includes("very_short_budget_exceeded")) {
    reply = trimToSentenceBudget(reply, 2);
    reasons.push("trimmed_to_very_short_budget");
  } else if (input.violations.includes("short_budget_exceeded")) {
    reply = trimToSentenceBudget(reply, 5);
    reasons.push("trimmed_to_short_budget");
  }

  return {
    reply: normalizeWhitespace(reply),
    rewriteApplied: reasons.length > 0,
    reasons,
  };
}
