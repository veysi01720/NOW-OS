# Two-Layer Conversation Validator Design

Status: DESIGN ONLY
Date: 2026-08-13
Scope: V3/Terra Responses path

## 1. Amaç

ConversationDecisionValidator tek bir sertlik seviyesiyle iki farklı
problemi aynı anda çözmeye çalışıyor: güvenlik sınırlarını korumak ve
modelin doğal bir konuşma kararı üretmesini doğrulamak. Bu tasarım,
kritik güvenlik kontrollerini değişmez bir Katman 1 olarak korur; akış,
ton ve action-set ayrıntılarını ise Katman 2'de sonuç odaklı değerlendirir.

Bu belge henüz kod, schema veya production davranışı değiştirmez.

## 2. Karar modeli

Önerilen nihai değerlendirme sonucu:

```text
VALID
  layer_1: pass
  layer_2: pass | accepted_with_variance

REPAIRABLE
  layer_1: pass
  layer_2: fail
  repair_budget_remaining: true

REJECTED
  layer_1: fail
  veya güvenli bir repair sonrasında Katman 2 hâlâ sonucu karşılamıyor
```

`accepted_with_variance`, modelin izinli action listesinden farklı bir
sıra veya daha az action üretmesine rağmen cevabın son kullanıcı sorusunu
doğru karşıladığı, state yazmadığı ya da state yazdıysa kanıtladığı ve
Katman 1 ihlali bulunmadığı durumu ifade eder. Bu sonuç, güvenlik
kontrollerini bypass etmez.

## 3. Katman 1: Kritik Güvenlik

Bu kontroller kesin ve fail-closed kalır. Herhangi biri başarısızsa
cevap kabul edilmez; Terra'nın doğal tonu veya makul görünen cevabı bu
red kararını değiştiremez.

### 3.1 Garanti ve kazanç

- Kesin kazanç, garanti, sabit getiri veya sonuç vaadi.
- Structured facts ve canonical policy facts içinde bulunmayan ödeme,
  oran, süre veya başarı iddiası.
- `earnings_policy` içeriğinin kesin rakama/garantiye dönüştürülmesi.

### 3.2 Yaş ve uygunluk

- Yaş sınırlarının dışındaki adayların kabul edilmesi.
- Cinsiyete göre tanımlı uygunluk sınırlarının aşılması.
- Mesajın desteklemediği yaş/cinsiyet/uygunluk state patch'i.
- Mevcut state veya current message kanıtı olmayan eligibility değişimi.

### 3.3 Hassas bilgi isteme

- Şifre, kart, kimlik bilgisi, IBAN veya benzeri hassas bilginin
  istenmesi.
- Telefon türü gibi yalnızca gerçekten gerekli ve desteklenen intake
  alanları dışında yeni hassas alan uydurulması.
- Hassas bilgi içeren bir state patch veya reply yönlendirmesi.

### 3.4 Grounding ve politika

- Structured facts dışında uygulama, politika veya süreç uydurulması.
- `policy_facts_used` içinde canonical context'te bulunmayan fact id.
- Onaylı uygulama sözlüğünde bulunmayan uygulamanın reply içinde
  önerilmesi.
- Ödeme, kamera, kurulum veya eskalasyon sınırlarının facts ile
  çelişmesi.

### 3.5 İnsan devri ve egress güvenliği

- İnsan devri gerektiren provider/policy/semantic belirsizliğinin
  sessizce cevaplanması.
- Reply'de ekip/owner/yönetici kontrolü vaadi olup gerçek handoff
  eyleminin bulunmaması.
- Candidate rolünden owner/manager-only action veya state yazımı.
- Group kanalda candidate state mutation veya outbound karar.
- Backend'in izin vermediği action, state patch veya next action.

Katman 1'deki mevcut güvenlik reason code'ları korunur. Yeni tasarımın
amacı bunları daha yumuşak yapmak değil, raporda ayrı bir güvenlik
sonucu olarak görünür kılmaktır.

## 4. Katman 2: Akış, ton ve format

Katman 2, modelin güvenli ve anlamlı bir sonuç üretip üretmediğini
değerlendirir; action listesini bir protokol komutu gibi birebir
eşleştirmez.

### 4.1 Kapsama alınacak kontroller

- Action'ların sırası.
- Aynı amaca hizmet eden action'ların eksik veya fazla olması.
- Kısmi intake mesajına verilen doğal karşılık.
- Doğal, sıcak, kısa veya esprili ton.
- Owner/manager ile bağlama uygun şakalaşma; ancak bu, Katman 1
  güvenlik veya gizlilik sınırlarını aşamaz.
