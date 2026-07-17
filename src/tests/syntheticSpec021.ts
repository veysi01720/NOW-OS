import { logger } from "../utils/logger.js";
import { PersistentMaintenanceStore } from "../store/maintenanceStore.js";
import { handleOwnerCommand } from "../bridge/ownerCommands.js";
import { resolve } from "node:path";
import { rmSync } from "node:fs";

async function runTest() {
  console.log("=== SPEC-021 Synthetic Test ===");

  // 1. Logger Test
  console.log("\n[1] Testing Scrub Logger...");
  const fakeEnv = { openaiApiKey: "sk-proj-test12345" };
  process.env.OPENAI_API_KEY = fakeEnv.openaiApiKey;
  
  // Note: Since we use logger.info, we expect it to mask phone numbers and OpenAI IDs
  logger.info("Test phone 905393157701 and openai key " + process.env.OPENAI_API_KEY);
  logger.info("Test remote_jid 905393157701@s.whatsapp.net");
  logger.info("Test vs_6a4bae69ca688191a261c1d8b81df9a0");
  logger.info({ internal_boss_note: "secret note here", other: "safe value" });

  // 2. Maintenance Store Test
  console.log("\n[2] Testing Maintenance Store...");
  const maintPath = resolve("data", "test_maintenance.json");
  try { rmSync(maintPath, { force: true }); } catch (e) {}
  
  const maintStore = new PersistentMaintenanceStore(maintPath);
  console.log("Initial maintenance enabled:", maintStore.isEnabled());
  maintStore.setEnabled(true);
  console.log("Updated maintenance enabled:", maintStore.isEnabled());
  
  const maintStoreReload = new PersistentMaintenanceStore(maintPath);
  console.log("Reloaded maintenance enabled:", maintStoreReload.isEnabled());

  // 3. Owner Emergency Commands Test
  console.log("\n[3] Testing Owner Emergency Commands...");
  const mockMessage: any = {
    chat_type: "private",
    text: "güvenlik kontrolü yap",
    phone_number: "905393157701"
  };
  const mockEnv: any = { realOpenaiPublishEnabled: false };
  
  const result = handleOwnerCommand(mockMessage, "owner", mockEnv, undefined, undefined, maintStore);
  console.log("Is Command:", result.is_command);
  console.log("Reply:\n" + result.reply_text);

  console.log("\nTest Completed.");
}

runTest().catch(console.error);
