# Faz 9 - Queue/Worker Cutover: Mevcut Durum Değerlendirmesi ve Aktivasyon Tasarımı

Date: 24 Temmuz 2026
Kapsam: Sadece analiz + tasarım. Kod yazılmadı, hiçbir flag/env değiştirilmedi,
deploy'a dokunulmadı.

## Yönetici Özeti

`src/reliability/` altındaki queue altyapısı **iskelet + kısmen bağlı** durumda,
"çalışır ama kapalı" değil. Üç ayrı, birbirinden bağımsız eksiklik var:

1. **Store hiç instantiate edilmiyor.** `server.ts` içinde
   `reliabilityQueueStore` diye bir şey hiç oluşturulmuyor/deps'e verilmiyor.
   `WEBHOOK_QUEUE_MODE=dual_write` veya `OUTBOUND_QUEUE_MODE=enqueue_shadow`
   bugün flip edilse bile, shadow-write fonksiyonları `if (!store) return;`
   guard'ına takılıp **sessizce hiçbir şey yapmaz** (hata bile vermez).
2. **Worker hiç instantiate edilmiyor.** `ReliabilityQueueWorker` sınıfı
   tanımlı ama repo'da `new ReliabilityQueueWorker(...)` diye bir çağrı YOK.
   `WORKERS_ENABLED` flag'i parse ediliyor ve connection-doctor'a raporlanıyor
   ama onu okuyup bir worker başlatan kod hiç yazılmamış - flag'in tüketicisi
   yok.
3. **Postgres store hiç yazılmamış.** `postgresQueueSchema.ts` sadece SQL DDL
   string'i + bir pickup query'si. `pg` paketi `package.json`'da bağımlılık
   olarak bile yok, gerçek bir `PostgresReliabilityQueueStore` sınıfı
   mevcut değil.

Yani mevcut kapalılık hem "bilinçli production-safe default" (queueModes.ts'te
açıkça böyle adlandırılmış) HEM DE "gerçekten eksik entegrasyon" - ikisi
birden doğru, birbirini dışlamıyor.

## 1) Dosya Dosya Durum

### `queueTypes.ts` - TAMAMLANMIŞ (sözleşme/interface)
Domain modeli net ve tutarlı: `ReliabilityQueueJob`, `EnqueueReliabilityJobInput`,
`ReliabilityQueueStore` interface'i. Test yok çünkü bu sadece tip tanımları -
test edilecek davranış içermiyor.

