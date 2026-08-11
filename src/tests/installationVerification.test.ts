import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { verifyInstallationMedia, INSTALLATION_VERIFICATION_MAX_BYTES } from "../bridge/installationVerification.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { defaultUserState } from "../storage/types.js";
import { PersistentHumanHandoffStore } from "../store/humanHandoffStore.js";
import { stripMediaBase64 } from "../reliability/shadowQueue.js";
import type { NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { createSilentLogger, createTestEnv, FakeSender, InMemoryUserStateStore } from "./testDoubles.js";
import { ambiguousInstallationScreenshot, clearInstallationScreenshot } from "./fixtures/installationVerificationFixtures.js";

function imageMessage(base64: string, overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  return {
    correlation_id: "corr_installation_verification",
    sender_id: "905333333333",
    phone_number: "905333333333",
    remote_jid: "905333333333@s.whatsapp.net",
    message_id: "msg_installation_verification",
    message_type: "imageMessage",
    text: "",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-08-10T00:00:00.000Z",
    media: {
      kind: "image",
      mimetype: "image/jpeg",
      file_name: "installation.jpg",
      file_size: Buffer.from(base64, "base64").length,
      caption: "kurulum doğrulama",
      base64,
    },
    ...overrides,
  };
}

function baseDeps() {
  return {
    env: createTestEnv(),
    sender: new FakeSender(),
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    userRunLock: new UserRunLock(),
    logger: createSilentLogger(),
  };
}

describe("installation verification media boundary", () => {
  it("advances INSTALLATION_IN_PROGRESS to TRAINING_READY for a clear classifier result", async () => {
    const stateStore = new InMemoryUserStateStore();
    stateStore.states.set("905333333333", {
      ...defaultUserState(),
      current_state: "INSTALLATION_IN_PROGRESS",
      installation_status: "in_progress",
    });
    const deps = {
      ...baseDeps(),
      userStateStore: stateStore,
      installationVerificationClassifier: ({ buffer }: { buffer: Buffer }) => {
        expect(buffer.length).toBeGreaterThan(0);
        return { status: "clear" as const, sanitized_result: "INSTALLATION_COMPLETE_CONFIRMED" };
      },
    };

    const result = await handleIncomingMessage(imageMessage(clearInstallationScreenshot), deps);

    expect(result.status).toBe("sent");
    expect(stateStore.states.get("905333333333")?.current_state).toBe("TRAINING_READY");
    expect(stateStore.states.get("905333333333")?.installation_status).toBe("done");
    expect(deps.sender.sends).toHaveLength(1);
  });

  it("keeps state unchanged and records an ambiguous verification handoff", async () => {
    const stateStore = new InMemoryUserStateStore();
    stateStore.states.set("905333333333", {
      ...defaultUserState(),
      current_state: "INSTALLATION_IN_PROGRESS",
      installation_status: "in_progress",
    });
    const handoffStore = new PersistentHumanHandoffStore(join(mkdtempSync(join(tmpdir(), "install-handoff-")), "handoffs.json"));
    const deps = {
      ...baseDeps(),
      userStateStore: stateStore,
      humanHandoffStore: handoffStore,
      installationVerificationClassifier: () => ({ status: "ambiguous" as const, sanitized_result: "UNCLEAR_INSTALLATION_SCREEN" }),
    };

    const result = await handleIncomingMessage(imageMessage(ambiguousInstallationScreenshot, { message_id: "msg_ambiguous" }), deps);

    expect(result.status).toBe("fallback_sent");
    expect(stateStore.states.get("905333333333")?.current_state).toBe("INSTALLATION_IN_PROGRESS");
    expect(handoffStore.list()[0]?.reason_code).toBe("installation_verification_ambiguous");
    expect(deps.sender.sends).toHaveLength(1);
  });

  it("records only metadata and sanitized result; raw image bytes never enter result or logs", async () => {
    const raw = "RAW_INSTALLATION_IMAGE_SENTINEL";
    const logger = createSilentLogger();
    let receivedRaw = false;
    const verification = await verifyInstallationMedia({
      media: imageMessage(Buffer.from(raw).toString("base64")).media!,
      now: 1_000,
      classifier: ({ buffer }) => {
        receivedRaw = buffer.toString("utf8") === raw;
        return { status: "ambiguous" as const, sanitized_result: "UNCLEAR_INSTALLATION_SCREEN" };
      },
    });

    logger.info({
      event_type: "INSTALLATION_VERIFICATION_RESULT",
      ...verification,
      raw_media_logged: false,
    });
    expect(receivedRaw).toBe(true);
    expect(JSON.stringify(verification)).not.toContain(raw);
    expect(JSON.stringify(logger.events)).not.toContain(raw);
    expect(verification.media_size).toBe(raw.length);
    expect(verification.media_sha256).toHaveLength(64);
    expect(verification.expires_at).toBe(new Date(1_000 + 60 * 60 * 1000).toISOString());
  });

  it("allows bounded image bytes only in the explicit installation verification scope", () => {
    const raw = Buffer.from("bounded-image").toString("base64");
    const message = imageMessage(raw);
    expect(stripMediaBase64(message).media?.base64).toBeUndefined();
    expect(stripMediaBase64(message, { scope: "installation_verification" }).media?.base64).toBe(raw);

    const oversized = Buffer.alloc(INSTALLATION_VERIFICATION_MAX_BYTES + 1, 1).toString("base64");
    expect(stripMediaBase64(imageMessage(oversized), { scope: "installation_verification" }).media?.base64).toBeUndefined();
  });

  it("fails closed above the 2 MB boundary", async () => {
    const oversized = Buffer.alloc(INSTALLATION_VERIFICATION_MAX_BYTES + 1, 1).toString("base64");
    const result = await verifyInstallationMedia({
      media: imageMessage(oversized).media!,
      now: 1_000,
      classifier: () => ({ status: "clear" as const, sanitized_result: "SHOULD_NOT_RUN" }),
    });

    expect(result.status).toBe("ambiguous");
    expect(result.sanitized_result).toBe("MEDIA_SIZE_EXCEEDED");
  });

  it("keeps the vision feature flag disabled by default in test runtime", () => {
    expect(createTestEnv().installationVisionEnabled).toBe(false);
  });
});
