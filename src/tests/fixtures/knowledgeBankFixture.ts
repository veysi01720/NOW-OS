import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../../bridge/sourceIntegrity.js";

export function validPolicySections(): Record<string, string> {
  return {
    first_contact_boundary: "First contact fixture: collect eligibility fields before setup details.",
    source_identity_tone: "Source fixture: current owner-approved knowledge wins and unknown facts are not invented.",
    routing_matrix: "Routing matrix fixture: recommend only owner-approved apps.",
    application_independence: "Application independence fixture: do not transfer one app's rules to another.",
    profile_bio_photo_rules: "Erkek adaylarda calisma kadin profili ve uygun kadin fotograflari uzerinden ilerler; bu model aday uygunlugu ve acik onay alinarak net anlatilir. Kamera veya goruntulu calisma zorunlu diye anlatilmaz.",
    memory_rules: "Memory fixture: do not ask for known information again.",
    eligibility_rejection: "Eligibility fixture: apply approved age and eligibility limits.",
    installation_process: "Installation process fixture: use the app-specific steps and control screens.",
    installation_permission: "Installation fixture: require explicit installation permission.",
    installation_proof_retry: "Installation proof fixture: require evidence and owner review after retry.",
    privacy_payment_support: "Kazanc performansa, sohbet kalitesine, hediyelere ve uygulama performansina gore degisir. Cekim ve odeme adimlari uygulama ekranindaki bilgilerle takip edilir; minimum, kesinti ve IBAN duzeltmesi uygulama icinden kontrol edilir.",
    followup_closure_group_rules: "Follow-up fixture: respect closure and group-operation rules.",
    owner_training_routing: "Training routing fixture: use the current owner-approved educator after installation approval.",
  };
}

export function validStructuredAppFactsJson(): string {
  return `${JSON.stringify({
    version: "1.0",
    source: "owner_approved_official_app_facts",
    general_work_model: {
      app_independent: true,
      source_section: "Genel İş Modeli",
      summary: "Çalışma telefon ve uygulama üzerinden ilerler; profil hazırlanır ve uygulama içindeki kişilerle sohbet edilir.",
      workflow: "Aday uygunluk bilgilerini verir ve açık başlangıç isteğinden sonra kurulumuna geçer.",
      earnings_policy: "Kazanc performansa, sohbet kalitesine, hediyelere ve uygulama performansina gore degisir.",
      payment_policy: "Cekim ve odeme adimlari uygulama ekranindaki bilgilerle takip edilir.",
      setup_boundary: "Kurulum ayrıntıları çalışma modeli kabulünden sonra verilir.",
    },
    policy_sections: validPolicySections(),
    app_facts: [
      {
        app: "Layla",
        android_name: "Layla",
        ios_name: "NIVI",
        invite_code: "8UNHAWUFC",
        agency_bind_code: null,
        agency_code: null,
        official_url: "https://example.test/layla",
        status: "owner_approved",
        aliases: ["NIVI"],
        capabilities: { text_only: true, video_required: false },
      },
      {
        app: "TanChat",
        android_name: "TanChat",
        ios_name: "TanStar",
        invite_code: "X3XREZ",
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: ["TanStar"],
        capabilities: { text_only: false, video_required: null },
      },
      {
        app: "Amar",
        android_name: "Amar",
        ios_name: "Amar Lite",
        invite_code: "xvrgZkf6",
        agency_bind_code: "10621",
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: ["Amar Lite"],
        capabilities: { text_only: false, video_required: null },
      },
      {
        app: "Linky",
        android_name: "Linky",
        ios_name: "Linky",
        invite_code: "M9W5B8",
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: [],
        capabilities: { text_only: false, video_required: null },
      },
      {
        app: "Soyo",
        android_name: "Soyo",
        ios_name: "Soyo",
        invite_code: "3997",
        agency_bind_code: null,
        agency_code: "3997",
        official_url: null,
        status: "owner_approved",
        aliases: [],
        capabilities: { text_only: false, video_required: null },
      },
      {
        app: "Timo",
        android_name: "Timo",
        ios_name: "Timo",
        invite_code: "VVXVUD",
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
        status: "owner_approved",
        aliases: [],
        capabilities: { text_only: false, video_required: null },
      },
    ],
  }, null, 2)}\n`;
}

