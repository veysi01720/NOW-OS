# Claude Review: Latency Fix + AI Quality Strategy

Tarih: 21 Temmuz 2026
Cevap verilen: NOW_OS_SESSION_REPORT, CLAUDE_DECISION_BRIEF,
NOW_OS_AI_QUALITY_STRATEGY_FOR_CLAUDE

---

## Özet Karar

**PASS (latency fix stratejisi) — iki netleştirme şartıyla, deploy'dan önce.**
**Öncelik sırası: Quality Pack 1 önce, canary sonra — EVET, kalite fazı önce.**

P0 dedupe düzeltmesi (`71e775f`) örnek bir müdahale oldu: gerçek kanıt
zinciriyle teşhis edildi, dar kapsamlı düzeltildi, gate disipliniyle
deploy edildi, canlıda doğrulandı. Bu disiplin latency fix'te de aynen
korunmalı.

---

## 1. Latency Fix Review — PASS, iki şartla

Patch'i inceledim (`ConversationDecisionEngine.ts` diff'i). İki güçlü,
iki netleştirilmesi gereken nokta var.

### Güçlü yönler

- **Fast-path koşulu gerçekten dar**: 8 ayrı koşulun HEPSİ doğru olmalı
  (role, channel, dialogue_phase, intake_complete, acceptance state,
  allowed_actions, 3 policy fact, intent, VE direct-question regex'i
  negatif). Bu, "her candidate mesajını hızlandır" değil, tek bir dar
  senaryoyu hedefliyor — doğru tasarım.
