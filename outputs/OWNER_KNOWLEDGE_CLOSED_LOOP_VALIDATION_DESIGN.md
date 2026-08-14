# Owner Knowledge Closed-Loop Validation Design

## Amaç

`#uygula` veya tek bölümlü `#bilgi` onayı sonrasında yalnızca dosya ve
manifest yazımını değil, yeni bilginin gerçek candidate cevabında
kullanılabildiğini doğrulamak. Doğrulama tamamlanmadan owner'a "başarılı",
"aktif" veya eşdeğer kesinlikte bir sonuç gönderilmez.

## Bağlanma noktası

Akış, mevcut owner knowledge materialization ve
`publishStructuredKnowledgeSources(mode: "activate")` zincirinin hemen
sonrasında, mevcut aktivasyon audit sonucu kalıcı olarak yazılmadan önce
çalışır:

1. Bölüm bazlı onay ve atomik `app_facts.md` materialization tamamlanır.
2. Structured publish, JSON ve manifest/hash kapılarıyla çalışır.
3. Closed-loop validator, aynı publish snapshot'ı üzerinden sentetik bir
   candidate context'i oluşturur.
4. No-outbound gerçek model çağrısı yapılır; candidate'e WhatsApp cevabı,
   state değişikliği veya dış yan etki üretilmez.
5. Sonuç kalıcı audit'e yazılır; yalnız tüm kapılar geçerse aktivasyon
   başarı olarak raporlanır.

Bu kontrol `buildBackendContext` veya normal inbound handler içine yan
etkili bir işlem olarak konmaz. Normal candidate trafiği bu doğrulama
nedeniyle bekletilmez.

## Soru üretimi

Soru, owner bölümünün sınıflandırmasından ve normalize edilmiş içerik
anahtarlarından deterministik olarak üretilir. Soru metni aday verisi veya
PII içermez.

- Profil/hesap kuralı: `Erkek aday hesap ve profil konusunda hangi kuralı
  bilmeli?`
- Kurulum/destek: `Kurulumda sorun yaşanırsa izlenecek adım nedir?`
- Ödeme: `Ödeme ve çekim süreci hakkında hangi bilgi verilebilir?`
- Uygulama yönlendirme: `Adaya uygulama seçenekleri nasıl anlatılmalı?`
- Genel bilgi: `Bu iş modeli kısaca nasıl açıklanmalı?`

Bölüm birden fazla konu içeriyorsa soru, ilgili bölüm başlığından ve
normalize edilmiş ilk konu etiketinden türetilir. Yeterli konu çıkarılamazsa
validator `question_generation_failed` döner; içerik kullanılmadan başarı
raporu verilmez.

## Model çağrısı

Çağrı, mevcut Responses/Terra adapter'ının qualification/no-outbound
modunu kullanır. Normal konuşma bütçesinden ayrıdır:

- `store=false`
- outbound gönderim yok
- candidate state write yok
- completion üst sınırı 256 token
- mevcut context budget sınırları korunur
- prompt içine yalnızca doğrulanmış structured snapshot, hedef intent,
  üretilen soru ve cevap sözleşmesi konur

Modelden yalnız sanitize edilmiş cevap ve doğrulama metadata'sı alınır.
Ham owner metni veya ham görsel bu raporlama akışına taşınmaz.

## Sonuç doğrulama

Kontrol iki ayrı seviyede yapılır:

### Zincir kanıtı

Sistem şu sırayla kanıt toplar ve ilk başarısız halkada durur:

1. `source_present`: onaylanan içerik hedef `app_facts.md` snapshot'ında
   bulunuyor mu?
2. `structured_present`: içerik structured JSON'da bulunuyor mu?
3. `structured_field`: içerik hangi alan/bölümde bulundu?
4. `resolver_present`: ilgili policy fact resolver çıktısında var mı?
5. `prompt_present`: fact, no-outbound model prompt'una girmiş mi?
6. `answer_used`: model cevabı, bilginin anlamını gerçekten yansıtıyor mu?

