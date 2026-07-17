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
  console.log("🚀 STARTING SPEC-030C SYNTHETIC TEST");
  console.log("=============================================\n");

  const tempZipPath = path.join(os.tmpdir(), `synthetic-wvr-${randomUUID()}.zip`);
  const zip = new AdmZip();
  
  const chatContent = `
12.05.2026 10:00 - User: numaram 05551234567
12.05.2026 10:01 - User: bos mesaj 1
12.05.2026 10:01 - User: bos mesaj 2
12.05.2026 10:01 - User: bos mesaj 3
12.05.2026 10:01 - User: kurulum ekranı bu
12.05.2026 10:01 - User: IMG-SETUP.jpg (file attached)
12.05.2026 10:01 - User: bos mesaj 4
12.05.2026 10:01 - User: bos mesaj 5
12.05.2026 10:01 - User: bos mesaj 6
12.05.2026 10:02 - User: para çekim ekranı bu
12.05.2026 10:02 - User: IMG-PAYMENT.png (file attached)
12.05.2026 10:02 - User: bos mesaj 7
12.05.2026 10:02 - User: bos mesaj 8
12.05.2026 10:02 - User: bos mesaj 9
12.05.2026 10:03 - User: profil fotom
12.05.2026 10:03 - User: IMG-PROFILE.jpeg (file attached)
12.05.2026 10:04 - User: video gonderiyorum
12.05.2026 10:04 - User: VID-001.mp4 (file attached)
12.05.2026 10:05 - User: 12345678901@g.us
12.05.2026 10:05 - User: PII.jpg (file attached)
  `.trim();

  zip.addFile("_chat.txt", Buffer.from(chatContent));
  zip.addFile("IMG-SETUP.jpg", Buffer.from(`fake image setup ${Date.now()}`));
  zip.addFile("IMG-PAYMENT.png", Buffer.from(`fake image payment ${Date.now()}`));
  zip.addFile("IMG-PROFILE.jpeg", Buffer.from(`fake image profile ${Date.now()}`));
  zip.addFile("VID-001.mp4", Buffer.from(`fake video ${Date.now()}`));
  zip.addFile("PII.jpg", Buffer.from(`fake image pii ${Date.now()}`));
  zip.writeZip(tempZipPath);

  console.log("[1] Zip created at", tempZipPath);

  console.log("[2] Importing Zip (Research Only)...");
  const importRes = await app.inject({
    method: 'POST',
    url: '/dashboard/actions/whatsapp-visual-research/import',
    headers: { 'x-dashboard-token': 'synthetic-owner' },
    payload: {
      source_label_safe: 'synthetic_run_1',
      mode: 'research_only',
      confirm: true,
      local_path: tempZipPath
    }
  });

  if (importRes.statusCode !== 200) {
    throw new Error(`Import failed: ${importRes.payload}`);
  }
  
  const importData = importRes.json();
  console.log("    Import Summary:", importData.summary);

  if (importData.summary.processed_images !== 4) throw new Error("Expected 4 processed images");
  if (importData.summary.skipped_media !== 1) throw new Error("Expected 1 skipped media (mp4)");
  if (importData.summary.setup_screen_count !== 1) throw new Error("Expected 1 setup screen");
  if (importData.summary.payment_screen_count !== 1) throw new Error("Expected 1 payment screen");
  if (importData.summary.sensitive_risk_count !== 1) throw new Error("Expected 1 sensitive risk");

  console.log("[3] Fetching Sanitized Findings...");
  const fetchRes = await app.inject({
    method: 'GET',
    url: '/dashboard/api/whatsapp-visual-research',
    headers: { 'x-dashboard-token': 'synthetic-owner' }
  });

  const fetchData = fetchRes.json();
  const items = fetchData.items;
  
  const setupItem = items.find((i: any) => i.visual_category === 'app_setup_screen');
  const piiItem = items.find((i: any) => i.file_name_safe === 'PII.jpg');

  console.log("    Setup item found:", setupItem.visual_ref);
  console.log("    PII item nearby context:", piiItem.nearby_context_sanitized);

  if (piiItem.nearby_context_sanitized.join(' ').includes('05551234567')) throw new Error("Phone number not redacted");
  if (piiItem.nearby_context_sanitized.join(' ').includes('12345678901@g.us')) throw new Error("JID not redacted");

  console.log("[4] Creating Draft Learning Suggestion...");
  const draftRes = await app.inject({
    method: 'POST',
    url: `/dashboard/actions/whatsapp-visual-research/${setupItem.visual_ref}/draft-learning`,
    headers: { 'x-dashboard-token': 'synthetic-owner' }
  });

  if (draftRes.statusCode !== 200) {
    throw new Error(`Draft learning failed: ${draftRes.payload}`);
  }
  console.log("    Draft Learning Suggestion created successfully.");

  console.log("\n✅ ALL SYNTHETIC SPEC-030C ASSERTIONS PASSED.");
  
  try { fs.unlinkSync(tempZipPath); } catch (_) {}
  await app.close();
}

runSynthetic().catch(err => {
  console.error("❌ SYNTHETIC TEST FAILED:", err);
  process.exit(1);
});
