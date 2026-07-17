import AdmZip from "adm-zip";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../bridge/handleIncomingMessage.js";
import { normalizeEvolutionMessage, type NormalizedIncomingMessage } from "../bridge/normalizeEvolutionMessage.js";
import { isUnsafeZipEntryPath, runZipIngestionJob } from "../bridge/zipIngestion/pipeline.js";
import { ZipIngestionStore } from "../bridge/zipIngestion/store.js";
import { UserRunLock } from "../queue/userRunLock.js";
import { InMemoryStore } from "../storage/memoryStore.js";
import { InMemoryMessageDedupeStore } from "../storage/messageDedupeStore.js";
import { InMemoryThreadStore } from "../storage/threadStore.js";
import {
  createSilentLogger,
  createTestEnv,
  FakeAssistantClient,
  FakeSender,
  InMemoryIngestionStore
} from "./testDoubles.js";

function makeZip(entries: Array<{ name: string; content: string | Buffer }>): Buffer {
  const zip = new AdmZip();
  for (const entry of entries) {
    zip.addFile(entry.name, typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : entry.content);
  }
  return zip.toBuffer();
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "nowos-zip-test-"));
}

function message(overrides: Partial<NormalizedIncomingMessage> = {}): NormalizedIncomingMessage {
  const zip = makeZip([{ name: "faq.txt", content: "Layla iPhone adi NIVI. Davet kodu egitim icin kontrol edilir." }]);
  return {
    correlation_id: "corr_zip",
    sender_id: "905111111111",
    phone_number: "905111111111",
    remote_jid: "905111111111@s.whatsapp.net",
    message_id: "msg_zip",
    message_type: "documentMessage",
    text: "#zip",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: "2026-07-10T00:00:00.000Z",
    media: {
      kind: "document",
      mimetype: "application/zip",
      file_name: "training.zip",
      file_size: zip.length,
      caption: "#zip",
      base64: zip.toString("base64")
    },
    ...overrides
  };
}

function deps(dir: string, sender = new FakeSender()) {
  return {
    env: createTestEnv({ approvedApps: ["Layla"], evolutionInstance: "nowakademi_bot" }),
    assistantClient: new FakeAssistantClient([
      '{"contract_version":"1.0","reply":"Assistant should not run","internal_boss_note":""}'
    ]),
    sender,
    threadStore: new InMemoryThreadStore(),
    memoryStore: new InMemoryStore(),
    messageDedupeStore: new InMemoryMessageDedupeStore(),
    ingestionStore: new InMemoryIngestionStore() as any,
    zipIngestionStore: new ZipIngestionStore(join(dir, "zip-store.json")),
    userRunLock: new UserRunLock(),
    logger: createSilentLogger()
  };
}