- **`latestLooksLikeDirectQuestion` regex'i güvenli yönde hata yapıyor**:
  Türkçe soru edatları (mi/mu/mı/mü), "ne", "hesap", "kamera", "para",
  "ödeme" gibi çok yaygın kelimeler bile eşleşiyor — bu, fast-path'in
  gereğinden fazla ATLANMASI anlamına gelir (model'e düşer), gereğinden
  fazla TETİKLENMESİ değil. Hata payı doğru yönde.
- **`self_check` alanları hardcoded ama dürüst**: `invented_policy: false`,
  `asked_known_information_again: false` gibi alanlar gerçekten bu dar
  senaryoda garanti edilebilir durumda — modelin kendi kendini
  değerlendirmesine güvenmeme ilkesini bozmuyor çünkü bu zaten
  deterministik, doğrulanabilir bir cevap.

### Netleştirilmesi gereken iki nokta — deploy öncesi

**1. `conversationKey`'in türetilme şeklini göster.**

`conversationId=request_id` yerine `conversationId=conversationKey`
kullanımı doğru bir düzeltme (her mesaj için yeni thread açmak yerine
thread'i yeniden kullanmak) — AMA şunu kanıtla: `conversationKey`
gerçekten tenant+chat(JID) bazında **stabil ve benzersiz** mi? Özellikle:
- Aynı candidate'in private sohbeti ile (varsa) bir grup sohbeti FARKLI
  key üretiyor mu?
- İki farklı candidate'in key'leri asla çakışmıyor mu?

Bu doğrulanmadan deploy edilirse, teorik risk: bir candidate'in OpenAI
thread'i başka bir candidate'in mesaj geçmişini görebilir — bu, canlı
bir veri sızıntısı sınıfına girer, ciddiye alınmalı.

**İstenen kanıt:** `conversationKey`'in üretildiği kod satırı +
tenant/chatId/JID'den nasıl türetildiğini gösteren birim testi (mevcut
21 testin biri bunu kapsıyor mu, kapsamıyorsa eklensin).

**2. Deterministik cevabın onaylı app adını içermemesi — bu doğru,
değiştirme.**

Rapor bunu soru olarak sormuş ("approved app name mi, generic mi
kalsın"). Cevap: **generic kalsın.** Gerekçe: onaylı app değişebilir
(tenant/policy güncellenebilir), deterministik cevaba sabit bir app adı
gömmek, policy güncellendiğinde bu fast-path'i de güncellemeyi
gerektirir — bu tam olarak "kesin veriyi koda bağla ama tek noktadan
yönet" ilkesini ihlal eder. Şu anki generic ifade doğru.

### Deploy öncesi son şart

`conversationKey` doğrulaması + regresyon: aynı Package 12/13'te
kullandığımız disiplinle, deploy sonrası canlıda TEK bir fast-path
senaryosu (`WORK_MODEL_ACCEPTANCE` durumunda, direct-question OLMAYAN
bir mesaj) test edilip şu loglar doğrulanmalı:
- `CONVERSATION_DECISION_V2_FAST_PATH_SELECTED`
- `ASSISTANT_RUN_STARTED` YOK (aynı correlation_id için)
- `model_call_count=0`
- Gerçek gecikme ~1-2 saniyeye düşmüş

---

## 2. Stratejik Karar: Quality Pack 1 önce, Canary sonra — EVET

Gerekçe kısa: **Bugün aynı oturumda iki P0-sınıfı sorun bulundu** (dedupe
bug + 10.7 saniyelik gecikme) — ikisi de "temel sohbet akışı" katmanında,
Responses/V3'e hiç dokunmadan. Bu, iki şeyi kanıtlıyor:

1. Sistemin **temel/baseline** davranışı henüz tam stabil değil.
2. Bu durumda Responses/V3 canary'sini genişletmek, "acaba yeni model mi
   kötü, yoksa hâlâ keşfedilmemiş bir baseline hatası mı" sorusunu
   ayırt edilemez hale getirir — tam da Package 06'da yaşadığımız
   "gerçek model kalitesi mi, altyapı mı" karışıklığının bir
   tekrarı olur.

**Doğru sıra:** Önce baseline'ı (V2/Assistants) hızlı ve güvenilir hale
getir, gerçek konuşma hatalarını topla, golden test'lere çevir — SONRA
canary'yi bu güçlenmiş temel üzerine aç. Canary, "migrasyon güvenlik
turu" olarak kalmalı, "ürün kalite turu" olmamalı — rapordaki bu ayrım
(Bölüm 9, kendi önerisi) doğru, aynen benimsiyorum.

---

## 3. Sıradaki Paket: "Quality Pack 1: Real Candidate Conversation Quality"

Kapsam, önerilen Faz B-D'nin birleşimi:

1. 10-30 sanitize edilmiş gerçek kötü konuşma örneği topla, kategorize et.
2. Golden test setine çevir (`live-quality-regressions.json`).
3. Policy facts + deterministic cevapları güçlendir.
4. **Kapsam dışı bırak:** Responses/V3, canary, Package 14 — bunlar bu
   pakete karışmasın, ayrı kalsın.

---

## 4. İlk 10 Golden Test — Öncelik Sırasıyla

Rapordaki kategori listesinden, gerçek etki potansiyeline göre sıralı:

1. **Work model acceptance nudge** (bugün düzeltilen fast-path'in ta
   kendisi — regresyon testi olarak zaten şart)
2. **"İş tam olarak nedir?" direct question** — model path'te kalmalı,
   ama policy facts yeterliyse deterministik cevaba aday
3. **Ödeme/kazanç güvence sorusu** (`p6_payment_unverified`,
   `p6_guarantee_pressure` ile aynı aile — zaten V3 tarafında var,
   V2/Assistants tarafında da eşdeğeri olmalı)
4. **Kamera/hesap/profil sorusu** — sınır davranışı net değilse en çok
   "generic/yanlış cevap" riski taşıyan kategori
5. **Bilinmeyen app sorgusu** (`unknown_app_missing_info` ailesi —
   Package 14 ile ortak, burada da test edilmeli)
6. **Parçalı/kesik mesajlar** (candidate iki mesaja bölerek yazıyor) —
   state machine'in bunu doğru birleştirip birleştirmediği
7. **Tekrarlanan selam/greeting** (candidate zaten intake'te ama tekrar
   "selam" yazıyor) — bot'un state'i unutup sıfırdan başlamaması
8. **Zaten bilinen bilgiyi tekrar sorma** (`asked_known_information_again`
   — rapordaki kendi kategorisi, gerçek ve yaygın bir hata sınıfı)
9. **Argo/konuşma dili Türkçe varyantları** — direct-question regex'inin
   kaçırabileceği doğal dil kalıpları
10. **Eski state'ten kurtarma** (candidate günler sonra tekrar yazıyor,
    state hâlâ eski aşamada) — "stale state recovery"

---

## 5. Deterministik vs Model-Üretimi — Net Ayrım

**Deterministik olmalı** (kesin policy facts + dar state koşulları
varsa):
- Work model acceptance nudge (bugünkü fix)
- Eksik yaş/cinsiyet/günlük-saat bilgisi isteme
- "Ödeme detayları burada doğrulanmıyor" sınırı
- "Hesap/profil kuralı burada teyit edilmiyor" sınırı
- Bilinmeyen app için güvenli escalation (Package 14 ile birlikte)

**Model-üretimi kalmalı**:
- Belirsiz/argo/duygusal ton içeren mesajlar
- Yeni/beklenmeyen sorular (golden set'te karşılığı olmayan)
- Candidate'in direncini/tereddüdünü ele alma (empati gerektiren yanıtlar)
- Birden fazla niyeti aynı anda taşıyan karışık mesajlar

**Kural:** Bir cevap "policy facts + state'ten mekanik olarak türetilebiliyorsa"
deterministik olsun; "yorumlama/empati/esneklik gerektiriyorsa" model'e
bırakılsın.

---

## 6. Canary Öncesi Riskler — Not Edilsin

1. `conversationKey` doğrulanmadan deploy edilirse, thread-mixing riski
   (yukarıda detaylandı) — bu tek başına deploy'u bloklamalı.
2. Owner approval şu an geçersiz/süresi dolmuş — Quality Pack 1
   bitmeden yeniden açılmasın, kazara erken tetiklenmesin diye not
   düşülsün.
3. Fast-path'in canlıda gerçekten sadece hedeflenen dar senaryoda
   tetiklendiği (yanlışlıkla daha geniş bir kitleye yayılmadığı) ilk
   birkaç gerçek olayda doğrulanmalı, sadece testte değil.

---

## 7. Diğer Sorulara Kısa Cevaplar

- **V2 kalitesini mi önce iyileştirelim, yoksa V3 canary'yi mi
  önceleyelim?** V2 önce — şu an canlı trafiğin tamamı orada, gerçek
  candidate deneyimi orada şekilleniyor.
- **Mimari şu an "aşırı güvenlik ağırlıklı" mı?** Hayır, gevşetilmesin.
  Bugünkü iki P0 bulgusu bile (dedupe, latency) bu disiplin sayesinde
  hızlı teşhis edildi. Sorun güvenlik fazlalığı değil, kalite/bilgi
  katmanının eksikliği — bunlar farklı eksenler, biri diğerinin
  gevşetilmesini gerektirmez.
- **En küçük "bot'u gerçekten daha iyi hissettirecek" paket ne?**
  Bugünkü latency fix zaten bu sınıfta en yüksek etkili — 10.7
  saniyeden 1-2 saniyeye inmek, kullanıcının hissedeceği en büyük fark.
  İkincisi: golden test setinden çıkacak ilk 3-4 deterministik cevap
  (özellikle ödeme/kamera sınırları).

---

## Sonuç

1. Latency fix'i `conversationKey` kanıtı ile birlikte deploy et.
2. Owner approval'ı ve canary'yi Quality Pack 1 bitene kadar açma.
3. Quality Pack 1'i yukarıdaki 10 test + deterministik/model ayrımıyla
   başlat.
4. Package 13 canary, Quality Pack 1 sonrası, taze approval ile devam.
