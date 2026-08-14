# Now OS — Kapsamlı Durum ve Devam Planı

Tarih: 21 Temmuz 2026 (guncelleme 25 Temmuz - bkz Bolum 0-P0)
Amaç: Bu sohbetin (Claude) limiti dolmadan/dolduktan sonra, Codex'in ve
gelecekteki herhangi bir Claude oturumunun projeyi kesintisiz devam
ettirebilmesi için tam durum özeti.

---

## Owner Onceligi - Bundan Sonraki Her Karar Bu Cercevede

Owner'in (Eray) uc onceligi: 1) Zeka - bot'un gercek bilgiye/kurala
gore cevap vermesi (kalip cevap degil), 2) Kapasite - 100+ eszamanli
sohbete dayaniklilik, 3) Sureklilik - hata aninda gercek insan devri.

Kritik gozlem: provider_unavailable'in sadece gercek yuk altinda
cikmasi = kapasite sorunu. Bot bu hatada gercek eyleme gecmeden
"ekibe yonlendirdim" demesi = sureklilik eksikligi. Grounding
eksikligi = zeka temeli. Ucu ayni kokten cikiyor.

Onaylanan sira:
1. provider_unavailable kok nedeni + dar duzeltme (su an bekleme
   asamasinda - diag_error_message logu bir sonraki gercek hatayi
   bekliyor)
