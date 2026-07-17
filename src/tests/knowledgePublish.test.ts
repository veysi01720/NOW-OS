import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { PersistentIngestionStore } from "../storage/ingestionStore.js";
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import { computeSourceHash, validatePublishSourceSafety, detectKnowledgePublishIntent, buildKnowledgePublishContext, maskOpenAIId, publishLocalKnowledgeToOpenAI } from "../bridge/knowledgePublish.js";

const TEST_ROOT = resolve(tmpdir(), "now-os-knowledge-publish-test");
const TEST_KNOWLEDGE_BANK_DIR = resolve(TEST_ROOT, "knowledge_bank");
const TEST_PUBLISH_MANIFEST_PATH = resolve(TEST_ROOT, "publish_manifest.json");
const DEFAULT_MD_TARGET = resolve(TEST_KNOWLEDGE_BANK_DIR, "approved_learning.md");
const STORE_DIR = resolve(TEST_ROOT, "test_store");

// Helper to create safe source
function createSafeSource() {
  if (!existsSync(TEST_KNOWLEDGE_BANK_DIR)) {
    mkdirSync(TEST_KNOWLEDGE_BANK_DIR, { recursive: true });
  }
  writeFileSync(DEFAULT_MD_TARGET, "## [KB-1] Safe Title\nSafe content.", "utf-8");
}

function cleanup() {
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
}

describe("Knowledge Publish v1", () => {
  beforeEach(() => {
    cleanup();
    process.env.KNOWLEDGE_BANK_DIR = TEST_KNOWLEDGE_BANK_DIR;
    process.env.PUBLISH_MANIFEST_PATH = TEST_PUBLISH_MANIFEST_PATH;
  });

  afterAll(() => {
    cleanup();
    delete process.env.KNOWLEDGE_BANK_DIR;
    delete process.env.PUBLISH_MANIFEST_PATH;
  });

  it("detects publish intent", () => {
    expect(detectKnowledgePublishIntent("bilgi bankası yayın durumu")).toBe("check_publish_status");
    expect(detectKnowledgePublishIntent("bilgi bankasını yayınla")).toBe("publish_local_knowledge");
    expect(detectKnowledgePublishIntent("başka bir şey")).toBeNull();
  });

  it("validates safety correctly", () => {
    expect(validatePublishSourceSafety("sk-12345678901234567890").is_safe).toBe(false);
    expect(validatePublishSourceSafety("phone +905554443322").is_safe).toBe(false);
    expect(validatePublishSourceSafety("safe text without secrets").is_safe).toBe(true);
  });

  it("masks OpenAI IDs correctly", () => {
    expect(maskOpenAIId("file-12345678901234567890abcd")).toBe("file-***abcd");
    expect(maskOpenAIId("vs_12345678901234567890xyzz")).toBe("vs_***xyzz");
  });

  it("builds context accurately for owner", () => {
    createSafeSource();
    const store = new PersistentIngestionStore(STORE_DIR);
    const ctx = buildKnowledgePublishContext("check_publish_status", "owner", store, { openaiApiKey: "test", openaiAssistantId: "test" } as any);
    expect(ctx.publish_ready).toBe(true);
    expect(ctx.publish_needed).toBe(true);
    expect(ctx.publish_preview.safety_scan_status).toBe("PASS");
  });

  it("prevents duplicate publish", async () => {
    createSafeSource();
    const store = new PersistentIngestionStore(STORE_DIR);
    
    // First publish
    const result1 = await publishLocalKnowledgeToOpenAI({ openaiApiKey: "test", openaiAssistantId: "test" } as any, store, "owner");
    expect(result1.success).toBe(true);
    
    // Second publish (duplicate)
    const result2 = await publishLocalKnowledgeToOpenAI({ openaiApiKey: "test", openaiAssistantId: "test" } as any, store, "owner");
    expect(result2.success).toBe(true); // it skips successfully
    expect(result2.message).toContain("Skipping duplicate publish");
  });

  describe("Real Adapter Tests", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    
    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("blocks real publish when feature flag is false", async () => {
      createSafeSource();
      const store = new PersistentIngestionStore(STORE_DIR);
      
      const env = { 
        openaiApiKey: "test", 
        openaiAssistantId: "test", 
        realOpenaiPublishEnabled: false 
      } as any;
      
      const result = await publishLocalKnowledgeToOpenAI(env, store, "owner");
      expect(result.success).toBe(true);
      expect(result.mode).toBe("mock");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows real publish with mocked fetch when feature flag is true and config is present", async () => {
      createSafeSource();
      const store = new PersistentIngestionStore(STORE_DIR);
      
      const env = { 
        openaiApiKey: "test", 
        openaiVectorStoreId: "vs_test123",
        openaiAssistantId: "test", 
        realOpenaiPublishEnabled: true 
      } as any;
      
      // Mock /v1/files and /v1/vector_stores/...
      fetchSpy.mockImplementation(async (url: any, options: any) => {
        const urlStr = typeof url === 'string' ? url : (url?.url || url?.toString() || "");
        console.log("Mock fetch called with:", urlStr);
        if (urlStr.includes("/v1/files")) {
          return new Response(JSON.stringify({ id: "file-1234abcd" }), { status: 200, headers: { "Content-Type": "application/json" }});
        }
        if (urlStr.includes("/v1/vector_stores/vs_test123/files") && !urlStr.includes("file-1234abcd")) {
          // attach call
          return new Response(JSON.stringify({ id: "file-1234abcd" }), { status: 200, headers: { "Content-Type": "application/json" }});
        }
        if (urlStr.includes("/v1/vector_stores/vs_test123/files/file-1234abcd")) {
          // retrieve call
          return new Response(JSON.stringify({ id: "file-1234abcd", status: "completed" }), { status: 200, headers: { "Content-Type": "application/json" }});
        }
        return new Response("Not Found", { status: 404 });
      });
      (globalThis.fetch as any).isMock = true;

      const result = await publishLocalKnowledgeToOpenAI(env, store, "owner");
      
      expect(result.success).toBe(true);
      expect(result.mode).toBe("real");
      expect(result.openai_file_id_masked).toBe("file-***abcd");
      expect(fetchSpy).toHaveBeenCalled();
    });

    it("fails cleanly if API key is missing when real mode enabled", async () => {
      createSafeSource();
      const store = new PersistentIngestionStore(STORE_DIR);
      
      const env = { 
        openaiApiKey: "", 
        openaiVectorStoreId: "vs_test123",
        openaiAssistantId: "test", 
        realOpenaiPublishEnabled: true 
      } as any;
      
      const result = await publishLocalKnowledgeToOpenAI(env, store, "owner");
      expect(result.success).toBe(false);
      expect(result.sanitized_error).toBe("Missing API Key");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
