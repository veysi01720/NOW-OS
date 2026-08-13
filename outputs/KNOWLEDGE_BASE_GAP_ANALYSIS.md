# Knowledge Base Gap Analysis

Tarih: 2026-08-14  
Kaynak: `data/knowledge_bank/app_facts.md` ve mevcut deterministic guard/fallback kodu  
Kapsam: Analiz ve owner içerik listesi; bu rapor kod veya runtime veri değişikliği yapmaz.

## Kısa Sonuç

Mevcut bilgi bankası uygulama adlarını, platform adlarını ve davet kodlarını içeriyor. Resmi indirme/link alanları tamamen boş. Ajans bağlama kodları yalnızca Amar ve Soyo için mevcut. Genel iş modeli bölümü ödeme zamanlaması ve garanti sınırı hakkında kısmi bilgi veriyor; kurulum, puan mekanizması, uygunluk açıklaması, eğitim ve destek akışını yanıtlayacak ayrıntı yok.

Bu nedenle bot bazı soruları güvenli sınır cevabıyla yanıtlayabilir, ancak operasyonel ayrıntı isteyen soruların önemli bölümü eksik bilgi/insan devri fallback'ine düşer. Eksik alanlar owner tarafından doğrulanmış metin veya linklerle doldurulmadan modelin tahmin yapmasına izin verilmemelidir.

## 1. Uygulama Tablosu Alan Taraması

Kaynak tablo: `data/knowledge_bank/app_facts.md`.

### Dolu alanlar

| Alan | Durum | Bulgı |
|---|---|---|
| `android_name` | DOLU | 7/7 uygulama |
| `ios_name` | DOLU | 7/7 uygulama |
| `invite_code` | DOLU | 7/7 uygulama |
| `status` | DOLU | 7/7 `owner_approved` |
| `notes` | DOLU | 7/7, ancak çoğu tek satırlık kısa not |

### Boş hücreler ve owner'ın doldurması gereken bilgiler

| Uygulama | `official_url` | `agency_bind_code` | `agency_code` | `notes` değerlendirmesi |
|---|---|---|---|---|
| Layla | EKSİK | EKSİK | EKSİK | Text-only notu var; indirme, kayıt ve kurulum adımları yok |
| TanChat | EKSİK | EKSİK | EKSİK | Voice/video adayı notu var; kamera zorunluluğu ve sınırları yok |
| Amar | EKSİK | DOLU: `10621` | EKSİK | Experienced candidate notu var; operasyon adımları yok |
| Linky | EKSİK | EKSİK | EKSİK | Yalnızca `Code` notu var; kodun ne olduğu ve kullanım adımı yok |
| Soyo | EKSİK | EKSİK | DOLU: `3997` | Yalnızca `Code` notu var; kodun ne olduğu ve kullanım adımı yok |
| Timo | EKSİK | EKSİK | EKSİK | Secondary app option notu var; hangi durumda önerileceği yok |
| Chatta | EKSİK | EKSİK | EKSİK | Secondary/alternative notu var; alternatif seçme kuralı yok |

Özet: `official_url` 7/7 eksik; `agency_bind_code` 6/7 eksik; `agency_code` 6/7 eksik. Android/iOS adları ve invite code'lar 7/7 dolu. `notes` hücreleri teknik olarak dolu olsa da adayın kurulum sorularını yanıtlamak için çoğunlukla yetersiz.

Owner'ın her boş hücre için sağlaması gerekenler: resmi mağaza/web linki, kodun türü ve hangi ekranda kullanılacağı, ajans bağlama adımı, platform farkı, minimum teknik gereksinimler ve uygulama-özel kurulum notu.

## 2. Genel İş Modeli Eksik Konu Taraması

Mevcut `Genel İş Modeli` bölümü özet, workflow, earnings policy, payment policy ve setup boundary alanlarından oluşuyor.