2. Insan devri (human handoff) mekanizmasi - gercek bildirim/eskalasyon
3. V2 grounding fix (yapilandirilmis bilginin context'e yansimasi)
4. Faz 9 (queue/worker) + Faz 8 (Postgres) - gercek kapasite
5. Zeka/ogrenme katmani - saglam temel uzerine, EN SON

Bu sira owner onaylidir, degistirilmeden once acik onay gerekir.

---

## 1. Proje Nedir

WhatsApp üzerinden candidate/owner/manager mesajlarını işleyen bir
operasyon asistanı backend'i (Now Akademi için). Evolution API +
Fastify + PostgreSQL + OpenAI. Ana iş: OpenAI **Assistants API**'den
OpenAI **Responses API**'ye migrasyon — Assistants API 26 Ağustos 2026'da
sunset oluyor, zorunlu deadline bu.

## 2. Repo ve Erişim Bilgileri

- **GitHub (kanonik kaynak):** `https://github.com/veysi01720/NOW-OS.git`
- **VPS canonical path (eski, canlı, elle yönetilen):**
  `/root/deploy_package/now_os_backend`
- **VPS yeni git source (bugün oluşturuldu):**
  `/root/deploy_package/now_os_backend_src`
- **Eray PC local path:** `C:\Users\Hp\NOW-OS`
- **Compose override dosyası (build context'i yeni source'a, data/backups
  mount'larını eskiye bağlar):**
  `/root/deploy_package/docker-compose.now_os_backend_src.override.yml`
- **Owner dashboard token dosyası (VPS'te, sadece root okuyabilir):**
  `/root/deploy_package/now_os_backend_src/.dashboard_owner_token`
  (64 karakter, güvenli üretildi, mode 600)

## 3. Şu Anki Tam Durum (21 Temmuz 2026 itibarıyla)

- Kod: GitHub'da `510e0d8` (Package 12 final, ELIGIBLE_FOR_CANARY)
- VPS: Yeni provenance-mühürlü image deploy edildi, health/ready 200
- Container: `now_os_backend`, healthy, sadece bu servis recreate edildi
  (Evolution/DB'ye dokunulmadı)
- Owner approval: Tetiklendi, `approval_id=45c2fd00-3d4b-4208-b711-4380d1d633f6`,
  `expires_at=2026-07-21T15:20:12Z` — **muhtemelen süresi dolmuş olabilir,
  kontrol edilmeli, gerekirse yeniden tetiklenmeli**
- Canary durumu: Approval geçerliydi ama **hiç gerçek trafik almadı**
  (`reservations=[]`, `terminal_observation_count=0`) — kod yolu doğru,
  sadece uygun bir gerçek mesaj henüz gelmedi
- **Şu anki tek açık iş:** Gerçek bir WhatsApp mesajı (örn. "selam iş
  için yazdım") ile canary'nin gerçekten trafik alıp almadığını
  gözlemlemek

## 4. Bugün Çözülen Kritik Sorunlar (tekrar yaşanmasın diye kayıt)

1. **Git remote yoktu** → GitHub'a taşındı, `veysi01720/NOW-OS`, artık
   `git pull`/`push` ile senkronize olunuyor, zip taşımaya gerek yok.
2. **VPS'teki `/now_os_backend` klasörü hiç git repo değildi** → ayrı
   bir `_src` klasörüne clone edildi, canlı `data/`, `backups/`, `.env`
   klasörlerine hiç dokunulmadı, sadece volume mount ile bağlandı.
3. **`.env` içinde bozuk bir satır vardı** (satır 20, yanlışlıkla
   yapıştırılmış bir Windows dosya yolu, ~103KB) → tespit edilip
   temizlenmiş `.env` yeni source klasörüne kondu, orijinal değişmedi.
4. **`DASHBOARD_OWNER_TOKEN` hiçbir zaman gerçek bir env değişkeni
   olarak var olmamış** (görünen "owner123" bozuk satırın içinde geçen
   düz metindi, gerçek key değildi) → yeni, güvenli, 64 karakterlik
   token üretildi, `.env`'e eklendi.
5. **VPS host'ta Node/npm hiç kurulu değil** → build/test/provenance
   üretimi geçici bir `node:20-alpine` container ile, host'a hiçbir şey
   kurmadan yapıldı.
6. **Docker build provenance doğrulaması** (`SOURCE_TREE_HASH` vb.)
   `--build-arg` ile geçirilmeden `unknown` kalıp fail-closed durur —
   bu bilerek böyle tasarlanmış bir güvenlik mekanizması, bypass
   edilmemeli.

### 4.1 PostgreSQL bellek/OOM riski (22 Temmuz 2026)

- `nowakademi_db` container'inda `OOM_KILLED=true` goruldu; container ID
  ve `deploy_package_pgdata` volume'u korunuyordu, volume yeniden
  olusturulmus gorunmedi.
- Son 6 saatlik DB loglarinda birden fazla `database system was interrupted`
  ve `automatic recovery in progress` izi vardi. Bu, DB veri kaybi olarak
  yorumlanmadi; ancak bellek/host stabilitesi icin ayri P0/P1 altyapi riski
  olarak kayda alindi.
- Bu risk latency fix veya canary owner approval adiminda cozulmeyecek.
  Ayrica ele alinacak onerilen is: PostgreSQL/Evolution bellek kullanimini
  olcmek, DB memory limit/host swap durumunu incelemek, gerekiyorsa yalnizca
  ilgili servis icin kontrollu kaynak artirimi planlamak.

### 4.2 LID/canonical chat id durumu (22 Temmuz 2026)

- Evolution/Baileys 2.3.7 hattinda WhatsApp Business veya LID modunda
  private DM icin `remoteJid=@lid`, `remoteJidAlt=@s.whatsapp.net`,
  `addressingMode=lid` gelebiliyor. Group event'lerinde ise `remoteJid`
  `@g.us` kalirken `participant=@lid` ve `participantAlt=@s.whatsapp.net`
  gelebiliyor.
- Webhook idempotency key'i provider `message_id` uzerinden kuruldu; derin
  alias merge yapilmadi.
- Dar canonical chat id duzeltmesi: private DM'de `remoteJid=@lid` ve
  `remoteJidAlt=@s.whatsapp.net` geldiyse candidate state/conversation
  identity icin telefon JID alternatifi kullanilir. Raw `remote_jid` provider
  degeri olarak korunur; group `remoteJid=@g.us` mantigina dokunulmaz.
- Gecmis kayit migration'i bu paketin disindadir. Migration gerekip
  gerekmedigi, state key sayimi ve owner karariyla ayrica ele alinacak.

## 5. Mimari Özet (Codex'in her yeni oturumda bilmesi gereken)

- **Model-agnostik adapter katmanı** (`IModelAdapter`): OpenAI ailesi
  içinde model değiştirmek sadece env değişikliği; başka sağlayıcıya
  (Claude/Gemini) geçmek yeni adapter yazımı gerektirir.
- **V3 strict schema + bağımsız semantic validator**: model kendi
  kendini değerlendirmez (self-report'a güvenilmez), her karar backend'de
  ayrıca doğrulanır.
- **Deterministic backend normalizer**
  (`ConversationDecisionV3PolicyNormalizer.ts`): kesin/yapısal kararlar
  (escalate_missing_info gibi) prompt'a değil koda bağlanır.
- **Canary güvenlik mekanizması**: owner approval controller (kimlik
  doğrulamalı, tek kullanımlık), kalıcı 20-event izleme (restart'ta
  kaybolmaz), otomatik durdurma (`unsafe_claim_count>=1` → anında
  durur, approval invalidate olur), manual-flag-only fallback (Responses
  hata verirse Assistants'a SESSİZCE geçilmez).
- **Canary kapsamı**: SADECE `candidate` rolü + `private` kanal +
  (`greeting_or_first_contact` VEYA `candidate_first_contact`) intent'i
  + %10 trafik. Owner/manager/ödeme/approve-reject tamamen dışarıda.
- **Bilinen, kapsam dışı bırakılmış açık madde**: `p12_unknown_app_missing_info`
  senaryosu aralıklı başarısız oluyor ama canary'nin intent kapsamına
  hiç girmiyor (fail-closed selector ile kanıtlandı) — Package 14 adayı.

## 6. Kalan Adımlar — Kısa Vade Roadmap

1. **Package 13 owner approval/canary**: BEKLEMEDE. Package 14 ve Quality
   Pack 1 bitene kadar owner approval tetiklenmeyecek ve canary açılmayacak.
2. **Package 13.5 latency/P0 fast-path**: TAMAMLANDI. WORK_MODEL_ACCEPTANCE
   direct-question olmayan cevaplarda canlı gözlem 1.7-1.9s bandına indi.
3. **Package 13.6 canonical chat id / LID alias normalizasyonu**:
   TAMAMLANDI. Private DM'de `remoteJid=@lid` + `remoteJidAlt=@s.whatsapp.net`
   geldiğinde candidate state/conversation identity telefon JID alternatifiyle
   sabitlenir; group mantığına dokunulmaz. Full suite PASS ve P0 deploy gate
   PASS ile canlıya alındı.
4. **Package 14: `unknown_app_missing_info`**: TAMAMLANDI. Dar offline
   Responses/V3 golden replay scope'unda `unknown_app_policy_missing`
   davranışı deterministik escalation tuple'a bağlandı. Unknown app artık
   istisna değil; baseline 13/13, targeted 3/3 ve expanded 10/10 strict
   3-run combined regression gate içinde sıfır sapma/sıfır unsafe ile
   korunur. Canlıya, canary'ye ve owner approval'a dokunulmadı.
5. **Quality Pack 1: Real Candidate Conversation Quality**: Package 14
   sonrası SIRADA. İlk iş 10 golden test + deterministik/model ayrımı; bu
   bitmeden Package 13 canary yeniden açılmayacak.

### 6.4 Package 13 Resume — "Hazır mıyız?" değerlendirmesi (23 Temmuz 2026)

Bu bölüm sadece değerlendirmedir; canary AÇILMADI, owner approval TETİKLENMEDİ.

1. **Owner approval controller / 20-event persistence / auto-stop / scope —
   SAĞLAM.** `modelAdapterCanaryApprovalController.ts`, `modelAdapterCanaryControl.ts`,
   `modelAdapterCanaryStateStore.ts` kod incelemesi + hedefli test çalıştırması
   ile doğrulandı:
   - Scope hardcoded ve doğrulanıyor: `channel: "private"`, `sender_role: "candidate"`,
     intents sadece `greeting_or_first_contact` / `candidate_first_contact`
     ([modelAdapterCanaryApprovalController.ts:18](../../src/modelAdapter/modelAdapterCanaryApprovalController.ts#L18),
     :87-93, :122-136).
   - `maximum_observed_messages` tam olarak `20` olmak zorunda, aksi halde
     `MESSAGE_BUDGET_MUST_EQUAL_20` ile reddediliyor ([:134](../../src/modelAdapter/modelAdapterCanaryApprovalController.ts#L134)).
   - Persistence + otomatik durdurma: `terminal_window_target: 20`, reservation
     budget kontrolü, threshold-tetiklemeli `stop_latched` + approval
     invalidation, state store'a persist ([modelAdapterCanaryControl.ts:80-176](../../src/modelAdapter/modelAdapterCanaryControl.ts#L80-L176)).
   - Hedefli test çalıştırması: `modelAdapterCanaryApprovalEndpoint.test.ts`,
     `modelAdapterCanaryPersistence.test.ts`, `modelAdapterCanaryRuntimeStop.test.ts`,
     `package13CandidateCanary.test.ts` → **4 dosya, 15/15 test PASS**. Scope
     testleri (`channel:"private"`, `sender_role:"candidate"`, 20 mesaj budget,
     19 ile reddedilme) dosyada mevcut ve geçiyor.
2. **VPS'te çalışan commit: `7059928`** — bu oturumun başında owner tarafından
   manuel SSH ile doğrulandı (`git log -1`, `docker inspect --format='{{.Image}}'`
   image digest tam eşleşme, `healthz`/`readyz` HTTP 200). Bu turda VPS'e
   yeniden SSH erişimi olmadığı için bağımsız bir re-confirm yapılmadı; ama
   madde 3'teki bulgu bu boşluğu önemsiz kılıyor (aşağıya bakın).
3. **Bugün deploy edilmemiş ama commit'lenmiş kod: YOK.** `git diff --stat
   7059928..HEAD -- 'src/*' '*.ts' '*.js' package.json package-lock.json
   Dockerfile docker-compose*` **boş çıktı** verdi — yani `7059928`'den bu yana
   atılan tüm commit'ler (`7941d0c`, `cd65f6c`, `0f9291c`, `ad894e7`, `545ac80`)
   sadece dokümantasyon/handover dosyalarına dokunuyor, hiçbir uygulama
   kodu/build girdisi değişmedi. VPS'te 7059928 çalışıyor olması ile HEAD
   arasında davranışsal fark yok.
4. **Sonuç: Package 13 canary'yi bugün açmaya hazır mıyız? EVET (teknik/kod
   açısından blocker yok).**
   - Quality Pack 1'in üç bulgusu kapandı: grounding canlıda kanıtlandı, ton
     sınırı canlıda kanıtlandı, fallback rotasyon boşluğu teşhis edildi ve
     bilinçli olarak ertelendi (Seçenek A, bkz. 6.9).
   - Owner approval altyapısı (scope, 20-event budget, persistence, auto-stop)
     kod ve testte sağlam.
   - Deploy/commit driftı yok.
   - **Eksik olan tek şey**: yukarıdaki VPS commit doğrulaması bu oturumun
     BAŞINDAN kalma; canary'yi fiilen açmadan hemen önce owner'ın 10 saniyelik
     bir taze re-confirm (`git log -1` + `healthz`) yapması öneriliyor — bu bir
     blocker değil, sadece "tetiği çekmeden önce son bakış" temkinliliği.
   - Nihai açma/açmama kararı owner'a ait; bu sadece hazırlık değerlendirmesidir.

5. **Canary izleme uyarısı (23 Temmuz 2026, kod incelemesiyle kesinleştirildi):**
   connection-doctor canary durumu, sadece GERÇEK model çağrısı yapan
   mesajlardan sonra güncel kabul edilmeli - fast-path/deterministik
   cevaplardan sonraki kontrol taze olmayabilir. Kanıt:
   `ModelExecutionService.snapshot()` ([modelExecutionService.ts:394-398](../../src/modelAdapter/modelExecutionService.ts#L394-L398))
   `this.lastDecision`'ı döner, ve bu alan SADECE `executeCore()` çalıştığında
   güncellenir ([modelExecutionService.ts:244](../../src/modelAdapter/modelExecutionService.ts#L244)).
   `executeCore()` ise SADECE `ConversationDecisionEngine.ts`'teki
   `runModelDecision()` çağrıldığında tetiklenir
   ([ConversationDecisionEngine.ts:413](../../src/intelligence/conversation/ConversationDecisionEngine.ts#L413),
   fonksiyon tanımı :238, model çağrısı :290) — bu çağrı ise `if (!decision)`
   kapısının ARKASINDA ([ConversationDecisionEngine.ts:406](../../src/intelligence/conversation/ConversationDecisionEngine.ts#L406)),
   yani SADECE iki fast-path (`buildCandidateToneBoundaryDecision` :382,
   `buildWorkModelAcceptanceFastPathDecision` :393) da `null` dönerse
   çalışır. Bir mesaj ton-sınırı veya work-model-acceptance fast-path'ine
   düşerse `runModelDecision` hiç çağrılmaz, dolayısıyla
   `ModelExecutionService`'in tuttuğu `lastDecision` GÜNCELLENMEZ ve
   connection-doctor bir önceki gerçek-model-çağrılı mesajın kararını
   göstermeye devam eder. Detaylı teşhis:
   [outputs/quality/model_adapter_canary_route_disconnect_diagnosis_20260723.md](../../outputs/quality/model_adapter_canary_route_disconnect_diagnosis_20260723.md).

### 6.5 Quality Pack 1 - Ana Bulgu: V2 job-definition grounding gap

- Production `data/knowledge_bank/` altında `app_facts_structured.json` ve
  `app_routing_rules.md` hiç yok; canlıda sadece `app_facts.md` ve
  `approved_learning.*` dosyaları gözlendi.
- Teşhis: owner learning `knowledgeSync.ts` akışı çalışsa bile yalnızca
  `approved_learning.json` ve `approved_learning.md` üretir. `knowledgePublish.ts`
  de sadece mevcut `approved_learning.*` kaynağını publish etmeye çalışır;
  `app_facts_structured.json` veya `app_routing_rules.md` üretmez.
- V2 karar bağlamı structured dosya yokluğunda gerçek app facts ile
  ground edilmiyor; conversation decision tarafı statik/sparse
  `CandidatePolicyResolver` policy facts'e düşüyor. Son canlı job-definition
  örneğinde bot tekrar etmedi ama iş tanımını eksik/yanlış zeminde anlattı.
- Yarınki Quality Pack 1 planı: (a) publish/source akışını çalıştırıp resmi
  `app_facts_structured.json` ve `app_routing_rules.md` dosyalarını üret; (b)
  Package 11B'deki gibi V2 context builder'ın bu structured kaynakları nasıl
  kullanacağını önce DESIGN dokümanıyla bağla, sonra kodla ve golden testlerle
  kilitle.
- **Quality Pack 1 - İkinci Bulgu: Safety fallback tekrar guard'ı.**
  `deterministic_safety_response` ve `deterministic_transport_failure` kod
  yolu recent-reply parrot guard'dan geçmiyor. Rate-limit gibi geçici model
  hatalarında candidate'e art arda aynı "ekip kontrol etsin" mesajı gidebilir.
  Yarın: fallback seçim noktasına da aynı `%95` overlap guard'ını ekle; tekrar
  ederse intent-aware alternatif template seç.
- **Quality Pack 1 - Üçüncü Bulgu: Candidate ton/sınır yönetimi eksik.**
  Owner test senaryosunda candidate rolü simüle edilerek gönderilen saygısız/
  hakaret içeren mesajda bot güvenlik açısından kötüleşmedi ve bağlamsal kaldı;
  ancak sistemde bu tonu algılayıp nazik ama net bir sınır koyan deterministik
  cevap kategorisi yok. Her şey aynı genel fallback havuzuna düşüyor. Yarınki
  tasarımda genel fallback'ten ayrı bir "candidate_boundary_tone" davranışı
  değerlendirilmeli; Package 06/12'deki `guarantee_pressure` ve
  `payment_unverified` sınır mantığına benzer şekilde güvenli, kısa ve net bir
  cevap üretilmeli. Öncelik: job-definition grounding ve fallback guard'dan
  sonra.

### 6.6 Açık Risk: Owner Learning Queue birikimi ve duplicate adayları

- Owner canlı doğrulamasında false acknowledgement düzeltmesi ve
  `beklemedeki onerileri goster` komutu PASS oldu.
- Aynı doğrulamada 106 bekleyen öğrenme önerisi olduğu görüldü. İlk
  kayıtlardan bazıları birebir duplicate adayı gibi duruyor:
  `LRN-4/LRN-8`, `LRN-5/LRN-9`, `LRN-6/LRN-10`, `LRN-7/LRN-11`
  aynı içerik ve aynı zaman damgasıyla ikişer kez kaydedilmiş görünüyor.
- Bu bugün araştırılmadı; ayrı bir günde iki ayrı karar gerektiriyor:
  (1) duplicate'in gerçek bir dedupe bug'ı mı, yoksa tekrar işleme/eski
  birikim sonucu mu olduğunu teşhis et; (2) owner'ın 106 kaydı toplu
  inceleyip onaylayabileceği/reddedebileceği dashboard veya komut
  mekanizması kur. Şu an sadece listeleme var; aksiyon alma komutu yok.

### 6.7 Incident kapanis notu: PostgreSQL port maruziyeti ve container compromise

- 22 Temmuz 2026'da `nowakademi_db` 5432 portunun disariya acik oldugu ve
  DB container `/tmp` altinda supheli miner/tor artefact'leri bulundugu
  dogrulandi; forensic image ve pre-incident `pg_dumpall` kaniti korundu.
- Recovery kapsaminda 5432 compose port mapping'i kaldirildi, Postgres
  password ile dashboard owner/admin/manager token'lari rotate edildi, temiz
  DB container ayni pgdata volume ile recreate edildi, Evolution ve backend
  yeniden baslatildi; `/tmp` ve supheli process taramasi temiz, healthz/readyz
  200 ve Evolution `open` olarak dogrulandi.
- OpenAI service account key owner tarafindan rotate edildi; read-only
  `assistants.retrieve` 200 dondu ve canli owner komutu
  `beklemedeki onerileri goster` icin inbound/private normalize, owner command
  execution ve WhatsApp send confirmation PASS oldu. Owner approval/Package 13
  canary acilmadi.

### 6.8 Package 15 - Security Hardening (tamamlandi)

- Incident sonrasi kalici hardening uygulandi: Postgres public port mapping'i
  kapali kaldi; Evolution `8080`, backend `3000` ve cloaker `80/443`
  localhost-only yapildi. UFW deny-by-default aktif; public allow list sadece
  SSH `22/tcp`, Docker `DOCKER-USER` zinciri de external-to-Docker trafiği
  default deny olarak kalici systemd script'iyle kuruludur.
- `fail2ban` SSH jail aktif edildi. `now_os_backend`, `nowakademi_evolution`
  ve `nowakademi_db` privileged=false; uc serviste `no-new-privileges:true`
  aktif, DB ayrica `read_only:true` ve `/tmp` + `/var/run/postgresql` tmpfs
  ile calisir. Gunluk cron monitor'u beklenmeyen container, `/tmp` executable
  ve Postgres CPU anomalilerini `/var/log/now-os-security-hardening.log`
  dosyasina yazar.
- Secret hijyeni tamamlandi: live secret-bearing dosyalar ve backup/dump
  artefact'leri root-only izinlere cekildi; eski rotate secret degerleri live
  config, group/world-readable dosyalar ve son 24 saat Docker loglarinda
  bulunmadi. Son dogrulamada SSH erisimi devam ediyor, healthz/readyz 200,
  Evolution `open`, disaridan 5432/8080/3000/80/443 kapali.

### 6.9 Quality Pack 1 canlı doğrulama - fallback repeat-guard kapsam boşluğu (23 Temmuz 2026)

- Canlı testte "Garanti kazanç var mı, kesin ödeme alır mıyım?" sorusu aynı
  candidate konuşmasında art arda 3 kez soruldu. Beklenen 3 farklı rotasyon
  şablonu yerine 3 cevap neredeyse birebir aynı çıktı (küçük kelime
  farklarıyla).
- Kod incelemesiyle doğrulanan kök neden: `ConversationDecisionRepair.ts`
  içindeki `buildDeterministicSafetyDecision()` fonksiyonu `invalid_model_decision`
  nedeninde önce `asksPaymentOrGuarantee()`/`asksCameraAccountOrProfile()`/
  `ask_job_definition` özel dallarını kontrol ediyor ([ConversationDecisionRepair.ts:265-275](../../src/intelligence/conversation/ConversationDecisionRepair.ts#L265-L275));
  bu üç özel dal (`buildPaymentBoundarySafetyDecision`,
  `buildCameraAccountBoundarySafetyDecision`, `buildJobDefinitionSafetyDecision`)
  sabit/statik metin döndürüyor ve hiçbiri `selectRepeatSafeFallbackReply()`
  repeat-guard mekanizmasını çağırmıyor. Repeat-guard rotasyonu sadece bu üç
  dalın HİÇBİRİ eşleşmediğinde çalışan genel fallback dalında var
  ([ConversationDecisionRepair.ts:277-292](../../src/intelligence/conversation/ConversationDecisionRepair.ts#L277-L292)).
  Mevcut golden testler (`qualityPack1V2GoldenSkeleton.test.ts`) da sadece bu
  genel dalı tetikleyen mesajlarla yazılmış; payment/camera/job-definition
  özel dalları hiç repeat-guard testi görmedi.
- Ayrıca `final_reply_origin`/`mutation_source` trace alanları bu üç özel dal
  ile genel dalı log seviyesinde ayırt etmiyor - hepsi aynı
  `deterministic_safety_response` değerini taşıyor; fark sadece üretilen
  cevap metninde görülüyor.
- **Not:** Fallback repeat-guard kapsamı sadece deterministic_safety_response
  içindi, payment/guarantee boundary'ye henüz uygulanmadı - genişletme kararı
  bekliyor.
- **Karar:** A seçeneği - kapsam genişletilmeyecek, şimdilik kod değişikliği
  yok. Owner notu: eğer gerçek candidate'lerden bu üç kategoride "bot
  gibi/robotik" geri bildirimi gelirse, repeat-guard'ı bu dallara da
  genişletme kararı yeniden değerlendirilecek. Bu, aktif bir görev değil,
  gözlem tetikleyicili bir backlog maddesi.

## 7. Backlog — Now OS Stabil Olduktan Sonra Sırayla

Öncelik sırasına göre, hiçbiri şu an aktif değil:

**Güvenlik backlog notu:** `ownerApproval:true` structured knowledge
activation kodunda sabit ve gerçek owner kimlik doğrulamasına bağlı değil.
Kod veya dosya erişimi olan biri WhatsApp approval yolunu atlayarak bu
fonksiyonu çağırabilir. İleride gerçek bir approval token/imza mekanizması
eklenmeli. Bu not mevcut activation akışını bu oturumda değiştirmez.

1. **İkinci model sağlayıcısı** (Claude/Gemini gibi): yeni adapter +
   23 senaryo qualification + ayrı canary turu. Tahmini 3-5 iş günü
   (altyapı hazır olduğu için hızlı). Deadline'a dokunmadan yapılabilir.
2. **Zeka/öğrenme katmanı**: candidate geçmişinden örüntü çıkarıp owner'a
   öneri sunan, ONAYLANINCA deterministik kurala dönüşen sistem — modelin
   kendi kendine davranış değiştirmesi DEĞİL. Postgres migrasyonuyla
   (aşağıdaki Faz 8) birlikte, gerçek trafik birikince planlanmalı.
3. **Instagram/TikTok reklam karşılama**: aynı chatbot mantığının,
   sadece reklam karşılama rolünde diğer platformlara taşınması.
4. **Modern dashboard**: yukarıdakilerin hepsini görünür/yönetilebilir
   kılan arayüz — en son aşama.
5. **Deploy script'i**: `.env` + build + health + approval adımlarını tek
   komutta birleştiren script — güvenlik sınırını bozmadan (hâlâ owner'ın
   SSH ile elle tetiklemesi gerekir) sürtünmeyi azaltır.
6. **SaaS/genel pazar konumlandırması**: pazar araştırması kalabalık çıktı
   (Wati, Botpress, Gupshup, Respond.io zaten var) — ertelendi, Now
   bitince somut bir şeyle tekrar değerlendirilecek. Gerçek SaaS'a
   dönüşüm için eksik olanlar: (a) yapılandırılabilir state machine
   (şu an Now Akademi'ye özel elle yazılmış), (b) otomatik prompt/config
   üretimi (şu an aylarca elle ince ayar), (c) çoklu WhatsApp instance
   yönetimi, (d) gerçek multi-tenant veri izolasyonu.
7. **Ertelenen fazlar** (orijinal master plan'dan, henüz başlanmadı):
   - Faz 7: Trace'i sorgulanabilir hale getirme
   - Faz 8: JSON store (`data/now-os-store.json`) → Postgres
   - Faz 9: Queue/worker cutover (şu an `WORKERS_ENABLED=false`) — owner'ın
     talep ettiği 100+ eşzamanlı mesaj kapasitesi bu faza bağlı; şu an
     senkron işleme modeli bu ölçekte riskli.
8. **Gerçek insan devralması (escalation) eksikliği**: bot şu an ısrarcı/
   zorlu candidate, tekrarlayan hakaret veya çözülemeyen sorun gibi
   durumlarda sadece güvenli şablon cevap veriyor (bkz. `candidate_boundary_tone`
   fast-path, Quality Pack 1), ama owner/ekibe gerçek bir bildirim veya
   eskalasyon göndermiyor. Mevcut `human_handoff`/`request_human_handoff`
   action'ının (`ConversationDecisionV3Schema.ts`) kapsamı, bu durumları
   tespit edip gerçek bir insan bildirimi tetikleyecek şekilde
   genişletilmeli.

## 8. ZIP V2 Ek Backlog Notları

- Grup broadcast otomasyonu: Owner tarafından teslim edilen ZIP'te `@Herkes`
  grup mesajı otomasyonu talep edildi. WhatsApp politika ve spam riski
  nedeniyle ayrı tasarım ve owner onayı gerektirir; henüz aktive edilmeyecek.
- Görüntü işleme önceliği: Kurulum doğrulama ekran görüntüsü, owner'ın
  görüntü işleme önceliği için somut bir kullanım senaryosudur. Mevcut
  `stripMediaBase64` tasarımıyla çelişir; ayrı tasarım gerekir.
  `stripMediaBase64` bu kapsamda değiştirilmeyecek.

## 8. Devir Teslim Protokolü (Codex↔Codex, PC değişimi için)

Repo kökünde `HANDOVER_PROTOCOL.md` var. Özet kural:
- Aynı anda sadece BİR taraf (bir Codex/bir PC) commit atar.
- Kapanan taraf: `git status` temiz olmalı, son qualification/test
  sonucu commit edilmiş bir rapor olarak yazılmalı, `git log -1` tam
  hash'i paylaşılmalı.
- Devralan taraf: `git pull`, build+test tekrar çalıştırılır, sonuç
  önceki taraftakiyle karşılaştırılır, TUTARLIYSA devam edilir.
- Artık zip taşımaya gerek YOK, sadece git pull/push.

## 9. Güvenlik/Süreç Kuralları — Bunlar Hiç Değişmemeli

1. Codex, owner approval'ı KENDİSİ tetiklemez — bu her zaman Eray'ın
   elle çalıştırdığı bir curl komutudur.
2. Codex, production'a deploy/recreate yapmadan önce her zaman kanıt
   (build PASS, test PASS, provenance verify PASS, image label eşleşmesi)
   gösterir — "yaptım" değil "işte kanıt" formatı.
3. Sadece `now_os_backend` recreate edilir; Evolution, PostgreSQL asla
   restart edilmez (özel onay olmadıkça).
4. Secret/token değerleri hiçbir zaman sohbete, log'a veya rapora
   yazdırılmaz — sadece var/yok + uzunluk gibi metadata paylaşılır.
5. Bir iddia (örn. "X çalışıyor", "Y sorunu çözüldü") kanıtla
   desteklenmeden kabul edilmez — geçmişte birkaç kez "muhtemelen
   düzeldi" iddiası yanlış çıktı, hep koddan/testten doğrulanmalı.
6. Model-agnostik mimari korunmalı — hiçbir yerde hardcode model adı
   veya model-özel `if` dalı olmamalı, bu her paket sonunda `rg` ile
   tekrar doğrulanmalı.
7. Whack-a-mole'a girilmemeli — bir düzeltme sonrası HER ZAMAN önceki
   tüm test setleri (baseline+targeted+expanded) birlikte tekrar
   çalıştırılır, sadece hedeflenen senaryo değil.

## 10. Öğrenilen Genel Dersler (yöntem olarak)

- Her rapor "iddia" olarak değil "kanıt" olarak değerlendirildi — bu
  disiplin defalarca gerçek hataları (yanlış hash, eksik token, sahte
  build) yakaladı.
- "Regresyon" gibi görünen sonuçların bazen aslında "ölçümün sertleşmesi"
  olduğu ortaya çıktı (Package 12B'deki V3.1 kontrat sıkılaşması) —
  panik yapmadan önce her zaman izole edip kök nedeni bulmak gerekti.
- Altyapı sorunları (rate limit, DNS, credential) ile gerçek model
  kalite sorunları sık karıştı — ikisini ayırt etmeden karar vermek
  yanlış sonuçlara (model "yetersiz" gibi) götürebiliyordu.

---

## 0-P0. ACIL - SU AN AKTIF URETIM SORUNU (25 Temmuz 2026)

Candidate'ler bota gercek mesaj attiginda cevap alamiyor, ~14sn sonra
generic fallback aliyorlar.

Kok neden: openaiAssistantClient.ts -> runs.createAndPoll cagrisi
~13.6sn sonra provider_unavailable hatasi veriyor
(modelExecutionErrors.ts), deterministic_transport_failure fallback'ine
dusuyor.

Elenen ihtimaller (kanitli): ag/firewall degil (VPS->OpenAI 200,
<1sn), key gecersiz degil (ayni test), genel OpenAI kesintisi degil
(status.openai.com operational), rate limit/auth degil (farkli hata
kodu duserdi).

Kapsam: MODEL_ADAPTER_LAYER_ENABLED=false, BEHAVIOR_CANARY_MODE=off -
Responses API devrede degil, hata mevcut Assistants API yolunda.

Ne zamandir suruyor: BILINMIYOR. Container 13:05 UTC'de yeniden
olusturuldu, o andan sonraki HER gercek mesaj basarisiz oldu (13:15,
13:19, 13:24, 13:29 UTC). Daha eski log/veri bulunamadi.

Yarin ilk is bu olmali: runs.createAndPoll etrafina gecici ham hata
loglama ekle.

**Guncelleme (25 Temmuz, ayni gun devami) - 7 adimli teshis calismasi
tamamlandi, kok neden hala KESIN degil:**

- Sentetik izole tekrar uretim: `scripts/assistantsProviderProbe.ts` ile
  16/16 gercek OpenAI cagrisi BASARILI oldu (5 baseline + 1 uzun-thread
  [20 mesaj seed] + 5 eszamanli + 5 canli `now_os_backend` container'i
  icinden calistirma). Tum cagrilar gercek assistant_id, gercek
  truncation_strategy ve gercek conversation_decision_v2
  additional_instructions ile birebir uretim parametreleriyle yapildi.
  Sureler 6.4-10s araliginda, hicbir hata/timeout yok - raporlanan
  ~13.6-14.4sn basarisizlik penceresinin altinda.
- Zamanlama: Kodun kendi timeout mekanizmasi
  (`MODEL_EXECUTION_TIMEOUT_MS`, varsayilan 45000ms) bu yolda hic
  calismiyor - `runModelDecision()` `timeoutEnabled`/`timeoutMs` hic
  gecmiyor. **Hipotez (a) - kod-seviyeli yanlis yapilandirilmis
  timeout - kesin olarak elendi.**
- 16/16 basarili sentetik cagri, surekli/sistemik bir OpenAI-tarafi 5xx
  sorununu (**Hipotez b**) de guclu sekilde zayiflatiyor - eger bu
  organizasyon/assistant icin surekli bir sorun olsaydi, bu kadar
  cagridan en az birkacinin basarisiz olmasi beklenirdi.
- Sonuc: sorun byuk ihtimalle gercek candidate thread/trafigine ozgu bir
  durum (Hipotez c) - orn. onceki basarisiz bir run'dan kalan thread
  durumu, gercek serbest metin icin OpenAI moderasyon/guvenlik katmani,
  ya da OpenAI cagrisindan ONCE webhook pipeline'inda olusan bir gecikme/
  hata. Bunlar gercek candidate PII'ina dokunmadan test edilemedi.
- **Adim 1 (ham hata loglama) artik gercekten uygulandi**: commit
  `dabac5c` - `modelExecutionService.ts`'nin `executeCore()` catch
  blogunda, `MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED` bayragiyla
  (varsayilan kapali, `.env`'de yok - su an tamamen inert) sadece
  yapisal alanlari (HTTP status, hata sinifi/type/code) loglayan gecici
  bir mekanizma eklendi. Mesaj/prompt/candidate icerigi ASLA loglanmiyor.
  Full suite: 90/90 dosya, 619/619 test PASS (2 yeni test bu davranisi
  dogruluyor).
- **HENUZ DEPLOY EDILMEDI** - P0 gate disiplini geregi Eray'in ayri
  onayi bekleniyor. Onay gelirse: (1) bu kodu iceren image build+
  provenance, (2) sadece `now_os_backend` recreate, (3) `.env`'e
  `MODEL_EXECUTION_RAW_ERROR_DIAGNOSTICS_ENABLED=true` eklenmesi -
  boylece bir sonraki gercek basarisizlikta ham hata sekli (status/type/
  code) loglara dusecek ve dogru, dar bir duzeltme yazilabilecek.
  Onaysiz bir "duzeltme" yazmak bu asamada spekulatif olur.

### 6.10 Faz 9 dual_write aktivasyonu (25 Temmuz 2026)

Faz 0 + Faz 0.5 (shadow queue TTL/max-size eviction, media strip)
commit 642e425, GitHub'a push edildi, bagimsiz dogrulandi (90/90
dosya, 617/617 test PASS). VPS'te build+provenance damgalandi
(IMAGE_PROVENANCE_LABELED=YES, 4 hash dogrulandi). Gercek .env:
/root/deploy_package/now_os_backend_src/.env (digerleri
kullanilmiyor). Uc satir eklendi: WEBHOOK_QUEUE_MODE=dual_write,
OUTBOUND_QUEUE_MODE=off, WORKERS_ENABLED=false. Sadece now_os_backend
recreate edildi (13:05:05 UTC), healthz/readyz 200, connection-doctor
dogrulandi. 20dk gozlem: shadow_queue_stats.inbound.success_count 0->6,
failure_count/error_rate hep 0. Sonuc: dual_write basarili ve temiz.
Ayri, acil bir sorun kesfedildi - bkz Bolum 0-P0.

**UYARI: Once Bolum 0-P0 oku - aktif acil uretim sorunu var.**

**Bu dosyayı okuyan yeni bir Codex/Claude oturumu şunu yapmalı:**
1. Bölüm 3'teki "şu anki durum"u gerçek VPS/GitHub durumuyla karşılaştırıp
   doğrula (varsayma).
2. Bölüm 6'daki kısa vade adımlarına devam et.
3. Bölüm 9'daki güvenlik kurallarını hiç ihlal etme.
4. Bölüm 7'deki backlog'u, Owner (Eray) açıkça istemeden başlatma.

> **DİKKAT - Production env kaynağı:** `/root/deploy_package/now_os_backend/.env` gerçek production env dosyasıdır ve Compose `now_os_backend` servisini bu dosyadan başlatır. `/root/deploy_package/now_os_backend_src/.env` yalnızca canonical kaynak kod deposunun yerel/test ayarlarıdır. Production ayarı değiştirilecekse her zaman `now_os_backend/.env` düzenlenmelidir; source `.env` tek başına runtime ayarı değildir. İki dosyayı symlink ile birleştirmek secret kapsamı ve source/runtime ayrımı nedeniyle bu aşamada kullanılmamalıdır.

> **KRİTİK - Compose override env ayrışması:** `docker-compose.yml` temel dosyası `now_os_backend/.env` kullanırken production override `now_os_backend_src/.env` kullanıyor. Bu ayrışma dual_write, bozuk env satırı ve OpenAI API key olaylarında tekrar eden karışıklık riski oluşturdu. ÖNCELİKLİ TODO: iki env dosyası tek ve net bir production kaynağında birleştirilmeli veya override'ın hangi env dosyasını kullandığı tek bir standarda indirilmelidir; iki dosya değişiklik sonrasında hash ile senkron kontrol edilmelidir.

> **TEK GERCEK PRODUCTION ENV DOSYASI:** `/root/deploy_package/now_os_backend/.env` (`now_os_backend_src` DEGIL). Bundan sonra HICBIR ajan/oturum `now_os_backend_src/.env` dosyasi olusturmamali veya duzenlememelidir; bu dosya bilerek kaldirildi, 2026-07-29.

### MODEL_OUTPUT_CONTRACT_FAILURE_IN_WORK_MODEL_DISCLOSURE (2026-08-11)

WORK_MODEL_DISCLOSURE asamasinda modelin izinli action sozlesmesini ihlal
ettigi tespit edildi ve ayni gun dar bir repair kuraliyla duzeltildi. Yas,
cinsiyet ve gunluk sure biliniyorken modelin `explain_work_model` ve
`request_work_model_acceptance` action'larini uretmesi zorunlu hale getirildi;
tek repair denemesi de bu sozlesmeyi acikca belirtir. Repair basarisiz olursa
mevcut deterministic safety fallback korunur. Ayrintilar commit gecmisindedir.

### Vision provider decision (2026-08-11)

Vision saglayici karari: OpenAI (GPT-4.1) ile devam edilecek. Gercek maliyet
analizi aylik yaklasik $1.79 (asgari ucretin yaklasik %0.3'u) gosterdigi icin
Gemini'ye gecisin maliyet gerekcesi ortadan kalkmistir. Gemini yedek plan
olarak kalmaya devam ediyor.

### Gelecek hedef: Coklu WhatsApp Instance Destegi - Reklam Kampanyalari Icin

Farkli reklam kampanyalari icin ayri WhatsApp numaralari ve Evolution
instance'lari kullanilmasi hedeflenmektedir. Amac, WhatsApp spam/kisitlama
riskini dagitmak ve kampanya bazli candidate takibi yapmaktir. Mimari buna
uygundur: backend tek kalabilir, birden fazla Evolution instance'i
baglanabilir ve mesajin geldigi instance payload icinde izlenebilir. Bu hedef
Faz 9 (kapasite/worker) olgunlastiktan sonra ele alinacak; su an aktif degildir.

### GÃ¶rÃ¼ntÃ¼ Ä°ÅŸleme - Yedek Plan

OpenAI retention riski ileride sorun yaratÄ±rsa (mevzuat deÄŸiÅŸikliÄŸi, aday
ÅŸikÃ¢yeti veya owner kararÄ±nÄ±n deÄŸiÅŸmesi), veriyi Ã¼Ã§Ã¼ncÃ¼ bir saÄŸlayÄ±cÄ±ya
gÃ¶ndermeden kendi sunucumuzda iÅŸleyebilen self-hosted/open-weight gÃ¶rsel
anlama modelleri (Ã¶rn. Gemma gibi uygun aÃ§Ä±k aÄŸÄ±rlÄ±klÄ± modeller) veya
Tesseract gibi klasik OCR deÄŸerlendirilecektir. Maliyet, doÄŸruluk, RAM/GPU
ihtiyacÄ±, gecikme ve bakÄ±m yÃ¼kÃ¼ OpenAI planÄ±yla karÅŸÄ±laÅŸtÄ±rÄ±lacaktÄ±r.
Ã–ncelik dÃ¼ÅŸÃ¼ktÃ¼r; yalnÄ±zca OpenAI planÄ± retention nedeniyle kabul edilemez
hale gelirse devreye alÄ±nacak. Bu yedek plan henÃ¼z aktif deÄŸildir.
## Kalan Isler - 2026-08-12

### Acil (baglanti kurtarilinca hemen)

- Terra allowlist canli testi: kontrollu candidate ile Terra/Responses route'u, approval, final reply ve outbound kaydi birlikte dogrulanacak.
- Goruntu isleme canli testi: net ve belirsiz kurulum gorseli, state ilerlemesi, handoff ve ham gorsel sizintisi kontrolleriyle test edilecek.

### Kisa vade (reklam oncesi)

- Insan gibi yanit gecikmesi ve rate-limit davranisi gercek trafik uzerinde gozlemlenecek.
- Yeni WhatsApp numarasinin isinma sureci owner tarafindan manuel takip edilecek; yuksek hacimli test trafigiyle hizlandirilmayacak.

### Orta vade (gercek trafik birikince)

- Faz 9 worker aktivasyonu, gozlem pencereleri yeterli kanita ulastiktan sonra degerlendirilecek.
- Owner learning queue 105'ten 5'e dususunun nedeni **kesin olarak aciklanamadi**: runtime'da mevcut bes kayit, eski kopyalar ve analiz artefaktlari bulundu; ancak silme/arsiv/reset icin yetkili bir kayit bulunamadi. Mevcut bes kayit korunacak; konu bu kanitla kapali kabul edilecek.
- ownerSuccessClaimGuard legacy/V2 genel owner yanit yolunu da kapsayacak sekilde genisletilecek.

### Uzun vade (roadmap'te mevcut)

- PostgreSQL migrasyonu (Faz 8).
- Reklam kampanyalari icin coklu WhatsApp numarasi ve Evolution instance destegi.
- Owner/manager trafiginin Terra'ya kademeli tasinmasi.
- Resmi WhatsApp Business API'ye gecis degerlendirmesi.

### Izleme (staging, metrik paneli)

- Bilerek ertelendi; ihtiyac ortaya ciktiginda staging izolasyonu, metrikler ve alarm esikleri ayri tasarlanacak.

### WhatsApp baglanti kararsizligi - kok neden ve kural (2026-08-12)

- Kok neden: Evolution 2.3.7/Baileys pairing-notification `Invalid buffer` hatasi; upstream'de bilinen issue ile uyumlu. Bu hata 515 stream kapanmasi ve 401 logout dongusune yol acabiliyor.
- KURAL: Logout/pairing islemi GEREKMEDIKCE tekrarlanmayacak; tekrarli denemeler ayni bug'i tetikleyebilir.
- Kalici cozum secenekleri: (a) bug fix iceren bir Evolution surumune gecmeden once staging'de test etmek, (b) uzun vadede resmi WhatsApp Business API'ye gecisi degerlendirmek.

### Knowledge bank runtime senkronizasyon kurali (2026-08-14)

- TEK KAYNAK: `now_os_backend_src/data/knowledge_bank/app_facts.md` git ile izlenen kaynak dosyadir.
- `now_os_backend/data/knowledge_bank/app_facts.md` production runtime bind-mount verisidir; deploy bunu otomatik olarak git kaynak dosyasindan kopyalamaz.
- Knowledge bank degisikliginde deploy'dan once kaynak dosya, runtime dosyaya timestamp'li yedek alinarak acikca kopyalanir; hash ve Chatta/uygulama sayisi kontrol edilmeden publish tetiklenmez.
- Structured publish yalnizca bu eslenmis runtime dosyadan calistirilir. `app_fact_count`, manifest hash'i ve kritik icerik kontrolleri PASS olmadan `published` sonucu kabul edilmez.
