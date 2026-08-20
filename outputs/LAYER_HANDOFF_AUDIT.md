# Katmanlar Arasi Karar Zinciri Denetimi

Tarih: 2026-08-20

## Sonuc

| Oncelik | Sinir | Sonuc | Kanit / duzeltme |
|---|---|---|---|
| P0 | Owner niyeti -> candidate outbound | Hata bulundu ve kapatildi | Tek bekleyen handoff varken her owner metni adaya gidiyordu. Artik yalnizca modelin `candidate_relay` karari outbound uretiyor; bilgi ve normal sohbet adaydan izole. |
| P1 | Owner relay karari -> outbound sonucu | Hata bulundu ve kapatildi | Evolution gonderimi basarisizsa basari cevabi uretilmiyor ve handoff cozulmuyor. |
| P1 | Gorsel owner bildirimi -> review store | Hata bulundu ve kapatildi | Tum owner outbound'lari basarisiz olsa da `owner_notification_sent=true` yaziliyordu. Store yalnizca gercek bir gonderimden sonra isaretleniyor. |
| P1 | Owner rollback -> source/structured/manifest | Hata bulundu ve kapatildi | Rollback hatasinda yalnizca Markdown korunuyordu. Structured JSON, manifest ve routing artefakti da birlikte geri yukleniyor. |
| PASS | Semantic/V3 validator -> StatePatchValidator | Alanlar korunuyor | V3 mapper `state_patch` ve `state_patch_evidence` alanlarini kayipsiz tasiyor. Candidate private/current-message evidence zorunlulugu sonraki validator'da yeniden dogrulaniyor. |
| PASS | Policy resolver -> context builder | Alanlar korunuyor | Resolver fact ID ve icerikleri `canonical_policy_facts` olarak backend context'e tasiyor; stage coverage testleri mevcut. |
| PASS | Context builder -> model prompt | Alanlar korunuyor | Adapter metadata `policyPromptTextPresent` ile tum canonical fact metinlerinin karar prompt'unda oldugunu olcuyor. |
| PASS | Model output -> response parser | Fail-closed | Responses cikisi strict V3 schema, semantic validator ve V3->backend mapper sirasindan geciyor; gecersiz cikti state/outbound'a gecmiyor. |
| PASS | Response parser -> outbound sender | Sonuc izleniyor | `sendReply` yalnizca sender basarisindan sonra success kaydi ve connection confirmation yaziyor; hata `reply_send_failed` oluyor. |
| PASS | Escalation -> human_handoff store | Dürust loglama | Store yok/yazma hatasi `HUMAN_HANDOFF_RECORD_FAILED`; `RECORDED` yalnizca gercek store islemi sonrasinda. |
| PASS | Owner gorsel karari -> state gecisi | Yetki ve bekleme korunuyor | Yalniz owner private karari, bekleyen review kaydi ve mevcut candidate state ile gecis yapiyor; onaysiz state ilerlemiyor. |
| PASS | Repair/retry -> audit/trace | Alanlar korunuyor | `repair_attempted`, model call count, katman reason code'lari ve mutation source ayni karar trace'inde kaydediliyor. |

## Dogal Owner Yolu

- `#` komut motoru ve ona ait erisilemez legacy kaynaklar kaldirildi.
- Owner mesaji model tarafindan bilgi ekleme, candidate relay, normal sohbet, teyit/red, rollback veya ZIP secimi olarak siniflandiriliyor.
- Net ve celiskisiz tek bolum ayni turda mevcut review store'a yaziliyor, onaylaniyor, atomik materialize ediliyor ve structured publish dogrulamasi gecmeden basari denmiyor.
- Belirsiz/celiskili bilgi pending kalir; serbest dogal teyit sonrasi ayni materialize yolu kullanilir.
- Cok bolumlu ZIP secimi bolum bazli kalir ve aktif bilgi owner secmeden degismez.
- Candidate rolu owner siniflandiricisini hicbir zaman cagiramaz.

## Kalan Risk

Owner niyet siniflandirmasi bir model cagrisidir. Provider veya schema hatasinda sistem fail-closed davranir, bilgi/mesaj degistirmez ve owner'dan daha acik tek cumle ister. Bu durumda normal owner sohbeti gecici olarak da islenmez; yanlis aksiyon almaktan daha guvenli kabul edilmistir.