describe("Phase 3 ZIP ingestion pipeline", () => {
  it("normalizes Evolution documentMessage metadata and caption", () => {
    const zip = makeZip([{ name: "a.txt", content: "hello" }]);
    const normalized = normalizeEvolutionMessage({
      data: {
        key: { remoteJid: "905111111111@s.whatsapp.net", fromMe: false, id: "doc_1" },
        messageType: "documentMessage",
        base64: zip.toString("base64"),
        message: {
          documentMessage: {
            mimetype: "application/zip",
            fileName: "bundle.zip",
            fileLength: zip.length,
            caption: "#zip"
          }
        }
      }
    });

    expect(normalized.text).toBe("#zip");
    expect(normalized.media).toEqual(
      expect.objectContaining({
        kind: "document",
        mimetype: "application/zip",
        file_name: "bundle.zip",
        base64: expect.any(String)
      })
    );
  });

  it("owner #zip valid zip is processed without Assistant run", async () => {
    const dir = tempDir();
    try {
      const testDeps = deps(dir);
      const result = await handleIncomingMessage(message(), testDeps);

      expect(result.status).toBe("zip_ingestion_started");
      expect(testDeps.assistantClient.runCalls).toHaveLength(0);
      expect(testDeps.sender.sends.map((send) => send.text)).toEqual([
        "Tamam patron, ZIP'i aldim. Guvenli sekilde cozip inceleme kuyruguna aliyorum.",
        "Patron ZIP cozuldu. 1 dosya okundu, 1 kayit inceleme kuyruguna alindi. Knowledge'a otomatik yazmadim."
      ]);
      expect(testDeps.zipIngestionStore.listJobs()[0]).toEqual(
        expect.objectContaining({
          status: "completed",
          accepted_entries: 1,
          approved_for_review: true
        })
      );
      expect(testDeps.ingestionStore.listLearningSuggestions()[0]).toEqual(
        expect.objectContaining({
          status: "pending_owner_review",
          source_type: "zip_ingestion"
        })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("manager #zip uses manager acknowledgement", async () => {
    const dir = tempDir();
    try {
      const testDeps = deps(dir);
      await handleIncomingMessage(
        message({
          sender_id: "905222222222",
          phone_number: "905222222222",
          remote_jid: "905222222222@s.whatsapp.net"
        }),
        testDeps
      );

      expect(testDeps.sender.sends[0]?.text).toContain("dayi");
      expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normal user zip is rejected and Assistant is skipped", async () => {
    const dir = tempDir();
    try {
      const testDeps = deps(dir);
      const result = await handleIncomingMessage(
        message({
          sender_id: "905333333333",
          phone_number: "905333333333",
          remote_jid: "905333333333@s.whatsapp.net"
        }),
        testDeps
      );

      expect(result.status).toBe("sent");
      expect(testDeps.sender.sends[0]?.text).toBe("Bu dosya islemi yetkili ekip tarafindan yapilabiliyor.");
      expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("owner zip without #zip asks for prefix", async () => {
    const dir = tempDir();
    try {
      const testDeps = deps(dir);
      await handleIncomingMessage(message({ text: "" }), testDeps);

      expect(testDeps.sender.sends[0]?.text).toContain("#zip");
      expect(testDeps.zipIngestionStore.listJobs()).toHaveLength(0);
      expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("non-zip document is rejected as unsupported when archive extension is unsafe", async () => {
    const dir = tempDir();
    try {
      const testDeps = deps(dir);
      await handleIncomingMessage(
        message({
          media: {
            kind: "document",
            mimetype: "application/vnd.android.package-archive",
            file_name: "bad.apk",
            caption: "#zip",
            base64: Buffer.from("not zip").toString("base64")
          }
        }),
        testDeps
      );

      expect(testDeps.sender.sends[0]?.text).toContain("sadece .zip");
      expect(testDeps.assistantClient.runCalls).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks zip slip paths", async () => {
    expect(isUnsafeZipEntryPath("../evil.txt")).toBe(true);
    expect(isUnsafeZipEntryPath("safe/../evil.txt")).toBe(true);
    expect(isUnsafeZipEntryPath("safe/file.txt")).toBe(false);
  });

  it("keeps manifest knowledge/vector/publish safety flags false", async () => {
    const dir = tempDir();
    try {
      const zipStore = new ZipIngestionStore(join(dir, "zip-store.json"));
      const result = await runZipIngestionJob({
        message: message({
          media: {
            kind: "document",
            mimetype: "application/zip",
            file_name: "evil.zip",
            caption: "#zip",
            base64: makeZip([{ name: "../evil.txt", content: "bad" }]).toString("base64")
          }
        }),
        senderRole: "owner",
        env: createTestEnv(),
        zipStore,
        logger: createSilentLogger(),
        dataDir: dir
      });

      expect(result.manifest.knowledge_modified).toBe(false);
      expect(result.manifest.vector_modified).toBe(false);
      expect(result.manifest.publish_triggered).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks absolute paths, nested zips, unsafe binaries, too many files, and oversized zips", async () => {
    expect(isUnsafeZipEntryPath("/abs.txt")).toBe(true);
    const dir = tempDir();
    try {
      const zipStore = new ZipIngestionStore(join(dir, "zip-store.json"));
      const nested = makeZip([{ name: "inner.txt", content: "x" }]);
      const result = await runZipIngestionJob({
        message: message({
          media: {
            kind: "document",
            mimetype: "application/zip",
            file_name: "mixed.zip",
            caption: "#zip",
            base64: makeZip([
              { name: "/abs.txt", content: "bad" },
              { name: "nested.zip", content: nested },
              { name: "run.exe", content: "bad" }
            ]).toString("base64")
          }
        }),
        senderRole: "owner",
        env: createTestEnv(),
        zipStore,
        logger: createSilentLogger(),
        dataDir: dir
      });
      expect(result.entries.map((entry) => entry.reject_reason)).toEqual(
        expect.arrayContaining(["nested_zip_rejected", "unsafe_binary_rejected"])
      );

      await expect(
        runZipIngestionJob({
          message: message({
            media: {
              kind: "document",
              mimetype: "application/zip",
              file_name: "many.zip",
              caption: "#zip",
              base64: makeZip([
                { name: "a.txt", content: "a" },
                { name: "b.txt", content: "b" }
              ]).toString("base64")
            }
          }),
          senderRole: "owner",
          env: createTestEnv(),
          zipStore,
          logger: createSilentLogger(),
          limits: { maxZipBytes: 10_000, maxFiles: 1, maxExtractedBytes: 10_000, maxEntryBytes: 10_000, processTimeoutSeconds: 10 },
          dataDir: dir
        })
      ).rejects.toThrow(/TOO_MANY_FILES/);

      await expect(
        runZipIngestionJob({
          message: message(),
          senderRole: "owner",
          env: createTestEnv(),
          zipStore,
          logger: createSilentLogger(),
          limits: { maxZipBytes: 10, maxFiles: 500, maxExtractedBytes: 10_000, maxEntryBytes: 10_000, processTimeoutSeconds: 10 },
          dataDir: dir
        })
      ).rejects.toThrow(/ZIP_TOO_LARGE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores media as metadata only and text as pending owner review", async () => {
    const dir = tempDir();
    try {
      const zipStore = new ZipIngestionStore(join(dir, "zip-store.json"));
      const result = await runZipIngestionJob({
        message: message({
          media: {
            kind: "document",
            mimetype: "application/zip",
            file_name: "media.zip",
            caption: "#zip",
            base64: makeZip([
              { name: "chat.txt", content: "Soru: Linky kod ne? Cevap: M9W5B8" },
              { name: "screen.png", content: Buffer.from([0, 1, 2, 3]) }
            ]).toString("base64")
          }
        }),
        senderRole: "owner",
        env: createTestEnv(),
        zipStore,
        logger: createSilentLogger(),
        dataDir: dir
      });

      expect(result.job.media_records).toBe(1);
      expect(result.entries.find((entry) => entry.extension === ".png")).toEqual(
        expect.objectContaining({ status: "metadata_only", extracted_text_length: 0 })
      );
      expect(result.candidates[0]).toEqual(
        expect.objectContaining({
          status: "pending_owner_review",
          candidate_type: "link_candidate"
        })
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects duplicate zip sha256 and does not create duplicate candidates", async () => {
    const dir = tempDir();
    try {
      const zipStore = new ZipIngestionStore(join(dir, "zip-store.json"));
      const logger = createSilentLogger();
      const first = await runZipIngestionJob({
        message: message(),
        senderRole: "owner",
        env: createTestEnv(),
        zipStore,
        logger,
        dataDir: dir
      });
      const second = await runZipIngestionJob({
        message: message({ message_id: "msg_zip_2" }),
        senderRole: "owner",
        env: createTestEnv(),
        zipStore,
        logger,
        dataDir: dir
      });

      expect(first.job.status).toBe("completed");
      expect(second.job.status).toBe("duplicate");
      expect(second.candidates).toHaveLength(0);
      expect(second.job.duplicate_of_job_id).toBe(first.job.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