### `inMemoryReliabilityQueueStore.ts` - ÇALIŞIR DURUMDA, test edilmiş
[reliabilityQueue.test.ts](../../src/tests/reliabilityQueue.test.ts) ile 4
test PASS: enqueue+idempotency-dedup, claim (lease), markDone, max-attempts→
dead-letter. Conversation-bazlı seri işleme mantığı doğru
(`processingConversations` set'i, [inMemoryReliabilityQueueStore.ts:52-57](../../src/reliability/inMemoryReliabilityQueueStore.ts#L52-L57)).

**Ama bulunan gerçek bir eksik**: `claimNext(queueName, ...)` parametresi
[queueTypes.ts:48](../../src/reliability/queueTypes.ts#L48) imzasında var ama
implementasyonda **hiç kullanılmıyor** - `candidates` filtresi sadece
`status`/`available_at`'e bakıyor, `queueName`'i hiç süzmüyor
([inMemoryReliabilityQueueStore.ts:59-61](../../src/reliability/inMemoryReliabilityQueueStore.ts#L59-L61)).
Job objesi de `queue_name` alanını hiç saklamıyor (buna karşılık
[reliabilityQueue.test.ts:22](../../src/tests/reliabilityQueue.test.ts#L22)
bunu bilinçli olarak doğruluyor: `expect((job as any).queue_name).toBeUndefined()`).
Yani **tek bir store instance'ı inbound ve outbound'u ayıramaz** - tasarım,
her queue için AYRI bir store instance'ı varsayıyor gibi duruyor, ama bu hiçbir
yerde yazılı/garanti edilmiş değil. `counts().outbound_queue_pending` da her
zaman `0` dönüyor (hardcoded, [satır 132](../../src/reliability/inMemoryReliabilityQueueStore.ts#L132)) - outbound sayımı hiç implement edilmemiş.

### `queueWorker.ts` - İSKELET, muhtemelen kırık, sıfır test
Dosyanın en tepesinde `// @ts-nocheck` var - TypeScript kontrolü kapalı. Kod
`job.id` ve `job.attempts` kullanıyor ([queueWorker.ts:31](../../src/reliability/queueWorker.ts#L31),
:39-41), ama gerçek alan adları `job_id`/`attempt_count` ([queueTypes.ts:4-22](../../src/reliability/queueTypes.ts#L4-L22)).
`@ts-nocheck` olmasa bu dosya derlenmez. Hiçbir test dosyası bu sınıfı import
etmiyor - sıfır test coverage. **Şu an gerçek bir store ile çalıştırılsa
`job.id` her zaman `undefined` döner** (loglama ve `markFailed`'a geçirilen
`job_id` değeri bozuk çıkar).

### `shadowQueue.ts` - Wired ama eksik alan besleme bug'ı var
`enqueueInboundShadow`/`enqueueOutboundShadow` gerçekten çağrılıyor
([evolutionWebhook.ts:70](../../src/bridge/evolutionWebhook.ts#L70),
[handleIncomingMessage.ts:1317](../../src/bridge/handleIncomingMessage.ts#L1317)),
ve [evolutionWebhook.test.ts](../../src/tests/evolutionWebhook.test.ts) bunu
uçtan uca test ediyor (satır 408-527) - PASS. Ama bu testler sadece
`listJobs()).toHaveLength(1)` kontrol ediyor, alan DEĞERLERİNİ değil.
Gerçek bug: `store.enqueue({queue_name, idempotency_key, payload})` çağrısı
`tenant_id`, `conversation_key_hash`, `source_event_hash`, `event_type`
alanlarını HİÇ GEÇMİYOR ([shadowQueue.ts:29-33](../../src/reliability/shadowQueue.ts#L29-L33)) -
bunlar `EnqueueReliabilityJobInput`'ta ZORUNLU alanlar. `@ts-nocheck` bunu
gizliyor. Çalışma zamanında `conversation_key_hash` her job için `undefined`
olur - bu, store'un "aynı konuşmadan sadece bir job aynı anda işlensin" seri
işleme korumasını (`processingConversations.has(candidate.conversation_key_hash)`)
**tamamen anlamsız kılar**: `undefined === undefined` olduğu için TÜM job'lar
"aynı konuşma"ymış gibi davranır, tüm queue tek seferde sadece 1 job işleyebilir
hale gelir. Bu sadece shadow modda (gözlem amaçlı, gerçek işlemeye etkisi yok)
zararsız, ama gerçek `queue_only` moduna geçilirse ciddi bir throughput/doğruluk
bug'ı olur.

### `postgresQueueSchema.ts` - SADECE SQL DDL, implementasyon YOK
`RELIABILITY_QUEUE_SCHEMA_SQL` (CREATE TABLE'lar) ve bir `pickupSql()` query
builder'ı var - `FOR UPDATE SKIP LOCKED` ile doğru bir concurrent-safe pickup
deseni kullanılmış (iyi tasarım). Ama gerçek bir
`PostgresReliabilityQueueStore implements ReliabilityQueueStore` sınıfı **hiç
yazılmamış**. `package.json`'da `pg` paketi bağımlılık olarak **yok**. Şema da
`queue_name` kolonu içermiyor - `inMemoryReliabilityQueueStore`'daki aynı
"queue ayrımı yok" boşluğu burada da var.

### `queueMonitoring.ts` - Küçük, tamamlanmış, ama bağlanmamış
`queueBacklogSnapshot()`/`emitQueueInfraAlerts()` doğru ve basit; store'un
`counts()`'unu sarmalayıp eşik kontrolü yapıyor. Test yok ama mantık trivial.
Hiçbir yerde (server.ts, bir cron/interval) çağrılmıyor - bağlı değil.

### `publishSnapshot.ts` - Faz 9 kapsamı DIŞINDA
Bu dosya queue/worker ile ilgisiz - knowledge-publish rollback pointer hash'i
üretiyor (muhtemelen Package 11 civarından, klasör konumu yanıltıcı). Faz 9
değerlendirmesine dahil etmedim.

### Neden kapalı - eksik mi, bilinçli mi?
**İkisi de.** `queueModes.ts`'teki `productionSafeModeDefaults()` fonksiyonu
kapalı olmayı AÇIKÇA "safe default" olarak adlandırıyor - bu bilinçli bir
tasarım kararı. Ama flag'i açmanın "gerçek bir aktivasyon" anlamına geleceği
YANLIŞ bir varsayım: `reliabilityQueueStore` server.ts'de hiç yaratılmadığı
için flag açılsa bile hiçbir şey olmaz (worker tarafında) veya sessizce no-op
olur (shadow-write tarafında). Yani "kapalı" hem güvenlik hem de ham eksiklik
- ikisini ayırt etmek için bu değerlendirme gerekliydi.

## 2) Senkron Akış ile Queue'lu Akış Arasındaki Fark

**Şu an (senkron, `handleIncomingMessage.ts`):**
- Evolution webhook POST → `normalizeEvolutionMessage` → dedupe check
  (in-memory, TTL 10dk) → `handleIncomingMessage()` **HTTP request içinde,
  await ile, uçtan uca** → reply gönderilir → ancak O ZAMAN HTTP 200 döner.
- Aynı kullanıcının mesajları `UserRunLock` ile serialize edilir
  ([userRunLock.ts](../../src/queue/userRunLock.ts)) - ama bu **sadece
  tek process içinde geçerli bir in-memory promise-chain kilidi**, birden
  fazla backend instance'ı arasında koordinasyon sağlamaz.
- Dedupe de in-memory (`InMemoryMessageDedupeStore`, TTL 10dk) - process
  restart olursa bellek sıfırlanır.
- **Gecikme**: candidate, modelin/OpenAI'ın cevap üretmesini beklerken
  Evolution'ın webhook'u da o süre boyunca "pending" kalır (fast-ack yok -
  `FAST_ACK_ENABLED` flag'i de tıpkı `WORKERS_ENABLED` gibi hiç
  tüketilmiyor, sadece parse ediliyor).
- **Hata toleransı**: process crash/restart mesaj işleme SIRASINDA olursa,
  o mesaj kaybolur - hiçbir retry mekanizması yok (Evolution'ın kendi
  webhook retry'ına bağlı kalınır, bu backend'in kontrolünde değil).

**Queue devreye girince (tam `queue_only` modunda):**
- Webhook, mesajı DB'ye (Postgres, kalıcı) yazar yazmaz hemen 200 döner -
  candidate'e cevap gecikmesi artık worker'ın ne zaman job'u işleyeceğine
  bağlı (worker boştaysa neredeyse aynı, worker meşgulse/backlog varsa daha
  yavaş).
- Sıralama: `enqueue_sequence` + conversation-bazlı "aynı anda sadece 1 job"
  kısıtı ile korunuyor (queue tasarımı doğru, store implementasyonu bunu
  destekliyor - ama yukarıdaki `conversation_key_hash` bug'ı düzeltilmeden
  outbound tarafı bunu bozar).
- Hata toleransı GERÇEKTEN artar: process crash olursa job DB'de `LEASED`
  kalır, lease süresi dolunca (`reclaimStaleLocks`) `RETRY_WAIT`'e döner ve
  başka bir worker/restart sonrası tekrar denenir. **Ama şu an
  `reclaimStaleLocks` hiçbir yerde çağrılmıyor** - bu güvenlik ağı da
  bağlı değil; yazılsa bile aktive edilmemiş.
- Aynı mesajın iki kez işlenmesi riski AZALIR (Postgres `idempotency_key
  UNIQUE` constraint + `FOR UPDATE SKIP LOCKED`), çünkü mevcut in-memory
  dedupe restart'ta sıfırlanabiliyorken DB kalıcı.

## 3) Postgres Bağımlılığı - Faz 8 ile İlişkisi

`postgresQueueSchema.ts`'teki iki tablo (`reliability_jobs`, `outbound_ledger`)
uygulamanın ana JSON store'undan (`data/now-os-store.json`, Faz 8'in migrate
etmeyi planladığı şey) **tamamen bağımsız, kendi kendine yeten bir şema**.
Mimari olarak Faz 8'i beklemeden de yapılabilir.

Ama pratikte: `package.json`'da hiç `pg` bağımlılığı yok - bu proje şu an
Postgres'e HİÇ bağlanmıyor (production'daki `nowakademi_db` Evolution API'ye
ait, Now OS backend'in kendisi değil). Yani queue için Postgres'i devreye
almak, bu backend'in **ilk kez** bir Postgres client/connection pool kurması
anlamına gelir. Bunu Faz 8'den ayrı yapmak, aynı altyapıyı (driver, pool,
connection string yönetimi, health check) iki kez kurmak demek - bir kere
sadece queue için, bir kere de Faz 8'in geri kalanı için. Bu yüzden:

**Öneri**: Şema bağımsız olsa da, gerçek Postgres bağlantı kodu Faz 8 ile
BİRLİKTE (veya ondan hemen sonra, aynı `pg` altyapısını paylaşarak) yazılmalı.
Queue'yu Postgres'e taşımadan ÖNCE, in-memory store ile (tek process, tek
instance sınırlaması kabul edilerek) shadow/dual_write modları güvenle test
edilebilir - bu, Faz 8'i beklemeden başlanabilecek kısım.

## 4) En Büyük Risk Noktaları

1. **Store hiç yok → flag flip'i yanıltıcı sessizlik üretir.** Biri
   `WEBHOOK_QUEUE_MODE=dual_write` yapıp "artık queue'ya yazılıyor" sanabilir,
   ama `reliabilityQueueStore` server.ts'de yaratılmadığı sürece hiçbir şey
   yazılmaz, hata da vermez. İlk yapılması gereken: store'u gerçekten
   instantiate edip deps'e vermek.
2. **`conversation_key_hash` eksik alan bug'ı** (yukarıda detaylandırıldı) -
   `queue_only`'ye geçilirse tüm queue tek-thread'e düşer.
3. **`reclaimStaleLocks` hiç çağrılmıyor** - worker crash olursa job'lar
   sonsuza kadar `LEASED` kalır, "otomatik kurtarma" var sanılır ama aktif
   değil.
4. **`ReliabilityQueueWorker` hiç instantiate edilmiyor, `job.id`/`job.attempts`
   alan adı bug'ı içeriyor** (`@ts-nocheck` ile gizli) - worker'ı bugünden
   yarına "aç" demek mümkün değil, önce bu dosyanın gerçek alan adlarıyla
   yeniden yazılması/test edilmesi gerekiyor.
5. **`queue_name` hiçbir yerde (ne in-memory store'da ne Postgres şemasında)
   gerçekten süzülmüyor/saklanmıyor** - inbound/outbound karışma riski, aynı
   store instance iki queue için paylaşılırsa.
6. **Tek process varsayımı**: `UserRunLock` ve `InMemoryMessageDedupeStore`
   process-local. Queue'nun asıl faydası (100+ eşzamanlı, çoklu worker/instance)
   ancak Postgres-backed store + gerçek çoklu worker ile gerçekleşir; bu ikisi
   olmadan queue'yu "açmak" sadece ekstra bir yazma-okuma katmanı ekler,
   gerçek paralellik/ölçek kazanımı sağlamaz.
7. **`FAST_ACK_ENABLED`/`WORKERS_ENABLED` sıfır tüketici** - bu flag'leri
   açmak bugün LİTERALLİ hiçbir şeyi değiştirmez; false confidence riski
   (birisi "worker'ı açtım" diye düşünüp aslında hiçbir worker çalışmıyor
   olabilir).

## 5) Güvenli Aktivasyon Sırası (Tasarım)

Canary'de izlenen "dar kapsam + gözlem + kademeli genişletme" disipliniyle
aynı mantık:

**Adım 0 (ön koşul, kod):** Yukarıdaki bug'ları düzelt - `shadowQueue.ts`'e
gerçek `tenant_id`/`conversation_key_hash`/`source_event_hash`/`event_type`
besleme, `queueWorker.ts`'teki `job.id`→`job_id` alan adı düzeltmesi,
`@ts-nocheck`'lerin kaldırılması, `inMemoryReliabilityQueueStore`'a gerçek
`queue_name` filtrelemesi eklenmesi. Bunlar olmadan hiçbir adım güvenli değil.

**Adım 1 (gözlem, sıfır davranış değişikliği):** `WEBHOOK_QUEUE_MODE=dual_write`
+ gerçek `InMemoryReliabilityQueueStore` instance'ı server.ts'de yaratılıp
deps'e verilsin. Sadece inbound shadow-write. Senkron akış hiç değişmez
(hâlâ `handleIncomingMessage` inline çalışır). Amaç: queue'ya yazmanın kendisi
hatasız mı, backlog/latency metrikleri normal mi, gözlemle.

**Adım 2 (gözlem, outbound):** `OUTBOUND_QUEUE_MODE=enqueue_shadow` eklensin.
Gerçek gönderim hâlâ eski yoldan (`sender.sendText`), sadece paralel bir
shadow-write. Adım 1 ile aynı gözlem mantığı, outbound tarafı için.

**Adım 3 (worker'ı gölgede çalıştır, gerçek trafiğe dokunmadan):**
`processInboundJobDryRun`/`processOutboundJobDryRun` (zaten
[queueWorker.ts:87-99](../../src/reliability/queueWorker.ts#L87-L99)'da
mevcut, iyi bir başlangıç noktası) kullanan bir worker instance'ı gerçekten
başlat - ama gerçek `handler`/`sender` yerine dry-run fonksiyonlarını çağırsın.
Bu, "worker gerçekten job claim edebiliyor mu, lease/backoff/dead-letter
mantığı canlı trafikte doğru çalışıyor mu" sorusunu, hiçbir candidate'e
etkisi olmadan cevaplar.

**Adım 4 (Postgres'e geçiş, Faz 8 ile birlikte):** In-memory store'dan
Postgres-backed store'a geç (Adım 0-3 tek process/tek instance'la
doğrulandıktan sonra). `reclaimStaleLocks`'u gerçekten bir interval'a bağla.
Bu noktadan sonra çoklu worker/instance denenebilir.

**Adım 5 (gerçek cutover, tek queue, dar trafik):** `WEBHOOK_QUEUE_MODE=queue_only`
+ gerçek worker (dry-run değil, gerçek `handleIncomingMessage`/`sender.sendText`
çağıran handler) - önce SADECE inbound, outbound hâlâ senkron/eski yolda kalsın.
Owner onayı + geri dönüş planı (flag'i `off`'a çevirmek) hazır olsun.

**Adım 6 (outbound cutover):** Inbound stabil çalıştıktan sonra
`OUTBOUND_QUEUE_MODE=queue_only`.

Her adımda: önceki adım en az birkaç gün sorunsuz çalışmadan bir sonrakine
geçilmemeli - tıpkı Package 13 canary'de "20 mesajlık gözlem penceresi,
otomatik durdurma" disipliniyle yapıldığı gibi.
