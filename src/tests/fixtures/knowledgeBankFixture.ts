import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_KNOWLEDGE_SOURCE_FILES } from "../../bridge/sourceIntegrity.js";

export function validStructuredAppFactsJson(): string {
  return `${JSON.stringify({
    version: "1.0",
    source: "owner_approved_official_app_facts",
    app_facts: [
      {
        app: "Layla",
        android_name: "Layla",
        ios_name: "NIVI",
        invite_code: "8UNHAWUFC",
        agency_bind_code: null,
        agency_code: null,
        official_url: null,
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