- `next_action` ile action-set arasındaki yumuşak uyum.
- Doğrudan sorunun cevaplanıp cevaplanmadığı.
- Cevap gereksiz yere tekrar soru soruyor mu.
- Cevap son kullanıcıyı bir sonraki makul adıma taşıyor mu.

### 4.2 Katı kalacak alt kontroller

Katman 2 adı altında olsa bile şu kontroller gevşetilmez:

- `chosen_actions` içindeki action'ın backend allowlist'inde olması.
- State patch varsa patch değerinin tip, sınır ve evidence kontrolü.
- Patch'in current message, existing state veya izinli canonical fact ile
  desteklenmesi.
- `no_reply` seçilmişse gerçek action veya state patch bulunmaması.
- Eskalasyon next action'ında gerekli escalation alanlarının bulunması.
- Maksimum reply uzunluğu ve zorunlu schema alanları.

Yani gevşetme, bilinmeyen action veya kanıtsız state yazımını kabul etmek
anlamına gelmez.

## 5. Sonuç odaklı Katman 2 kontrolü

Önerilen kontrol sırası:

1. Schema parse/shape kontrolü yapılır.
2. Katman 1 kontrolleri çalışır. Herhangi bir red varsa sonuç `REJECTED`.
3. Action'lar allowlist içinde mi ve state patch güvenli mi kontrol edilir.
4. Intent ve direct question ile reply arasında sonuç ilişkisi kurulur:
   - Soru varsa, reply soru özetini makul biçimde karşılıyor mu?
   - Intake bilgisi geldiyse, reply bilgiyi kabul edip eksik sonraki alanı
     soruyor veya açıkça açıklıyor mu?
   - İş modeli sorusuysa, genel iş modeli facts'i gerçekten kullanılıyor
     mu?
   - Eskalasyon gerekiyorsa, reply ve `requires_escalation` tutarlı mı?
5. State patch varsa transition preparation çalışır. Geçerli patch,
   action sırası farklı olsa bile kabul edilebilir.
6. Sonuç başarısızsa yalnız Katman 2 reason code'ları için bir repair
   denemesi yapılır. Repair sonrasında Katman 1 tekrar baştan çalışır.
7. Repair sonrası soru karşılanıyor ve güvenlik geçiyorsa
   `accepted_with_variance`; karşılanmıyorsa mevcut güvenli fallback ve
   gerekiyorsa handoff uygulanır.

Örnek: Model `answer_user_question, explain_work_model,
request_work_model_acceptance` yerine `explain_work_model,
answer_user_question` üretirse, reply genel modeli doğru anlatıyor,
acceptance istemeyi atlamıyor ve state yazmıyorsa bu bir Katman 2
varyansı olabilir. Ancak state acceptance değiştirip bunu kanıtlamıyorsa
veya garanti üretiyorsa kabul edilemez.

## 6. Reason code ayrımı

Mevcut reason code'lar korunarak iki namespace'e ayrılmalı:

### Katman 1 örnekleri

- `UNSUPPORTED_POLICY_FACT`
- `POLICY_FACT_NOT_GROUNDED`
- `STATE_PATCH_AGE_INVALID`
- `STATE_PATCH_CURRENT_MESSAGE_EVIDENCE_MISMATCH`
- `STATE_PATCH_EXISTING_STATE_EVIDENCE_MISMATCH`
- `STATE_PATCH_APP_NOT_APPROVED`
- `ROLE_CANDIDATE_STATE_ACTION_DENIED`
- `NEXT_ACTION_ESCALATION_INCOMPATIBLE`
- `HUMAN_HANDOFF_REQUIRED_BUT_MISSING`
- `GUARANTEE_OR_UNSUPPORTED_EARNINGS_CLAIM`
- `SENSITIVE_DATA_REQUEST`

### Katman 2 örnekleri

- `NEXT_ACTION_MISSING_INFO_INCOMPATIBLE`
- `NEXT_ACTION_DIRECT_ANSWER_INCOMPATIBLE`
- `WORK_MODEL_DISCLOSURE_ACTIONS_MISSING`
- `QUESTION_NOT_FULLY_ANSWERED`
- `GENERIC_CONVERSATION_CLOSER`
- `KNOWN_INFORMATION_REASKED`
- `ACTION_ORDER_VARIANCE`
- `PARTIAL_INTAKE_RESPONSE_VARIANCE`

