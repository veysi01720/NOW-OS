# Now OS — Kapsamlı Durum ve Devam Planı

Tarih: 21 Temmuz 2026
Amaç: Bu sohbetin (Claude) limiti dolmadan/dolduktan sonra, Codex'in ve
gelecekteki herhangi bir Claude oturumunun projeyi kesintisiz devam
ettirebilmesi için tam durum özeti.

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

1. **Package 13 owner approval/canary**: BEKLEMEDE. Quality Pack 1 bitene
   kadar owner approval tetiklenmeyecek ve canary açılmayacak.
2. **Package 13.5 latency/P0 fast-path**: TAMAMLANDI. WORK_MODEL_ACCEPTANCE
   direct-question olmayan cevaplarda canlı gözlem 1.7-1.9s bandına indi.
3. **Package 13.6 canonical chat id / LID alias normalizasyonu**:
   TAMAMLANDI. Private DM'de `remoteJid=@lid` + `remoteJidAlt=@s.whatsapp.net`
   geldiğinde candidate state/conversation identity telefon JID alternatifiyle
   sabitlenir; group mantığına dokunulmaz. Full suite PASS ve P0 deploy gate
   PASS ile canlıya alındı.
4. **Quality Pack 1: Real Candidate Conversation Quality**: SIRADA. İlk iş
   10 golden test + deterministik/model ayrımı; bu bitmeden Package 13 canary
   yeniden açılmayacak.

## 7. Backlog — Now OS Stabil Olduktan Sonra Sırayla

Öncelik sırasına göre, hiçbiri şu an aktif değil:

1. **Package 14**: `p12_unknown_app_missing_info` — ayrı dar scope
   (`unknown_app_policy_missing` gibi) + ayrı replay gate + ayrı owner
   approval ile çözülecek. Tasarım yönü zaten Codex'ten alındı.
2. **İkinci model sağlayıcısı** (Claude/Gemini gibi): yeni adapter +
   23 senaryo qualification + ayrı canary turu. Tahmini 3-5 iş günü
   (altyapı hazır olduğu için hızlı). Deadline'a dokunmadan yapılabilir.
3. **Zeka/öğrenme katmanı**: candidate geçmişinden örüntü çıkarıp owner'a
   öneri sunan, ONAYLANINCA deterministik kurala dönüşen sistem — modelin
   kendi kendine davranış değiştirmesi DEĞİL. Postgres migrasyonuyla
   (aşağıdaki Faz 8) birlikte, gerçek trafik birikince planlanmalı.
4. **Instagram/TikTok reklam karşılama**: aynı chatbot mantığının,
   sadece reklam karşılama rolünde diğer platformlara taşınması.
5. **Modern dashboard**: yukarıdakilerin hepsini görünür/yönetilebilir
   kılan arayüz — en son aşama.
6. **Deploy script'i**: `.env` + build + health + approval adımlarını tek
   komutta birleştiren script — güvenlik sınırını bozmadan (hâlâ owner'ın
   SSH ile elle tetiklemesi gerekir) sürtünmeyi azaltır.
7. **SaaS/genel pazar konumlandırması**: pazar araştırması kalabalık çıktı
   (Wati, Botpress, Gupshup, Respond.io zaten var) — ertelendi, Now
   bitince somut bir şeyle tekrar değerlendirilecek. Gerçek SaaS'a
   dönüşüm için eksik olanlar: (a) yapılandırılabilir state machine
   (şu an Now Akademi'ye özel elle yazılmış), (b) otomatik prompt/config
   üretimi (şu an aylarca elle ince ayar), (c) çoklu WhatsApp instance
   yönetimi, (d) gerçek multi-tenant veri izolasyonu.
8. **Ertelenen fazlar** (orijinal master plan'dan, henüz başlanmadı):
   - Faz 7: Trace'i sorgulanabilir hale getirme
   - Faz 8: JSON store (`data/now-os-store.json`) → Postgres
   - Faz 9: Queue/worker cutover (şu an `WORKERS_ENABLED=false`)

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

**Bu dosyayı okuyan yeni bir Codex/Claude oturumu şunu yapmalı:**
1. Bölüm 3'teki "şu anki durum"u gerçek VPS/GitHub durumuyla karşılaştırıp
   doğrula (varsayma).
2. Bölüm 6'daki kısa vade adımlarına devam et.
3. Bölüm 9'daki güvenlik kurallarını hiç ihlal etme.
4. Bölüm 7'deki backlog'u, Owner (Eray) açıkça istemeden başlatma.
