import AdmZip from "adm-zip";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

async function runSynthetic() {
  process.env.SPEC_SYNTHETIC_MODE = "true";
  process.env.NODE_ENV = "test";
  process.env.DASHBOARD_OWNER_TOKEN = "synthetic-owner";
  process.env.DASHBOARD_MANAGER_TOKEN = "synthetic-manager";

  if (fs.existsSync("data/whatsapp_visual_research.json")) {
    fs.unlinkSync("data/whatsapp_visual_research.json");
  }

  const { buildServer } = await import("../server.js");
  const { app, env } = await buildServer();
  await app.ready();

  console.log("\n=============================================");
  console.log("🚀 STARTING SPEC-030C MIXED RESEARCH TEST");
  console.log("=============================================\n");

  const tempZipPath = path.join(os.tmpdir(), `synthetic-mixed-${randomUUID()}.zip`);
  const zip = new AdmZip();
  
  const chatContent = `
12.05.2026 10:00 - User: selam nasıl yaparım kurulum
12.05.2026 10:01 - User: IMG-SETUP.jpg (file attached)
12.05.2026 10:01 - User: bakiye çekim
12.05.2026 10:02 - User: dolandırıcı bunlar inanmıyorum
12.05.2026 10:02 - User: davet kodu nedir
12.05.2026 10:03 - User: sistem mesajı bot otomatik
12.05.2026 10:04 - User: tc kimlik numaram 12345678901
  `.trim();

  zip.addFile("_chat.txt", Buffer.from(chatContent));
  zip.addFile("IMG-SETUP.jpg", Buffer.from(`fake image setup ${Date.now()}`));
  zip.writeZip(tempZipPath);

  console.log("[1] Zip created at", tempZipPath);

  console.log("[2] Importing Zip (Mixed Research)...");
  const importRes = await app.inject({
    method: 'POST',
    url: '/dashboard/actions/whatsapp-visual-research/import',
    headers: { 'x-dashboard-token': 'synthetic-owner' },
    payload: {
      source_label_safe: 'synthetic_mixed_1',
      mode: 'research_only',
      confirm: true,
      local_path: tempZipPath
    }
  });

  if (importRes.statusCode !== 200) {
    throw new Error(`Import failed: ${importRes.payload}`);
  }

  console.log("[3] Fetching Sanitized Findings...");
  const fetchRes = await app.inject({
    method: 'GET',
    url: '/dashboard/api/whatsapp-visual-research',
    headers: { 'x-dashboard-token': 'synthetic-owner' }
  });

  const fetchData = fetchRes.json();
  const items = fetchData.items;
  
  const setupItem = items.find((i: any) => i.visual_category === 'app_setup_screen');
  const textItem = items.find((i: any) => i.visual_category === 'mixed_text_research');

  if (!setupItem) throw new Error("Expected setup image item to be created");
  if (!textItem) throw new Error("Expected text research item to be created in mixed mode");

  if (setupItem.mode !== "mixed_research") throw new Error("Setup item mode is not mixed_research: " + setupItem.mode);
  if (textItem.mode !== "mixed_research") throw new Error("Text item mode is not mixed_research: " + textItem.mode);

  if (textItem.setup_instruction_count !== 1) throw new Error("Expected setup count 1, got " + textItem.setup_instruction_count);
  if (textItem.payment_question_count !== 1) throw new Error("Expected payment count 1, got " + textItem.payment_question_count);
  if (textItem.objection_count !== 1) throw new Error("Expected objection count 1, got " + textItem.objection_count);
  if (textItem.invite_code_mentions_count !== 1) throw new Error("Expected invite count 1, got " + textItem.invite_code_mentions_count);
  if (textItem.bot_like_or_repetitive_reply_examples_count !== 1) throw new Error("Expected bot count 1, got " + textItem.bot_like_or_repetitive_reply_examples_count);
  if (textItem.risky_or_sensitive_count !== 1) throw new Error("Expected sensitive count 1, got " + textItem.risky_or_sensitive_count);

  console.log("\n✅ ALL SYNTHETIC MIXED RESEARCH ASSERTIONS PASSED.");
  
  try { fs.unlinkSync(tempZipPath); } catch (_) {}
  await app.close();
}

runSynthetic().catch(err => {
  console.error("❌ SYNTHETIC TEST FAILED:", err);
  process.exit(1);
});