Bir reason code'un güvenlik mi yoksa akış mı olduğu sabit bir katalogda
tutulmalı; string adından çıkarım yapılmamalı. Yeni bir kural
eklenirken katmanı zorunlu olarak belirtmeyen kod review kabul edilmez.

## 7. Handoff ve fallback davranışı

- Katman 1 red: güvenli deterministic cevap, gerçek handoff gerekiyorsa
  `recordHumanHandoff()` ve ilgili audit kaydı.
- Katman 2 ilk red: mevcut repair mekanizması; modelden doğal ve soruyu
  karşılayan bir cevap istenir.
- Katman 2 ikinci red: fallback. Fallback'te kesin başarı veya ekip
  kontrolü iddiası varsa gerçek execution/handoff ile eşleştirilir.
- Aynı Katman 2 red'inin tekrarı repeat-guard tarafından döngüye
  sokulmaz; güvenli çeşitlendirme veya handoff uygulanır.
- Hiçbir durumda model self-report'u validator veya execution kaydının
  yerine geçmez.

## 8. Yanlış gidebilecekler

Katman 2'yi gevşetmek şu riskleri doğurabilir:

- Model action-set içinde kalsa bile eksik bir sonraki adımı atlayabilir.
- Doğal ton, ciddi bir sorunun üstünü örtebilir.
- Kısmi intake cevabı kullanıcıyı yanlış state'e ilerletmeden önce
  yeterince açıklayıcı görünmeyebilir.
- `next_action` ile gerçek backend transition arasında sessiz ayrışma
  oluşabilir.
- Repair sayısı arttıkça gecikme, maliyet ve provider rate-limit baskısı
  büyüyebilir.
- Golden testler yalnız action listesine bakıyorsa gerçek kalite
  iyileşmesini veya regresyonu yanlış ölçebilir.

Bu nedenle Katman 2 gevşemesi yalnız sonuç odaklı kalite ölçümü,
transition preview ve no-outbound replay ile açılmalıdır. Kritik
senaryolarda insan değerlendirmesi ve adversarial test zorunludur.

## 9. Test ve kabul planı

Uygulamadan önce aşağıdaki test sınıfları hazırlanmalı:

- Katman 1 ihlallerinin her birinde kesin red ve güvenli fallback.
- Aynı güvenli cevabın farklı action sıralarıyla kabul edilmesi.
- Kısmi intake: yalnız yaş, yalnız cinsiyet ve yalnız süre.
- İş modeli sorusu: `general_work_model` kullanımı ve kamera-odaklı
  eski metnin geri gelmemesi.
- Payment, guarantee, camera ve sensitive-data sınırları.
- Approved app dışı isim ve structured fact dışı politika.
- Repeat guard ve gerçek handoff kaydı.
- Owner false-success guard: execution olmadan başarı iddiası yok.
- State patch evidence ve transition preparation regresyonları.

Kabul kapıları:

1. Katman 1 güvenlik ihlali: 0.
2. Kritik senaryolarda gerçek outbound: no-outbound replay'de 0.
3. Katman 2 varyanslarının her biri trace'te ayrı sınıflandırılmış.
4. Repair sonrası başarı ve fallback oranları ayrı raporlanmış.
5. Baseline, targeted ve expanded setlerde regresyon yok.
6. Production açılımından önce shadow, sonra küçük allowlist canary.

## 10. Gözlemlenebilirlik ve geri alma

Her karar trace'inde en az şu alanlar bulunmalı:

- `layer_1_result`, `layer_1_reason_codes`
- `layer_2_result`, `layer_2_reason_codes`
- `repair_attempted`, `repair_result`
- `semantic_question_answered`
- `transition_proposal_valid`
- `final_reply_origin`
- `human_handoff_recorded`

Katman 2 sonuçlarını gevşetmek için ayrı bir feature flag kullanılmalı;
global adapter flag'iyle aynı anahtara bağlanmamalı. Flag kapatıldığında
mevcut sıkı validator ve fallback davranışına dönülmeli. Katman 1 için
gevşetme flag'i bulunmamalı.

## 11. Karar özeti

Önerilen mimari: Katman 1 güvenlikte deterministik ve fail-closed;
Katman 2'de schema/allowlist/patch güvenliği korunarak sonuç odaklı
semantic değerlendirme, tek repair ve açık trace. Bu yaklaşım Terra'nın
doğal konuşma kabiliyetine alan açar; ancak modelin güvenli olduğuna dair
kanıtı kendi metninden değil, backend validator, canonical facts ve
transition hazırlığından alır.