| Konu | Durum | Mevcut kapsam |
|---|---|---|
| Kurulum adımları | EKSİK | Yalnızca uygunluk ve model kabulünden önce kurulum ayrıntılarının verilmeyeceği yazıyor; indirme/kayıt/ajans/profil adımları yok |
| Puan/kazanç nasıl toplanıyor | YETERSİZ | Sonuçların aktiflik, sohbet kalitesi, hediyeler ve uygulama performansına bağlı olduğu yazıyor; puanın nasıl oluştuğu veya hesaplandığı yok |
| Ödeme/çekim kuralları | YETERSİZ | 1-3 iş günü, hafta sonu hariç, minimum/kesinti uygulama ekranında, IBAN düzeltme ve iptal edilememe var; minimum tutar, yöntem ve işlem akışı yok |
| Yaş/cinsiyet uygunluk sınırları | EKSİK | Genel iş modeli metninde sınır yok; uygulama kodunda intake/guard mantığı bulunması, owner-facing bilgi metninin yerini tutmuyor |
| Kamera/görüntülü zorunluluğu | EKSİK | Genel metinde yok; uygulama notları arasında yalnızca TanChat için `Voice/video candidate`, Layla için `Text-only` bulunuyor |
| Birden fazla uygulamada çalışma | YETERSİZ | Tablo birden çok uygulama ve Chatta için alternatif notu içeriyor; aynı anda çalışma, seçim ve geçiş kuralı yok |
| Eğitim süreci | EKSİK | Eğitim dosyaları/review artefact'ları repoda bulunabilir; app facts içinde adayın izleyeceği eğitim akışı ve tamamlanma ölçütü yok |
| Sorun/destek süreci | EKSİK | Kiminle, hangi kanaldan, hangi SLA ile iletişim kurulacağı ve kurulum sorunu prosedürü yok |

## 3. Candidate Soruları ve Beklenen Davranış

| Candidate sorusu | Bilgi bankası durumu | Şu anki beklenen davranış |
|---|---|---|
| “Ne kadar kazanırım?” | KISMEN cevaplanabilir | Sabit garanti/rakam verilmemeli; performansa bağlı olduğu söylenebilir. Kesin rakam istenirse unsupported-claim/güvenli sınır cevabı veya fallback |
| “Ne zaman ödeme alırım?” | KISMEN cevaplanabilir | 1-3 iş günü ve hafta sonu hariç bilgisi verilebilir. Minimum/yöntem sorusu gelirse bilgi eksikliği nedeniyle fallback |
| “Uygulamayı nereden indireceğim?” | CEVAPLANAMAZ | `official_url` alanları boş. Uygulama adı var ama doğrulanmış link yok; model link uydurmamalı, eksik bilgi/handoff |
| “Başka uygulama var mı?” | KISMEN cevaplanabilir | Uygulama adları listelenebilir; alternatif önerme sırası ve aynı anda çalışma kuralı yok, bu yüzden kesin yönlendirme için fallback riski var |
| “Kurulumda takıldım, ne yapmalıyım?” | YETERSİZ | Genel troubleshooting adımı yok. Human handoff tetiklenebilir; botun teknik çözüm üretmesi için bilgi eksik |
| “Vazgeçmek istersem?” | CEVAPLANAMAZ | İptal edilememe kuralı yalnızca çekim talebi için yazılmış; adaylık/kurulumdan vazgeçme prosedürü yok. Yanlış genelleme yapılmamalı, fallback/handoff |
| “Kaç saat çalışmam gerekiyor, minimum var mı?” | CEVAPLANAMAZ | Günlük saat intake alanı var, ancak minimum çalışma politikası yok. Rakam uydurulmamalı, fallback |
| “Yaşım/cinsiyetim uygun değilse ne olur?” | KISMEN cevaplanabilir | Deterministic eligibility guard reddetme/uygunsuzluk davranışını yönetebilir; neden, yeniden başvuru ve istisna açıklaması bilgi bankasında yok |
| “Ekip kim, kiminle konuşuyorum?” | YETERSİZ | Human handoff kuyruğu var, fakat ekip kimliği/rolü/iletişim çerçevesi yok. Genel cevap veya handoff gerekir |
| “Ajans kodunu nereye yazacağım?” | YETERSİZ | Bazı kodlar var, fakat uygulama ve ekran adımı yok. Kodun yanlış yere uygulanması riski nedeniyle fallback/handoff |
| “Android ve iPhone arasında fark var mı?” | YETERSİZ | Platform adları var; özellik/kurulum farkı yok. Sadece ad bilgisi verilebilir |
| “Kamera açmam gerekiyor mu?” | YETERSİZ | Layla için text-only ve TanChat için voice/video notu var; uygulama seçilmeden genel kural yok. Kesin kamera iddiası yapılmamalı |
| “Hangi uygulamayı seçmeliyim?” | YETERSİZ | Uygulama isimleri ve kısa notlar mevcut; uygunluk/alternatif yönlendirme matrisi yok. Grounded seçim yapılamazsa `UNGROUNDED_APP_SELECTION`/güvenli fallback |
| “Eğitim nasıl olacak?” | CEVAPLANAMAZ | Eğitim süresi, kanal, içerik ve owner onayı sonrası adımlar app facts'te yok; post-install training handoff beklemeye geçebilir |
| “Hesabım veya profilim neden onaylanmadı?” | CEVAPLANAMAZ | Red nedenleri, itiraz ve düzeltme prosedürü yok; handoff gerekir |
| “Verilerim/görüntüm nasıl kullanılıyor?” | CEVAPLANAMAZ | Bilgi bankasında aday verisi, görsel saklama ve gizlilik açıklaması yok; güvenli genel cevap veya handoff gerekir |

