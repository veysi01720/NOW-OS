import { processWhatsAppZip } from "../bridge/whatsappVisualContextProcessor.js";
import { FileWhatsAppVisualResearchStore } from "../store/whatsappVisualResearchStore.js";
import * as fs from "node:fs";
import * as path from "node:path";
import AdmZip from "adm-zip";
import * as os from "node:os";

async function run() {
  const storePath = path.join(os.tmpdir(), "test_recovery_store.json");
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
  const store = new FileWhatsAppVisualResearchStore(storePath);

  // Create a synthetic zip with text only (No images) and emoji name
  const zipName = "WhatsApp Sohbeti - 🌙 Prensesler.zip";
  const zipPath = path.join(os.tmpdir(), zipName);
  const zip = new AdmZip();
  
  const textContent = `
[01.01.2026, 12:00] Admin: Arkadaşlar merhaba, bu grup bilgilendirme içindir.
[01.01.2026, 12:05] User1: Kurulum nasıl yapılıyor?
[01.01.2026, 12:06] Admin: Layla uygulamasını indirip kayıt oluyorsun.
[01.01.2026, 12:10] User2: <Media omitted>
[01.01.2026, 12:15] User3: Tmm
[01.01.2026, 12:20] User4: Ödeme ne zaman yatar?
[01.01.2026, 12:25] Admin: Çekim talepleri cuma günü yatar. İban atın.
  `.trim();
  
  // Use UTF-8 with BOM to test BOM removal
  const buffer = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(textContent, "utf8")
  ]);

  zip.addFile("WhatsApp Chat.txt", buffer);
  zip.writeZip(zipPath);

  await processWhatsAppZip(zipPath, { source_label_safe: "test_recovery", store });
  
  const items = store.listItems();
  console.log("Found items:", items.length);
  const textItem = items.find(i => i.mode === "text_research_only");
  
  if (!textItem) {
    console.error("FAIL: No text_research_only item found");
    process.exit(1);
  }

  console.log("Text Item Metrics:");
  console.log("- mode:", textItem.mode);
  console.log("- jargon_count:", textItem.jargon_count);
  console.log("- faq_count:", textItem.faq_count);
  console.log("- setup_count:", textItem.setup_instruction_count);
  console.log("- payment_count:", textItem.payment_question_count);
  console.log("- sensitive_count:", textItem.risky_or_sensitive_count);
  console.log("- short_reply_count:", textItem.short_reply_style_examples_count);
  console.log("- owner_review_count:", textItem.recommended_owner_review_count);

  if (textItem.jargon_count === 0 || textItem.setup_instruction_count === 0 || textItem.payment_question_count === 0 || textItem.risky_or_sensitive_count === 0) {
    console.error("FAIL: Metrics were not calculated correctly.");
    process.exit(1);
  }

  console.log("syntheticSpec030Recovery PASS");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
}

run().catch(e => {
  console.error("syntheticSpec030Recovery FAIL:", e);
  process.exit(1);
});
