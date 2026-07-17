import { normalizeText } from "../followUpQueue.js";
import type { IngestionClass } from "../../storage/ingestionTypes.js";

export function classifyMessage(text: string): IngestionClass[] {
  const norm = normalizeText(text);
  const classes: Set<IngestionClass> = new Set();

  if (norm.includes("kurulum") || norm.includes("yukleyemedim") || norm.includes("giris yapamiyorum")) {
    classes.add("installation_problem");
  }

  if (norm.includes("odeme") || norm.includes("para") || norm.includes("guvenilir mi") || norm.includes("ne zaman yatar") || /\b(is nedir|kazanc|maas|garanti)\b/u.test(norm)) {
    classes.add("payment_or_trust_question");
  }

  if (norm.includes("egitim") || norm.includes("nasil calisacagim") || norm.includes("nasil yapacagim")) {
    classes.add("training_question");
  }

  if (norm.includes("yapamadim") || norm.includes("olmuyor") || norm.includes("takildim") || norm.includes("anlamadim") || norm.includes("hata veriyor") || /\b(yardim|hata verdi)\b/u.test(norm)) {
    classes.add("support_signal");
  }

  if (norm.includes("kavga") || norm.includes("kufur") || norm.includes("spam") || norm.includes("uygunsuz") || norm.includes("sikayet")) {
    classes.add("complaint_or_risk");
  }

  if (/\b(baslamak istiyorum|basla|baslayalim|katilmak istiyorum)\b/u.test(norm)) {
    classes.add("candidate_interest");
  }

  if (/\b(yayinci ariyoruz|ajans|davet|manager)\b/u.test(norm)) {
    classes.add("publisher_activity_signal");
  }

  if (classes.size === 0) {
    classes.add("unknown");
  }

  return Array.from(classes);
}