## 4. Owner İçerik Backlog'u

### Öncelik 1: Adayı ilk mesajlarda kilitleyen bilgiler

1. Her uygulamanın doğrulanmış resmi indirme URL'si.
2. Her kodun türü: invite, agency bind veya agency code; kodun girileceği ekran.
3. Kurulum akışı: indirme → kayıt → profil → ajans bağlama → kurulum doğrulama.
4. Kamera/video zorunluluğu: uygulama bazında açıkça `zorunlu`, `opsiyonel` veya `yok`.
5. Yaş/cinsiyet sınırlarının aday-facing açıklaması ve uygun değilse verilecek resmi metin.

Örnek: Candidate “Layla'yı nereden indireyim?” derse şu an link alanı boş olduğu için doğrulanmış link verilemez; bot link uydurmamalı, “resmi indirme bağlantısı henüz doğrulanmadı” türü sınırlı cevap veya handoff vermelidir.

### Öncelik 2: Kazanç ve ödeme beklentisi

1. Puan/hediye/aktivite mekanizmasının garanti vermeyen, owner onaylı açıklaması.
2. Minimum çekim tutarı, desteklenen ödeme yöntemi ve varsa kesintiler.
3. 1-3 iş günü kuralının hangi koşullarda geçerli olduğu.
4. Yanlış IBAN düzeltme adımları ve iptal edilememe kuralının kapsamı.

Örnek: Candidate “Minimum kaç puanda çekim yaparım?” derse mevcut metin yalnızca minimum ve kesintilerin uygulama ekranından kontrol edileceğini söylüyor; sayı verilmez, bot fallback/handoff yapmalıdır.

### Öncelik 3: Seçim, alternatif ve eğitim

1. Hangi aday profiline hangi uygulamanın önerilebileceği.
2. Layla/NIVI default ve Chatta/Timo alternatiflerinin hangi koşullarda sunulacağı.
3. Birden çok uygulamada çalışma serbest mi, sıra/öncelik nedir?
4. Kurulum tamamlandıktan sonra eğitim içeriği, kanal, süre ve owner onay akışı.

Örnek: Candidate “Layla yerine Chatta'ya geçebilir miyim?” derse Chatta'nın alternatif olduğu biliniyor, ancak geçiş koşulu ve prosedürü yazılı değil; kesin karar yerine doğrulama/handoff gerekir.

### Öncelik 4: Destek, ayrılma ve gizlilik

1. Kurulumda takılma için adım adım troubleshooting.
2. Adayın vazgeçmesi, kurulumu iptal etmesi veya yeniden başvurması.
3. Ekip/owner/manager rollerinin aday-facing tanımı.
4. Candidate verisi, görsel doğrulama, saklama süresi ve gizlilik metni.
5. Hesap red/kısıtlama/itiraz prosedürü.

Örnek: Candidate “Kurulumda ekranımda hata var” derse bilgi bankasında çözüm adımı yok; bot teknik bir tahmin yapmamalı, `installation_verification_ambiguous` veya ilgili human-handoff yoluna yönlenmelidir.

## 5. Sonuç ve Sınır

Bu rapor owner'ın hangi bilgileri sağlaması gerektiğini listeler; eksik alanları tahminle doldurmaz. Özellikle resmi URL, ajans kodları, minimum ödeme bilgisi, kamera politikası ve eğitim/destek akışı owner doğrulaması olmadan otomatik cevaba eklenmemelidir.

İncelenen checkout'ta `data/knowledge_bank/app_facts_structured.json` bulunmadı; bu nedenle bu raporun tablo ve genel model tespitleri `app_facts.md` kaynak dosyasına dayanır. Structured publish çıktısı ayrıca doğrulanacaksa, runtime dosyası ile repo kaynak dosyasının aynı sürüm/hash olduğu kanıtlanmalıdır.
