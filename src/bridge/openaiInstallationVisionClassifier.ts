import type {
  InstallationVerificationClassifier,
  InstallationVerificationClassifierResult,
} from "./installationVerification.js";

type VisionResponse = {
  output_text?: string;
};

type VisionRuntime = {
  responses: {
    create(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<VisionResponse>;
  };
};

const INSTALLATION_VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["clear", "ambiguous"] },
    reason_code: { type: "string", enum: ["INSTALLATION_SCREEN_CONFIRMED", "INSTALLATION_SCREEN_UNCLEAR"] },
  },
  required: ["status", "reason_code"],
};

function ambiguous(reason_code: "VISION_PROVIDER_FAILURE" | "VISION_PROVIDER_TIMEOUT" | "VISION_INVALID_RESULT"):
  InstallationVerificationClassifierResult {
  return { status: "ambiguous", reason_code, sanitized_result: reason_code };
}

function parseClassifierResult(outputText: string | undefined): InstallationVerificationClassifierResult {
  if (!outputText) return ambiguous("VISION_INVALID_RESULT");
  try {
    const parsed = JSON.parse(outputText) as Record<string, unknown>;
    const status = parsed.status;
    const reason_code = parsed.reason_code;
    if ((status !== "clear" && status !== "ambiguous") ||
      (reason_code !== "INSTALLATION_SCREEN_CONFIRMED" && reason_code !== "INSTALLATION_SCREEN_UNCLEAR")) {
      return ambiguous("VISION_INVALID_RESULT");
    }
    if (status === "clear" && reason_code !== "INSTALLATION_SCREEN_CONFIRMED") {
      return ambiguous("VISION_INVALID_RESULT");
    }
    return {
      status,
      reason_code,
      sanitized_result: reason_code,
    };
  } catch {
    return ambiguous("VISION_INVALID_RESULT");
  }
}

export function createInstallationVisionClassifier(input: {
  runtime: VisionRuntime;
  model: string;
  timeoutMs?: number;
}): InstallationVerificationClassifier {
  const timeoutMs = input.timeoutMs ?? 15_000;

  return async ({ buffer, mimetype, caption }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await input.runtime.responses.create({
        model: input.model,
        store: false,
        max_output_tokens: 128,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Classify only whether this installation screenshot clearly proves completion. Caption: ${caption || "(none)"}`,
            },
            {
              type: "input_image",
              image_url: `data:${mimetype};base64,${buffer.toString("base64")}`,
              detail: "low",
            },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "installation_verification",
            strict: true,
            schema: INSTALLATION_VISION_SCHEMA,
          },
        },
      }, { signal: controller.signal });
      return parseClassifierResult(response.output_text);
    } catch (error: any) {
      return ambiguous(error?.name === "AbortError" ? "VISION_PROVIDER_TIMEOUT" : "VISION_PROVIDER_FAILURE");
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function createOpenAIInstallationVisionClassifier(input: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Promise<InstallationVerificationClassifier> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: input.apiKey });
  return createInstallationVisionClassifier({
    runtime: client as unknown as VisionRuntime,
    model: input.model,
    timeoutMs: input.timeoutMs,
  });
}