Her adım `status`, `evidence_ref` ve sanitize edilmiş kısa bir özet
üretir. Hash'ler maskeli tutulur; candidate/owner metni loglanmaz.

### Cevapta kullanım ölçümü

Sadece kelime eşleşmesi kullanılmaz. Cevap, bölümün normalize edilmiş
iddia atomlarıyla karşılaştırılır:

- zorunlu varlıklar ve alanlar (ör. kadın profil, kadın fotoğrafı),
- kısıt/izin yönü (zorunlu, yasak, koşula bağlı),
- sayı, süre ve kesinlik ifadeleri,
- çelişki ve ters anlam sinyalleri.

Eş anlamlı veya doğal Türkçe ifadeler, kontrollü bir claim-normalizer ile
aynı anlama indirgenebilir. Ancak güvenlik açısından eksik/ters yönlü bir
ifade `answer_used=false` sayılır. Model cevabı güvenilir biçimde
değerlendirilemiyorsa fail-closed davranılır; tahmini başarı verilmez.

## Başarı ve hata bildirimi

Başarı mesajı ancak altı halka da geçerse üretilir ve şunları içerir:

- bölüm/job kimliği,
- kullanılan structured alan,
- doğrulanan intent ve soru,
- cevapta kullanım doğrulaması,
- maskeli aktif sürüm hash'i ve rollback pointer.

Başarısızlıkta kesin başarı dili yasaktır. Owner'a ilk başarısız halka
bildirilir; örnekler:

- `Bilgi app_facts.md'ye yazıldı ancak structured facts'e yansımadı.`
- `Structured facts'te var ancak resolver context'ine girmedi.`
- `Model prompt'una girdi ancak cevapta güvenilir biçimde kullanılmadı.`

Bu sonuçlar aktivasyon audit'ine `validation_failed` olarak yazılır.
Önceki aktif snapshot korunur ve rollback pointer değişmez.

## Maliyet ve gecikme

Her onaylanan bilgi girişi için en fazla bir ek model çağrısı yapılır.
Sabit maliyet yaklaşık olarak:

`girdi tokenı × model input fiyatı + 256 × model output fiyatı`

Soru ve structured snapshot bölüm bazında sınırlandırılır; tüm bilgi bankası
her çağrıda taşınmaz. Aynı kaynak hash'i daha önce aynı intent/soru özetiyle
başarıyla doğrulandıysa sonuç cache'lenebilir. Cache anahtarı kaynak hash,
structured alan, intent ve validator sürümünü içerir; içerik değişince
geçersiz olur.

## False positive ve güvenlik sınırları

- Sadece bir anahtar kelime görülmesi kullanım kanıtı sayılmaz.
- Genel/kaçamak cevap, iddianın yönünü doğrulamıyorsa başarısızdır.
- Güvenlik kısıtları için yüksek eşik uygulanır; false negative kabul
  edilerek yeniden inceleme istenir.
- Modelin cevabı state ilerletmez ve canlı outbound üretmez.
- Vision belirsizliği, hassas veri, garanti/uydurma politika veya insan
  devri gerektiren durumlar bu döngüyle gevşetilemez; Katman 1 kuralları
  aynen uygulanır.

## Audit şeması

Kalıcı audit yalnız sanitize edilmiş yapısal alanları içerir:

`job_id`, `section_id`, `source_hash_masked`, `structured_field`,
`intent`, `question_class`, `chain_results`, `first_failed_link`,
`answer_used`, `model_route`, `validator_version`, `activation_status`,
`rollback_pointer`.

Ham candidate/owner mesajı, telefon numarası, ham model prompt'u ve ham
görsel audit/log içine yazılmaz.

## Kademeli uygulama

1. İlk aşamada yalnız no-outbound qualification harness'inde çalıştırılır.
2. En az 5 farklı bölüm türünde manuel karşılaştırmalı sonuç toplanır.
3. False positive/negative oranı owner tarafından incelenir.
4. Sonuçlar güvenilir olunca `#uygula` başarı kapısına bağlanır.
5. Canlı candidate cevaplarının davranışı değiştirilmeden önce rollback ve
   audit kanıtı doğrulanır.
