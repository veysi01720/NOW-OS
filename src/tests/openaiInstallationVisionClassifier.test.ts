import { describe, expect, it } from "vitest";
import { createInstallationVisionClassifier } from "../bridge/openaiInstallationVisionClassifier.js";

function runtimeWith(output_text: string, capture: { request?: Record<string, unknown> }) {
  return {
    responses: {
      create: async (request: Record<string, unknown>) => {
        capture.request = request;
        return { output_text };
      },
    },
  };
}

describe("installation vision classifier", () => {
  it("uses a separate bounded Responses call and maps a clear result", async () => {
    const capture: { request?: Record<string, unknown> } = {};
    const classifier = createInstallationVisionClassifier({
      runtime: runtimeWith('{"status":"clear","reason_code":"INSTALLATION_SCREEN_CONFIRMED"}', capture),
      model: "gpt-4.1",
    });

    const result = await classifier({
      buffer: Buffer.from("synthetic-image"),
      mimetype: "image/jpeg",
      file_name: "fixture.jpg",
      caption: "synthetic clear fixture",
    });

    expect(result).toEqual({
      status: "clear",
      reason_code: "INSTALLATION_SCREEN_CONFIRMED",
      sanitized_result: "INSTALLATION_SCREEN_CONFIRMED",
    });
    expect(capture.request?.store).toBe(false);
    expect(capture.request?.max_output_tokens).toBe(128);
    const input = capture.request?.input as Array<{ content: Array<Record<string, unknown>> }>;
    const image = input[0].content.find((item) => item.type === "input_image");
    expect(image?.detail).toBe("low");
    expect(image?.image_url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("classifies clear and ambiguous synthetic fixtures through the Terra Responses contract", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const outputs = [
      '{"status":"clear","reason_code":"INSTALLATION_SCREEN_CONFIRMED"}',
      '{"status":"ambiguous","reason_code":"INSTALLATION_SCREEN_UNCLEAR"}',
    ];
    const runtime = {
      responses: {
        create: async (request: Record<string, unknown>) => {
          requests.push(request);
          return { output_text: outputs[requests.length - 1] };
        },
      },
    };
    const classifier = createInstallationVisionClassifier({
      runtime,
      model: "gpt-5.6-terra",
    });

    const clear = await classifier({
      buffer: Buffer.from("synthetic-clear-installation-fixture"),
      mimetype: "image/png",
      file_name: "clear.png",
      caption: "synthetic clear fixture",
    });
    const ambiguousResult = await classifier({
      buffer: Buffer.from("synthetic-ambiguous-installation-fixture"),
      mimetype: "image/png",
      file_name: "ambiguous.png",
      caption: "synthetic ambiguous fixture",
    });

    expect(clear.status).toBe("clear");
    expect(clear.reason_code).toBe("INSTALLATION_SCREEN_CONFIRMED");
    expect(ambiguousResult.status).toBe("ambiguous");
    expect(ambiguousResult.reason_code).toBe("INSTALLATION_SCREEN_UNCLEAR");
    expect(clear.sanitized_result).not.toContain("synthetic-clear");
    expect(ambiguousResult.sanitized_result).not.toContain("synthetic-ambiguous");
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.model === "gpt-5.6-terra")).toBe(true);
    expect(requests.every((request) => request.store === false && request.max_output_tokens === 128)).toBe(true);
  });

  it("maps an ambiguous response and never exposes provider text", async () => {
    const classifier = createInstallationVisionClassifier({
      runtime: runtimeWith('{"status":"ambiguous","reason_code":"INSTALLATION_SCREEN_UNCLEAR"}', {}),
      model: "gpt-4.1",
    });
    const result = await classifier({
      buffer: Buffer.from("synthetic-image"),
      mimetype: "image/jpeg",
      file_name: "fixture.jpg",
      caption: "synthetic ambiguous fixture",
    });
    expect(result.status).toBe("ambiguous");
    expect(result.reason_code).toBe("INSTALLATION_SCREEN_UNCLEAR");
    expect(result.sanitized_result).not.toContain("synthetic-image");
  });

  it("fails closed for malformed provider output", async () => {
    const classifier = createInstallationVisionClassifier({
      runtime: runtimeWith("not-json", {}),
      model: "gpt-4.1",
    });
    const result = await classifier({
      buffer: Buffer.from("synthetic-image"),
      mimetype: "image/jpeg",
      file_name: "fixture.jpg",
      caption: "fixture",
    });
    expect(result).toMatchObject({ status: "ambiguous", reason_code: "VISION_INVALID_RESULT" });
  });
});
