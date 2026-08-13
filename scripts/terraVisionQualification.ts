import { createOpenAIInstallationVisionClassifier } from "../src/bridge/openaiInstallationVisionClassifier.js";
import { readFileSync } from "node:fs";

const CLEAR_PNG = readFileSync(new URL("./fixtures/clear-installation.png", import.meta.url));
const AMBIGUOUS_PNG = readFileSync(new URL("./fixtures/ambiguous-installation.png", import.meta.url));

async function main(): Promise<void> {
  if (process.env.RESPONSES_QUALIFICATION_REAL !== "true") throw new Error("REAL_QUALIFICATION_FLAG_REQUIRED");
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESPONSES_MODEL?.trim();
  if (!apiKey || !model) throw new Error("QUALIFICATION_CONFIG_MISSING");
  const classifier = await createOpenAIInstallationVisionClassifier({ apiKey, model });
  const clear = await classifier({
    buffer: CLEAR_PNG,
    mimetype: "image/png",
    file_name: "synthetic-clear-installation-fixture.png",
    caption: "Synthetic fixture: installation completion screen is clear and complete.",
  });
  const ambiguous = await classifier({
    buffer: AMBIGUOUS_PNG,
    mimetype: "image/png",
    file_name: "synthetic-ambiguous-installation-fixture.png",
    caption: "Synthetic fixture: installation screen is partial and ambiguous.",
  });
  console.log(JSON.stringify({
    procedure: "terra_vision_classifier",
    model,
    clear_fixture: clear,
    ambiguous_fixture: ambiguous,
    raw_output_logged: false,
    real_outbound_count: 0,
    secrets_printed: false,
  }));
  if (clear.status !== "clear" || ambiguous.status !== "ambiguous") process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", error_name: error instanceof Error ? error.name : "UNKNOWN_ERROR", raw_output_logged: false, real_outbound_count: 0, secrets_printed: false }));
  process.exitCode = 1;
});
