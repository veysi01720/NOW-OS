// @ts-nocheck
import Fastify from "fastify";
import { buildEvolutionIdempotencyKey, registerEvolutionWebhook } from "../bridge/evolutionWebhook.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import { ConnectionHealthMonitor } from "../observability/connectionHealthMonitor.js";
import { InMemoryReliabilityQueueStore } from "../reliability/inMemoryReliabilityQueueStore.js";
import type { EnqueueReliabilityJobInput, ReliabilityQueueStore } from "../reliability/queueTypes.js";
import {
  createSilentLogger,
  createTestEnv,
  FailingSender,
  FakeAssistantClient,
  FakeSender,
  InMemoryUserStateStore
} from "./testDoubles.js";

class FailingReliabilityQueueStore extends InMemoryReliabilityQueueStore implements ReliabilityQueueStore {
  enqueue(input: EnqueueReliabilityJobInput): never {
    throw new Error(`queue unavailable for ${input.queue_name}`);
  }
}

describe("POST /webhooks/evolution", () => {
  it("normalizes webhook, runs Assistant, and sends reply", async () => {
    const app = Fastify({ logger: false });
    const sender = new FakeSender();
    const logger = createSilentLogger();
    const connectionHealthMonitor = new ConnectionHealthMonitor({
      evolutionInstance: "nowakademi_bot",
      evolutionApiBaseUrl: "http://evolution.local",
      evolutionApiKey: "secret-key",
      logger,
      now: () => new Date("2026-07-10T12:05:00.000Z"),
    });
    registerEvolutionWebhook(app, {
      env: createTestEnv(),
      assistantClient: new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}'
      ]),
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      connectionHealthMonitor,
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/evolution",
      payload: {
        data: {
          key: {
            remoteJid: "905333333333@s.whatsapp.net",
            fromMe: false,
            id: "msg_webhook"
          },
          messageType: "conversation",
          message: {
            conversation: "25 kadin 4 saat Selam"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "sent"
      })
    );
    expect(sender.sends[0]?.text).toBe("Webhook cevabi");
    expect(connectionHealthMonitor.snapshot().last_inbound_confirmed_at).toBe("2026-07-10T12:05:00.000Z");
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "INBOUND_CONFIRMED",
          chat_type: "private",
        }),
      ]),
    );

    await app.close();
  });

  it("returns 200 when sendText fails so Evolution does not retry as a webhook failure", async () => {
    const app = Fastify({ logger: false });
    registerEvolutionWebhook(app, {
      env: createTestEnv({ evolutionInstance: "nowakademi_bot" }),
      assistantClient: new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}'
      ]),
      sender: new FailingSender(401),
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger: createSilentLogger()
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/evolution",
      payload: {
        data: {
          key: {
            remoteJid: "905333333333@s.whatsapp.net",
            fromMe: false,
            id: "msg_send_failure"
          },
          messageType: "conversation",
          message: {
            conversation: "25 kadin 4 saat Selam"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "reply_send_failed",
      correlation_id: expect.any(String),
      error_layer: "EvolutionSendText"
    });

    await app.close();
  });

  it("uses a stable idempotency key and ignores duplicate webhooks before Assistant runs again", async () => {
    const app = Fastify({ logger: false });
    const assistantClient = new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}',
      '{"contract_version":"1.0","reply":"Duplicate should not run","internal_boss_note":"log"}',
    ]);
    const sender = new FakeSender();
    const logger = createSilentLogger();
    registerEvolutionWebhook(app, {
      env: createTestEnv(),
      assistantClient,
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      userRunLock: new UserRunLock(),
      logger,
    });

    const payload = {
      data: {
        key: {
          remoteJid: "905333333333@s.whatsapp.net",
          fromMe: false,
          id: "msg_duplicate",
        },
        messageType: "conversation",
        message: {
          conversation: "25 kadin 4 saat Selam",
        },
      },
    };

    const idempotencyKey = buildEvolutionIdempotencyKey("evolution", "905333333333@s.whatsapp.net", "msg_duplicate");
    expect(idempotencyKey).toMatch(/^evolution_[a-f0-9]{16}_[a-f0-9]{16}$/);

    const first = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });
    const second = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: "ignored", reason: "duplicate" });
    expect(assistantClient.runCalls).toHaveLength(1);
    expect(sender.sends).toHaveLength(1);
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "DUPLICATE_MESSAGE_IGNORED",
        }),
      ]),
    );

    await app.close();
  });

  it("dual-writes inbound queue in shadow mode without changing legacy response flow", async () => {
    const app = Fastify({ logger: false });
    const reliabilityQueueStore = new InMemoryReliabilityQueueStore();
    const sender = new FakeSender();
    const logger = createSilentLogger();
    registerEvolutionWebhook(app, {
      env: createTestEnv({ webhookQueueMode: "dual_write" }),
      assistantClient: new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}',
        '{"contract_version":"1.0","reply":"Duplicate should not run","internal_boss_note":"log"}',
      ]),
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      reliabilityQueueStore,
      userRunLock: new UserRunLock(),
      logger,
    });

    const payload = {
      data: {
        key: { remoteJid: "905333333333@s.whatsapp.net", fromMe: false, id: "msg_dual_write" },
        messageType: "conversation",
        message: { conversation: "25 kadin 4 saat Selam" },
      },
    };

    const first = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });
    const second = await app.inject({ method: "POST", url: "/webhooks/evolution", payload });

    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("sent");
    expect(second.statusCode).toBe(200);
    expect(reliabilityQueueStore.listJobs()).toHaveLength(1);
    expect(sender.sends).toHaveLength(1);
    expect(logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "INBOUND_QUEUE_SHADOW_WRITTEN" }),
    ]));

    await app.close();
  });

  it("preserves legacy flow and alerts when inbound dual-write queue fails", async () => {
    const app = Fastify({ logger: false });
    const sender = new FakeSender();
    const logger = createSilentLogger();
    registerEvolutionWebhook(app, {
      env: createTestEnv({ webhookQueueMode: "dual_write" }),
      assistantClient: new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}',
      ]),
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      reliabilityQueueStore: new FailingReliabilityQueueStore(),
      userRunLock: new UserRunLock(),
      logger,
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/evolution",
      payload: {
        data: {
          key: { remoteJid: "905333333333@s.whatsapp.net", fromMe: false, id: "msg_queue_fail" },
          messageType: "conversation",
          message: { conversation: "25 kadin 4 saat Selam" },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("sent");
    expect(sender.sends).toHaveLength(1);
    expect(logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "INFRA_QUEUE_WRITE_ALERT", queue_name: "inbound", legacy_flow_preserved: true }),
    ]));
    expect(JSON.stringify(logger.events)).not.toContain("905333333333@s.whatsapp.net");

    await app.close();
  });

  it("shadow-enqueues outbound reply without duplicate WhatsApp sends", async () => {
    const app = Fastify({ logger: false });
    const reliabilityQueueStore = new InMemoryReliabilityQueueStore();
    const sender = new FakeSender();
    const logger = createSilentLogger();
    registerEvolutionWebhook(app, {
      env: createTestEnv({ outboundQueueMode: "enqueue_shadow" }),
      assistantClient: new FakeAssistantClient([
        '{"contract_version":"1.0","reply":"Webhook cevabi","internal_boss_note":"log"}',
      ]),
      sender,
      threadStore: new InMemoryThreadStore(),
      memoryStore: new InMemoryStore(),
      messageDedupeStore: new InMemoryMessageDedupeStore(),
      userStateStore: new InMemoryUserStateStore(),
      reliabilityQueueStore,
      userRunLock: new UserRunLock(),
      logger,
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/evolution",
      payload: {
        data: {
          key: { remoteJid: "905333333333@s.whatsapp.net", fromMe: false, id: "msg_out_shadow" },
          messageType: "conversation",
          message: { conversation: "25 kadin 4 saat Selam" },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("sent");
    expect(sender.sends).toHaveLength(1);
    expect(reliabilityQueueStore.listJobs()).toHaveLength(1);
    expect(logger.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "OUTBOUND_QUEUE_SHADOW_WRITTEN", real_send_still_legacy_path: true }),
    ]));

    await app.close();
  });
});
