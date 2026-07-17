export function classifyWhatsAppMessage(text: string) {
  const lower = text.toLowerCase();
  
  const detected_jargon: string[] = [];
  const detected_faq: string[] = [];
  const detected_objection: string[] = [];
  const detected_training_point: string[] = [];
  const detected_risk_flags: string[] = [];
  
  // Jargon
  if (lower.includes("coin") || lower.includes("koin")) detected_jargon.push("coin");
  if (lower.includes("pk")) detected_jargon.push("pk");
  if (lower.includes("ajans")) detected_jargon.push("ajans");
  if (lower.includes("yayın") || lower.includes("yayinci")) detected_jargon.push("yayıncı");
  if (lower.includes("keşfet") || lower.includes("kesfet")) detected_jargon.push("keşfet");

  // FAQ
  if (lower.includes("nasıl çekilir") || lower.includes("para çekme") || lower.includes("hesaba yat")) detected_faq.push("para çekme");
  if (lower.includes("ne kadar kazanırım") || lower.includes("kazancım ne")) detected_faq.push("kazanç beklentisi");
  if (lower.includes("şartlar") || lower.includes("kurallar neler")) detected_faq.push("şartlar ve kurallar");

  // Objection
  if (lower.includes("güvenmiyorum") || lower.includes("güvenilir mi")) detected_objection.push("güven problemi");
  if (lower.includes("dolandırıcı")) detected_objection.push("dolandırıcılık şüphesi");
  if (lower.includes("para istiyorlar") || lower.includes("ücretlimi") || lower.includes("ücretli mi")) detected_objection.push("ücret korkusu");
  if (lower.includes("vaktim yok")) detected_objection.push("zaman itirazı");

  // Training Points
  if (lower.includes("şu şekilde yapman") || lower.includes("böyle yap")) detected_training_point.push("yönlendirme");
  if (lower.includes("dikkat et") || lower.includes("önemli:")) detected_training_point.push("önemli uyarı");
  if (lower.includes("kural:")) detected_training_point.push("kural hatırlatması");

  // Risk Flags
  if (lower.includes("garanti") || lower.includes("kesin kazanç")) detected_risk_flags.push("kesin kazanç vaadi");
  if (lower.includes("kimlik at") || lower.includes("tc kimlik")) detected_risk_flags.push("kimlik talebi");

  let conversation_type: "onboarding" | "payment" | "installation" | "training" | "objection" | "support" | "followup" | "general" | "owner_platform_update" | "approved_app_update" | "setup_code_update" | "typo_tolerance_backend" = "general";
  if (lower.includes("ekle") || lower.includes("davet kodu") || lower.includes("profil fotoğrafı") || lower.includes("başkent") || lower.includes("onay benim")) {
    if (lower.includes("davet kodu")) conversation_type = "setup_code_update";
    else if (lower.includes("başkent") || lower.includes("backend")) conversation_type = "typo_tolerance_backend";
    else if (lower.includes("onay benim") || lower.includes("ekle")) conversation_type = "owner_platform_update";
    else conversation_type = "approved_app_update";
  } else if (detected_faq.includes("para çekme") || detected_faq.includes("kazanç beklentisi")) {
    conversation_type = "payment";
  } else if (detected_objection.length > 0) {
    conversation_type = "objection";
  } else if (detected_training_point.length > 0) {
    conversation_type = "training";
  } else if (lower.includes("indirdim") || lower.includes("kurulum") || lower.includes("linke tıkladım")) {
    conversation_type = "installation";
  }

  return {
    detected_jargon,
    detected_faq,
    detected_objection,
    detected_training_point,
    detected_risk_flags,
    conversation_type
  };
}