export function validAppFactsMarkdown(includeTimo = false): string {
  return [
    "# Official App Facts",
    "",
    "## Genel İş Modeli",
    "",
    "- summary: Çalışma telefon ve uygulama üzerinden ilerler; profil hazırlanır ve uygulama içindeki kişilerle sohbet edilir.",
    "- workflow: Aday uygunluk bilgilerini verir ve açık başlangıç isteğinden sonra kurulumuna geçer.",
    "- earnings_policy: Kazanc performansa, sohbet kalitesine, hediyelere ve uygulama performansina gore degisir.",
    "- payment_policy: Cekim ve odeme adimlari uygulama ekranindaki bilgilerle takip edilir.",
    "- setup_boundary: Kurulum ayrıntıları çalışma modeli kabulünden sonra verilir.",
    "",
    "## Kurulum Süreci",
    "",
    "- Installation process fixture: use the app-specific steps and control screens.",
    "",
    "## Uygulama Yönlendirme Matrisi",
    "",
    "- Routing matrix fixture: recommend only owner-approved apps.",
    "",
    "## Uygulama Bağımsızlığı",
    "",
    "- Application independence fixture: do not transfer one app's rules to another.",
    "",
    "## Profil, Bio ve Fotoğraf Kuralları",
    "",
    "- Erkek adaylarda calisma kadin profili ve uygun kadin fotograflari uzerinden ilerler; bu model aday uygunlugu ve acik onay alinarak net anlatilir. Kamera veya goruntulu calisma zorunlu diye anlatilmaz.",
    "",
    "## Bellek ve Tekrar Sormama",
    "",
    "- Memory fixture: do not ask for known information again.",
    "",
    "## İlk Temas Sınırı",
    "",
    "- First contact fixture: collect eligibility fields before setup details.",
    "",
    "## Kaynak Kimlik ve Ton",
    "",
    "- Source fixture: current owner-approved knowledge wins and unknown facts are not invented.",
    "",
    "## Uygunluk ve Red",
    "",
    "- Eligibility fixture: apply approved age and eligibility limits.",
    "",
    "## Kurulum İzni",
    "",
    "- Installation fixture: require explicit installation permission.",
    "",
    "## Uygulama Özel Kurulum Kanıtı ve Retry",
    "",
    "- Installation proof fixture: require evidence and owner review after retry.",
    "",
    "## Gizlilik, Ödeme ve Teknik Destek",
    "",
    "- Kazanc performansa, sohbet kalitesine, hediyelere ve uygulama performansina gore degisir. Cekim ve odeme adimlari uygulama ekranindaki bilgilerle takip edilir; minimum, kesinti ve IBAN duzeltmesi uygulama icinden kontrol edilir.",
    "",
    "## Takip, Kapanış ve Grup Operasyonları",
    "",
    "- Follow-up fixture: respect closure and group-operation rules.",
    "",
    "## Owner Üzerinden Dinamik Eğitim Yönlendirme",
    "",
    "- Training routing fixture: use the current owner-approved educator after installation approval.",
    "",
    "| app | android_name | ios_name | invite_code | agency_bind_code | agency_code | official_url | status | notes |",
    "|---|---|---|---|---|---|---|---|---|",
    "| Layla | Layla | NIVI | 8UNHAWUFC |  |  |  | owner_approved | Text-only |",
    "| TanChat | TanChat | TanStar | X3XREZ |  |  |  | owner_approved | Active |",
    "| Amar | Amar | Amar Lite | xvrgZkf6 | 10621 |  |  | owner_approved | Agency binding |",
    "| Linky | Linky | Linky | M9W5B8 |  |  |  | owner_approved | Code |",
    "| Soyo | Soyo | Soyo | 3997 |  | 3997 |  | owner_approved | Code |",
    ...(includeTimo ? ["| Timo | Timo | Timo | VVXVUD |  |  |  | owner_approved | Escalate details |"] : []),
    "",
  ].join("\n");
}

export function writeValidKnowledgeBankFixture(dir: string, options: { includeTimo?: boolean } = {}): void {
  mkdirSync(dir, { recursive: true });
  const generic = [
    "# Official Source",
    "",
    "Owner approved operational source content. This file intentionally contains real policy text for dry-run assembly tests.",
    "It carries stable operational guidance and must be copied into the bundle without replacing official source content.",
    "",
  ].join("\n");
  for (const fileName of REQUIRED_KNOWLEDGE_SOURCE_FILES) writeFileSync(resolve(dir, fileName), generic, "utf8");
  writeFileSync(resolve(dir, "app_facts.md"), validAppFactsMarkdown(options.includeTimo ?? false), "utf8");
  writeFileSync(resolve(dir, "app_facts_structured.json"), validStructuredAppFactsJson(), "utf8");
  writeFileSync(
    resolve(dir, "app_routing_rules.md"),
    [
      "# App Routing Rules",
      "",
      "| Candidate profile | Recommended app |",
      "|---|---|",
      "| Sadece mesajlasmak isteyen | Layla (iPhone: NIVI) |",
      "| Kamera acmak istemeyen ama sesli yapabilen | Layla (iPhone: NIVI) |",
      "| Yuz gostermek istemeyen veya text-only isteyen | Layla (iPhone: NIVI) |",
      "",
      "Layla routing evidence must stay present for messaging-only candidates.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    resolve(dir, "link_catalog.md"),
    [
      "# Link Catalog",
      "",
      "Generic store links are not allowed. Fake or tahmini links are forbidden. Link uydurmak yasak.",
      "Official URL yoksa kod veya ekran yonlendirmesi kullanilir; onaysiz link guvenilir sayilmaz.",
      "",
    ].join("\n"),
    "utf8",
  );
  const trainingDir = resolve(dir, "owner_approved_training");
  mkdirSync(trainingDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    writeFileSync(
      resolve(trainingDir, `v${index}.md`),
      [
        `# Training ${index}`,
        "",
        "Owner approved training content with enough operational detail to avoid thin-source rejection.",
        "This source is preserved as owner-approved training and is included as reference, not as an automatic override.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}
