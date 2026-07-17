import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { processWhatsAppZip } from '../bridge/whatsappVisualContextProcessor.js';
import { FileWhatsAppVisualResearchStore, WhatsAppVisualResearchItem } from '../store/whatsappVisualResearchStore.js';

describe('whatsappVisualContextProcessor', () => {
  let storePath: string;
  let store: FileWhatsAppVisualResearchStore;
  let tempZipPath: string;

  beforeEach(() => {
    storePath = path.join(os.tmpdir(), `wvr-test-store-${Date.now()}.json`);
    if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    store = new FileWhatsAppVisualResearchStore(storePath);
    tempZipPath = path.join(os.tmpdir(), `test-wvr-${Date.now()}.zip`);
  });

  const createMockZip = (entries: {name: string, content: string | Buffer}[]) => {
    const zip = new AdmZip();
    for (const e of entries) {
      zip.addFile(e.name, typeof e.content === 'string' ? Buffer.from(e.content, 'utf8') : e.content);
    }
    zip.writeZip(tempZipPath);
    return tempZipPath;
  };

  it('should block zip traversal attempts', async () => {
    // If the zip content is completely invalid or has an evil name, AdmZip or our check will throw.
    // We expect it to throw *some* error when loading dummy/invalid zip or catching traversal.
    const mod = await import('../bridge/whatsappVisualContextProcessor.js');
    await expect(mod.processWhatsAppZip('dummy.zip', { source_label_safe: 'test_1', store }))
      .rejects.toThrow();
  });

  it('should throw if no _chat.txt is found', async () => {
    const zip = createMockZip([
      { name: 'image.jpg', content: 'fake image' }
    ]);
    
    await expect(processWhatsAppZip(zip, { source_label_safe: 'test_2', store }))
      .rejects.toThrow(/No valid chat file found in zip/);
  });

  it('should process images and skip unsupported media', async () => {
    const chatContent = `
12.05.2026 10:00 - User: Merhaba
12.05.2026 10:01 - User: kurulum yapamadım ekran bu:
12.05.2026 10:01 - User: IMG-20260512-WA0001.jpg (file attached)
12.05.2026 10:02 - User: boş satır 1
12.05.2026 10:02 - User: boş satır 2
12.05.2026 10:02 - User: boş satır 3
12.05.2026 10:02 - User: bir de video var
12.05.2026 10:02 - User: VID-20260512-WA0002.mp4 (file attached)
12.05.2026 10:03 - User: boş satır 4
12.05.2026 10:03 - User: boş satır 5
12.05.2026 10:03 - User: boş satır 6
12.05.2026 10:03 - User: benim profil resmim
12.05.2026 10:03 - User: photo.heic (file attached)
    `.trim();

    const zip = createMockZip([
      { name: '_chat.txt', content: chatContent },
      { name: 'IMG-20260512-WA0001.jpg', content: 'fake_image_data' },
      { name: 'VID-20260512-WA0002.mp4', content: 'fake_video_data' },
      { name: 'photo.heic', content: 'fake_heic_data' }
    ]);

    await processWhatsAppZip(zip, { source_label_safe: 'test_3', store });

    const items = store.listItems();
    expect(items.length).toBe(4);

    const jpg = items.find(i => i.file_name_safe === 'IMG-20260512-WA0001.jpg');
    expect(jpg).toBeDefined();
    expect(jpg?.skip_reason).toBeUndefined();
    expect(jpg?.visual_category).toBe('app_setup_screen'); // due to 'kurulum' in context
    expect(jpg?.nearby_context_sanitized.join(' ')).toContain('kurulum yapamadım');

    const mp4 = items.find(i => i.file_name_safe === 'VID-20260512-WA0002.mp4');
    expect(mp4).toBeDefined();
    expect(mp4?.skip_reason).toBe('audio_video_not_supported');

    const heic = items.find(i => i.file_name_safe === 'photo.heic');
    expect(heic).toBeDefined();
    expect(heic?.skip_reason).toBe('heic_not_supported_yet');
    expect(heic?.risk_flags).toContain('sensitive_private_info'); // due to 'profil' in context
  });

  it('should sanitize PII in context', async () => {
    const chatContent = `
12.05.2026 10:00 - User: numaram 05551234567
12.05.2026 10:01 - User: PII.jpg (file attached)
    `.trim();

    const zip = createMockZip([
      { name: '_chat.txt', content: chatContent },
      { name: 'PII.jpg', content: 'fake_image_data' }
    ]);

    await processWhatsAppZip(zip, { source_label_safe: 'test_4', store });

    const items = store.listItems();
    const item = items[0];
    
    expect(item.nearby_context_sanitized.join(' ')).toContain('[PHONE]');
    expect(item.nearby_context_sanitized.join(' ')).not.toContain('05551234567');
  });

  it('should dedup based on image hash and source label', async () => {
    const chatContent = `12.05.2026 10:00 - User: test.jpg (file attached)`;
    const zip = createMockZip([
      { name: '_chat.txt', content: chatContent },
      { name: 'test.jpg', content: 'same_content' }
    ]);

    await processWhatsAppZip(zip, { source_label_safe: 'test_5', store });
    await processWhatsAppZip(zip, { source_label_safe: 'test_5', store }); // duplicate import

    const items = store.listItems();
    expect(items.length).toBe(2); // deduped visual + 1 text
  });
});
