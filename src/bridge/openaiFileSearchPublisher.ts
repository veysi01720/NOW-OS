import { logger } from "../observability/logger.js";
import { resolve } from "node:path";
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { EnvConfig } from "../config/env.js";

export interface PublishResult {
  success: boolean;
  mode: "mock" | "real";
  real_openai_publish: boolean;
  message: string;
  openai_file_id_masked?: string;
  vector_store_id_masked?: string;
  assistant_id_masked?: string;
  sanitized_error?: string;
  _raw_openai_file_id?: string;
}

function maskOpenAIId(id: string): string {
  if (id.startsWith("file-")) return `file-***${id.substring(id.length - 4)}`;
  if (id.startsWith("vs_")) return `vs_***${id.substring(id.length - 4)}`;
  if (id.startsWith("asst_")) return `asst_***${id.substring(id.length - 4)}`;
  return `***${id.substring(id.length - 4)}`;
}

export async function attachFileToVectorStore(rawFileId: string, env: EnvConfig): Promise<PublishResult> {
  if (!env.realOpenaiPublishEnabled) {
    await new Promise(res => setTimeout(res, 100));
    return {
      success: true,
      mode: "mock",
      real_openai_publish: false,
      message: "Mock publish completed. Real OpenAI File Search was not updated.",
      openai_file_id_masked: maskOpenAIId(rawFileId),
      vector_store_id_masked: env.openaiVectorStoreId ? maskOpenAIId(env.openaiVectorStoreId) : "vs_***mock",
      _raw_openai_file_id: rawFileId
    };
  }

  try {
    if (!env.openaiVectorStoreId) {
      return { success: false, mode: "real", real_openai_publish: true, message: "Missing Vector Store ID", sanitized_error: "Vector Store ID missing in env." };
    }
    const fetchFn = (globalThis.fetch as any)?.isMock ? (globalThis.fetch as any) : undefined;
    const openai = new OpenAI({ apiKey: env.openaiApiKey, fetch: fetchFn });
    await openai.vectorStores.files.create(env.openaiVectorStoreId, { file_id: rawFileId });

    return {
      success: true,
      mode: "real",
      real_openai_publish: true,
      message: "File attached to vector store successfully.",
      openai_file_id_masked: maskOpenAIId(rawFileId),
      vector_store_id_masked: maskOpenAIId(env.openaiVectorStoreId),
      _raw_openai_file_id: rawFileId
    };
  } catch (err: any) {
    return { success: false, mode: "real", real_openai_publish: true, message: "Real attach failed.", sanitized_error: err.message || "Unknown OpenAI error" };
  }
}

export async function waitForVectorStoreFileCompleted(rawFileId: string, env: EnvConfig): Promise<PublishResult> {
  if (!env.realOpenaiPublishEnabled) {
    await new Promise(res => setTimeout(res, 100));
    return {
      success: true,
      mode: "mock",
      real_openai_publish: false,
      message: "Mock publish completed. Real OpenAI File Search was not updated.",
      openai_file_id_masked: maskOpenAIId(rawFileId),
      _raw_openai_file_id: rawFileId
    };
  }

  try {
    if (!env.openaiVectorStoreId) {
      return { success: false, mode: "real", real_openai_publish: true, message: "Missing Vector Store ID", sanitized_error: "Vector Store ID missing in env." };
    }
    const fetchFn = (globalThis.fetch as any)?.isMock ? (globalThis.fetch as any) : undefined;
    const openai = new OpenAI({ apiKey: env.openaiApiKey, fetch: fetchFn });
    const maxRetries = 30;
    let retries = 0;

    while (retries < maxRetries) {
      const status = await openai.vectorStores.files.retrieve(env.openaiVectorStoreId, rawFileId);
      if (status.status === "completed") {
        return {
          success: true,
          mode: "real",
          real_openai_publish: true,
          message: "Vector store file status completed.",
          openai_file_id_masked: maskOpenAIId(rawFileId),
          _raw_openai_file_id: rawFileId
        };
      }
      if (status.status === "failed" || status.status === "cancelled") {
        return { success: false, mode: "real", real_openai_publish: true, message: `Status is ${status.status}`, sanitized_error: `Vector store file error: ${status.last_error?.message || "unknown"}` };
      }
      await new Promise(res => setTimeout(res, 1000));
      retries++;
    }
    return { success: false, mode: "real", real_openai_publish: true, message: "Timeout waiting for vector store.", sanitized_error: "Timeout waiting for completed status" };
  } catch (err: any) {
    return { success: false, mode: "real", real_openai_publish: true, message: "Real status poll failed.", sanitized_error: err.message || "Unknown OpenAI error" };
  }
}

export async function uploadKnowledgeFile(targetPath: string, env: EnvConfig): Promise<PublishResult> {
  if (!env.realOpenaiPublishEnabled) {
    try {
      if (!existsSync(targetPath)) {
        return { success: false, mode: "mock", real_openai_publish: false, message: "Target file does not exist.", sanitized_error: "Target file not found." };
      }
      await new Promise(res => setTimeout(res, 100));
      return { success: true, mode: "mock", real_openai_publish: false, message: "Mock publish completed. Real OpenAI File Search was not updated.", openai_file_id_masked: "file-***mock" };
    } catch (err: unknown) {
      return { success: false, mode: "mock", real_openai_publish: false, message: "Mock upload failed.", sanitized_error: (err as Error).message || "Unknown mock error" };
    }
  }

  // Real Mode
  try {
    if (!existsSync(targetPath)) {
      return { success: false, mode: "real", real_openai_publish: true, message: "Target file does not exist.", sanitized_error: "Target file not found." };
    }
    const fetchFn = (globalThis.fetch as any)?.isMock ? (globalThis.fetch as any) : undefined;
    const openai = new OpenAI({ apiKey: env.openaiApiKey, fetch: fetchFn });
    const file = await openai.files.create({
      file: createReadStream(targetPath),
      purpose: "assistants",
    });

    return {
      success: true,
      mode: "real",
      real_openai_publish: true,
      message: "File uploaded successfully.",
      openai_file_id_masked: maskOpenAIId(file.id),
      _raw_openai_file_id: file.id
    };
  } catch (err: any) {
    return { success: false, mode: "real", real_openai_publish: true, message: "Real upload failed.", sanitized_error: err.message || "Unknown OpenAI error" };
  }
}
