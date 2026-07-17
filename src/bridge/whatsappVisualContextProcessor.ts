import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { WhatsAppVisualResearchItem, PersistentWhatsAppVisualResearchStore } from "../store/whatsappVisualResearchStore.js";

interface ProcessOptions {
  source_label_safe: string;
  store: PersistentWhatsAppVisualResearchStore;
}

export async function processWhatsAppZip(zipPath: string, options: ProcessOptions): Promise<void> {
  const batchRef = `BATCH-${randomUUID().substring(0, 8).toUpperCase()}`;
  const tempDir = path.join(os.tmpdir(), `wvr-extract-${randomUUID()}`);
  
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    // Safety check: max 5000 files, prevent zip bomb
    if (zipEntries.length > 5000) {
      throw new Error("Too many files in ZIP");
    }

    let visualItemsCreated = 0;
    let chatTxtContent = "";
    let chatTxtName = "";
    const mediaFiles = new Map<string, string>(); // filename -> safe temp path

    const isChatTxt = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.endsWith("_chat.txt") || lower === "chat.txt") return true;
      if (lower.startsWith("whatsapp chat") && lower.endsWith(".txt")) return true;
      if (lower.startsWith("whatsapp sohbeti") && lower.endsWith(".txt")) return true;
      return false;
    };

    let txtCount = 0;
    for (const entry of zipEntries) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith(".txt")) {
        txtCount++;
      }
    }

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      
      const fileName = entry.entryName;
      // Skip Mac OS meta files and hidden files
      if (fileName.includes("__MACOSX") || path.basename(fileName).startsWith(".")) {
        continue;
      }
      // Traversal protection
      if (fileName.includes("..") || path.isAbsolute(fileName)) {
        throw new Error(`Zip traversal attempt detected in filename: ${fileName}`);
      }
      
      // Fallback TXT detection
      if (isChatTxt(path.basename(fileName)) || (txtCount === 1 && fileName.toLowerCase().endsWith(".txt"))) {
        const rawBuffer = entry.getData();
        try {
          chatTxtContent = new TextDecoder("utf-8", { fatal: true }).decode(rawBuffer);
        } catch (e) {
          try {
             // Fallback to windows-1254 (Turkish) if UTF-8 fails
             chatTxtContent = new TextDecoder("windows-1254", { fatal: false }).decode(rawBuffer);
          } catch (e2) {
             chatTxtContent = rawBuffer.toString("utf8"); // last resort, safe replacement
          }
        }
        // Remove UTF-8 BOM if present
        if (chatTxtContent.charCodeAt(0) === 0xFEFF) {
          chatTxtContent = chatTxtContent.substring(1);
        }
        chatTxtName = fileName;
      } else {
        const basename = path.basename(fileName);
        const safeBase = basename.replace(/[\(\)\s]/g, "_").replace(/[^\w\.\-]/g, "");
        const destPath = path.join(tempDir, safeBase);
        zip.extractEntryTo(fileName, tempDir, false, true);
        mediaFiles.set(basename, destPath);
      }
    }

    if (!chatTxtContent) {
      throw new Error("No valid chat file found in zip");
    }

    // Media placeholders skip and format normalization
    let mediaPlaceholderCount = 0;
    let chatLines = chatTxtContent.split("\n");
    chatLines = chatLines.filter(line => {
      const lower = line.toLowerCase();
      if (lower.includes("<media omitted>") || lower.includes("görsel dahil edilmedi") || lower.includes("fotoğraf dahil edilmedi") || lower.includes("omitted")) {
        mediaPlaceholderCount++;
        return false;
      }
      return true;
    });
    const safeRegex = /[\+\d@\.\-\_a-zA-Z0-9]+/g;
    
    const visualItems: WhatsAppVisualResearchItem[] = [];
    
    for (const [filename, tempFilePath] of mediaFiles) {
      const ext = path.extname(filename).toLowerCase();
      
      const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
      const isHeic = ext === ".heic";
      const isVideoAudio = [".mp4", ".mov", ".mp3", ".opus", ".ogg", ".webm", ".gif"].includes(ext);
      
      const hash = createHash("sha256").update(fs.readFileSync(tempFilePath)).digest("hex");
      if (options.store.dedupExists(hash, options.source_label_safe)) {
        continue;
      }
      
      let skipReason = undefined;
      if (!isImage) {
        if (isVideoAudio) {
          skipReason = "audio_video_not_supported";
        } else if (isHeic) {
          skipReason = "heic_not_supported_yet";
        } else {
          skipReason = "unsupported_media";
        }
      }

      // Find nearby context in chat
      let linkedLines: string[] = [];
      for (let i = 0; i < chatLines.length; i++) {
        if (chatLines[i].includes(filename)) {
          const start = Math.max(0, i - 3);
          const end = Math.min(chatLines.length - 1, i + 3);
          for (let j = start; j <= end; j++) {
            // sanitize chat line (strip phone numbers, IDs)
            let sanitizedLine = chatLines[j].replace(/\b\d{10,14}\b/g, "[PHONE]");
            sanitizedLine = sanitizedLine.replace(/\b[A-Za-z0-9_-]+@[gc]\.us\b/g, "[JID]");
            linkedLines.push(sanitizedLine.trim());
          }
          break;
        }
      }

      // Classification (V1 heuristics)
      let visualCategory = "unknown";
      let confidence = 0;
      let riskFlags: string[] = [];

      const joinedContext = linkedLines.join(" ").toLowerCase();
      
      if (joinedContext.match(/\b(kurulum|uygulama|indirdim)\b/i)) {
        visualCategory = "app_setup_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(giriş|login|şifre|kayıt)\b/i)) {
        visualCategory = "login_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(ödeme|çekim|para)\b/i)) {
        visualCategory = "payment_withdrawal_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(bakiye|cüzdan|hesap|wallet)\b/i)) {
        visualCategory = "wallet_balance_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(hata|yapamadım|olmuyor|sorun)\b/i)) {
        visualCategory = "error_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(davet|kod)\b/i)) {
        visualCategory = "invite_code_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(doğrulama|onay|kimlik|verify)\b/i)) {
        visualCategory = "verification_screen";
        confidence = 60;
        riskFlags.push("sensitive_private_info");
      } else if (joinedContext.match(/\b(sohbet|mesaj|chat)\b/i)) {
        visualCategory = "chat_screen";
        confidence = 60;
      } else if (joinedContext.match(/\b(ana sayfa|dashboard|panel)\b/i)) {
        visualCategory = "dashboard_screen";
        confidence = 60;
      }
      
      if (joinedContext.match(/\b(profil)\b/i)) {
        visualCategory = "profile_photo_screen";
        riskFlags.push("sensitive_private_info");
      }
      
      if (joinedContext.match(/\b(ben|tatil|foto|fotoğraf|selfie)\b/i)) {
        if (visualCategory === "unknown" || visualCategory === "profile_photo_screen") {
          visualCategory = "unrelated_person_photo";
        }
        riskFlags.push("sensitive_private_info");
      }

      const safeFilename = filename.replace(/[\(\)\s]/g, "_").replace(/[^\w\.\-]/g, "");

      const item: WhatsAppVisualResearchItem = {
        visual_ref: `WVR-${randomUUID().substring(0, 6).toUpperCase()}`,
        import_batch_ref: batchRef,
        source_label_safe: options.source_label_safe,
        file_name_safe: safeFilename,
        image_hash: hash,
        image_type: ext,
        linked_message_refs: [],
        nearby_context_sanitized: linkedLines,
        visual_category: visualCategory,
        confidence,
        risk_flags: riskFlags,
        skip_reason: skipReason,
        research_summary_sanitized: `Heuristic match: ${visualCategory}`,
        created_at: new Date().toISOString(),
        mode: "visual_research"
      };
      
      console.log(`DEBUG: [${safeFilename}] -> ${visualCategory} | Context: ${joinedContext}`);
      
      visualItems.push(item);
    }

    const has_images = visualItems.length > 0;
    const has_chat_text = chatLines.length > 0;

    let mode: "visual_research" | "text_research_only" | "mixed_research" | "skip" = "skip";
    if (has_images && has_chat_text) {
      mode = "mixed_research";
    } else if (has_images && !has_chat_text) {
      mode = "visual_research";
    } else if (!has_images && has_chat_text) {
      mode = "text_research_only";
    }

    console.log(`[SPEC-030C] Zip ${options.source_label_safe} routed to mode: ${mode}`);

    if (mode === "visual_research" || mode === "mixed_research") {
      for (const item of visualItems) {
        item.mode = mode as "visual_research" | "mixed_research";
        options.store.createItem(item);
      }
    }

    if (mode === "text_research_only" || mode === "mixed_research") {
      let jargonCount = 0;
      let faqCount = 0;
      let objectionCount = 0;
      let setupCount = 0;
      let paymentCount = 0;
      let inviteCount = 0;
      let shortReplyCount = 0;
      let botLikeCount = 0;
      let sensitiveCount = 0;
      let ownerReviewCount = 0;

      const fullText = chatLines.join("\n").toLowerCase();
      
      chatLines.forEach(line => {
        const lower = line.toLowerCase();
        const words = lower.split(/[\s.,?!:;]+/).filter(Boolean);
        if (words.some(w => ["tmm","tm","tşk","ok","aynen","ayrıldım"].includes(w))) shortReplyCount++;
        if (words.some(w => ["nasıl","neden","niye","kim","kaç"].includes(w)) || lower.includes("ne zaman")) faqCount++;
        if (words.some(w => ["yalan","inanmıyorum","dolandırıcı","scam"].includes(w))) objectionCount++;
        if (words.some(w => ["kurulum","indir","uygulama","kayıt"].includes(w))) setupCount++;
        if (words.some(w => ["ödeme","çekim","para","bakiye","cüzdan"].includes(w))) paymentCount++;
        if (words.some(w => ["davet","kod","referans"].includes(w)) || lower.includes("davet kodu")) inviteCount++;
        if (words.some(w => ["layla","puan","coin","ajans","yayıncı"].includes(w))) jargonCount++;
        if (words.some(w => ["tc","iban","telefon","no","adres","kimlik"].includes(w))) sensitiveCount++;
        if (words.some(w => ["bot","otomatik"].includes(w)) || lower.includes("aynı mesaj") || lower.includes("sistem mesajı")) botLikeCount++;
      });
      
      if (faqCount > 0 || objectionCount > 0 || setupCount > 0) ownerReviewCount++;

      const hash = createHash("sha256").update(fullText).digest("hex");
      if (options.store.dedupExists(hash, options.source_label_safe)) {
        console.log(`[SPEC-030C] Zip ${options.source_label_safe} text content deduped.`);
        return;
      }
      
      const textItem: WhatsAppVisualResearchItem = {
        visual_ref: `WVR-${randomUUID().substring(0, 6).toUpperCase()}`,
        import_batch_ref: batchRef,
        source_label_safe: options.source_label_safe,
        file_name_safe: chatTxtName,
        image_hash: hash,
        image_type: "txt",
        linked_message_refs: [],
        nearby_context_sanitized: chatLines.slice(0, 50),
        visual_category: mode === "mixed_research" ? "mixed_text_research" : "text_research",
        confidence: 100,
        risk_flags: sensitiveCount > 0 ? ["sensitive_private_info"] : [],
        research_summary_sanitized: `Text research recovered from group format`,
        created_at: new Date().toISOString(),
        mode: mode as "text_research_only" | "mixed_research",
        message_count_sanitized: chatLines.length,
        media_placeholder_count: mediaPlaceholderCount,
        jargon_count: jargonCount,
        faq_count: faqCount,
        objection_count: objectionCount,
        setup_instruction_count: setupCount,
        payment_question_count: paymentCount,
        invite_code_mentions_count: inviteCount,
        short_reply_style_examples_count: shortReplyCount,
        bot_like_or_repetitive_reply_examples_count: botLikeCount,
        risky_or_sensitive_count: sensitiveCount,
        recommended_owner_review_count: ownerReviewCount
      };
      
      options.store.createItem(textItem);
    }

  } finally {
    // Cleanup temporary directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Failed to clean up temp dir:", tempDir, e);
    }
  }
}
