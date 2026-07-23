# Teşhis: `model_route` neden hep "conversation_decision_v2" gösteriyor, owner-approval'a rağmen canary hiç tetiklenmedi mi?

Tarih: 23 Temmuz 2026
Kapsam: Sadece kod incelemesi, canlı test yok, kod değişikliği yok.
Girdi: Owner approval API 201/approved döndü, connection-doctor
`model_adapter_canary_mode: "tenant_allowlist"` gösterdi, ama son 33 gerçek
candidate mesajının 33'ü de `model_route: "conversation_decision_v2"` olarak
loglandı.

## Özet Sonuç

**Bu bir entegrasyon eksikliği/kopukluk DEĞİL.** İki farklı soruya cevap veren
iki bağımsız karar noktası var; kullanıcı bunları tek bir eksen sanmış:

- `model_route` (`conversation_decision_v2` vs `assistant_response_v1_*`):
  hangi **mimari** (V2 karar motoru mu, eski Assistants mimarisi mi) devreye
  girecek — bu, canary/owner-approval ile **hiç ilgili değil**, hep aynı
  değeri döner çünkü V2 candidate/private trafik için zaten sürekli açık.
- `resolveModelAdapterExecution` (`useAdapterLayer` / canary): V2 motorunun
  GERÇEKTEN modeli çağırdığı anda, o çağrının **hangi sağlayıcı/adapter**
  (eski `assistant_adapter` mi, yeni canary adapter mı) ile yapılacağını
  seçer — owner-approval'ın gerçekten etkilediği yer burasıdır.

33 mesajın hiçbiri canary'ye düşmedi çünkü owner approval'ın onayladığı intent
kapsamı (`greeting_or_first_contact`, `candidate_first_contact`) son derece
dar, ve test edilen 33 mesajın (iş tanımı, ton sınırı, ödeme/garanti sınırı)
hiçbiri bu iki intent'ten biri olarak sınıflanmıyor — bazıları modele hiç
gitmeden deterministik fast-path'te bitiyor. Kanıtlar aşağıda, satır satır.

---

## 1) `model_route` kararı TAM OLARAK nerede veriliyor

Fonksiyon: `resolveConversationModelRoute()` —
[src/bridge/modelRoutingPolicy.ts:8-24](../../src/bridge/modelRoutingPolicy.ts#L8-L24)

```ts
export function resolveConversationModelRoute(input: {
  senderRole: SenderRole;
  chatType: "private" | "group";
  conversationDecisionV2Enabled: boolean;
  behaviorEligible: boolean;
}): ConversationModelRoute {
  if (
    input.senderRole === "candidate" &&
    input.chatType === "private" &&
    input.conversationDecisionV2Enabled
  ) {
    return "conversation_decision_v2";
  }
  return input.behaviorEligible
    ? "assistant_response_v1_behavior"
    : "assistant_response_v1_legacy";
}
```

Çağrı yeri: [src/bridge/handleIncomingMessage.ts:778-790](../../src/bridge/handleIncomingMessage.ts#L778-L790).

Bu fonksiyonun imzasında (girdi parametrelerinde) `modelAdapterLayerEnabled`,
`modelAdapterCanaryMode`, approval store gibi HİÇBİR canary/owner-approval
bilgisi YOK. `conversationDecisionV2Enabled` production'da varsayılan olarak
**true** (`process.env.CONVERSATION_DECISION_V2_ENABLED !== "false"`,
[src/config/env.ts:153](../../src/config/env.ts#L153)). Yani her candidate +
private mesaj için, canary approval durumu ne olursa olsun, `model_route`
**her zaman** `"conversation_decision_v2"` dönecektir. Bu, tasarım gereği
böyledir — V2, Quality Pack 1'in üzerine inşa edildiği tek aktif mimari.

**Sonuç:** `model_route` alanına bakarak canary'nin çalışıp çalışmadığını
anlamak mümkün değil; bu alan hiçbir zaman canary'yi yansıtmaz.

## 2) Bu karar noktası owner-approval/canary kontrolünü çağırıyor mu?

**Hayır, `resolveConversationModelRoute` çağırmıyor.** Ama V2 motoru, modeli
GERÇEKTEN çağırdığı noktada (ayrı bir kod yolunda) çağırıyor:

- V2 karar motoru modeli çağırırken `modelExecutionService.execute()`'ı
  kullanıyor: [src/intelligence/conversation/ConversationDecisionEngine.ts:290](../../src/intelligence/conversation/ConversationDecisionEngine.ts#L290)
  (`inferredIntent: input.context.latest_message.inferred_intent` dahil metadata
  ile, satır 274-288).
- `ModelExecutionService.execute()` → `executeCore()` içinde
  `resolveModelAdapterExecution()` gerçekten çağrılıyor:
  [src/modelAdapter/modelExecutionService.ts:193-206](../../src/modelAdapter/modelExecutionService.ts#L193-L206).

Yani canary kontrolü KODDA VAR ve V2 yoluna GERÇEKTEN bağlı — ama sadece
model GERÇEKTEN çağrıldığında çalışır. V2 motorundaki deterministik
fast-path'ler (ton sınırı, work-model-acceptance, payment/camera/job-definition
safety) modeli hiç çağırmadan biter
([ConversationDecisionEngine.ts:382-397](../../src/intelligence/conversation/ConversationDecisionEngine.ts#L382-L397),
golden testlerde `model_call_count: 0` olarak doğrulanmış). Bu mesajlarda
`resolveModelAdapterExecution` çağrılmaz bile.

Model gerçekten çağrılan mesajlarda ise `resolveModelAdapterExecution`
([src/modelAdapter/modelAdapterSelection.ts:113-125](../../src/modelAdapter/modelAdapterSelection.ts#L113-L125)),
intent scope kontrolünde şu şartı arıyor:

```ts
if (
  typeof input.inferredIntent !== "string"
  || input.inferredIntent.trim().length === 0
  || !intentScope.includes(input.inferredIntent)
) {
  return { useAdapterLayer: false, ..., reason: "denied_intent", ... };
}
```

`intentScope`, owner'ın approval isteğinde verdiği `["greeting_or_first_contact",
"candidate_first_contact"]` listesinden geliyor (approval → env `MODEL_ADAPTER_CANARY_INTENTS`
→ `input.featureFlags.model_adapter_canary_intents`).

`inferredIntent` değeri ise `inferConversationIntent()` fonksiyonundan geliyor:
[src/intelligence/conversation/ConversationContextBuilder.ts:12-33](../../src/intelligence/conversation/ConversationContextBuilder.ts#L12-L33).
Bu fonksiyon `"greeting_or_first_contact"` veya `"candidate_first_contact"`
değerini SADECE mesaj metni gerçekten bir selamlama/ilk-temas kalıbıyla
başlıyorsa döndürüyor (`^(selam|merhaba|mrb|slm)`, `"iş var mı/için/başvuru"`
vb. — satır 14-25). "İş tam olarak nedir?", "lan çakkal ne anlatıyon",
"Garanti kazanç var mı, kesin ödeme alır mıyım?" gibi test mesajlarının
HİÇBİRİ bu regex'lere uymuyor:
- "İş tam olarak nedir?" → satır 14'teki `ask_job_definition` regex'i ile
  eşleşiyor (greeting kontrolünden önce), yani `inferred_intent = "ask_job_definition"`.
- "Garanti kazanç var mı, kesin ödeme alır mıyım?" → hiçbir regex ile
  eşleşmiyor, `inferred_intent = null`.
- "lan çakkal ne anlatıyon" → tone-boundary fast-path'te model hiç
  çağrılmıyor, `resolveModelAdapterExecution` bu mesaj için hiç
  çalışmıyor.

Üçü de `resolveModelAdapterExecution`'da `denied_intent` ile sonuçlanır (ya da
hiç çağrılmaz). **Bu davranış, owner'ın approval'da bizzat verdiği dar intent
kapsamının (`greeting_or_first_contact`/`candidate_first_contact`) doğal ve
beklenen sonucudur — bug değil.**

## 3) `connection-doctor`'daki `model_adapter_current_decision` nereden geliyor?

**Gerçek son karardan geliyor, bağımsız bir simülasyon DEĞİL** — ama bir
tazelik (staleness) uyarısı var:

- `ModelExecutionService.snapshot()`
  ([src/modelAdapter/modelExecutionService.ts:387-399](../../src/modelAdapter/modelExecutionService.ts#L387-L399))
  `this.lastDecision`'ı döner — bu alan sadece `executeCore()` çalıştığında
  güncellenir ([modelExecutionService.ts:244](../../src/modelAdapter/modelExecutionService.ts#L244)).
- `ModelExecutionService` **tek bir singleton** olarak sunucu başlangıcında
  kuruluyor: [src/server.ts:273-285](../../src/server.ts#L273-L285).
- Aynı singleton hem gerçek webhook mesaj işleme yoluna
  ([src/server.ts:345-348](../../src/server.ts#L345-L348), `modelExecutionService` deps'e veriliyor)
  hem de dashboard/connection-doctor snapshot sağlayıcısına
  ([src/server.ts:313](../../src/server.ts#L313), `modelAdapterSnapshot: () => modelExecutionService.snapshot()`)
  veriliyor. Yani connection-doctor "şu an sorsan ne olur" hesaplamıyor;
  gerçekten son `executeCore()` çağrısının sonucunu gösteriyor.
- **Tazelik uyarısı:** `executeCore()` sadece model GERÇEKTEN çağrıldığında
  çalışır (bkz. madde 2). Bir mesaj deterministik fast-path'e düşerse
  (`model_call_count: 0`), `lastDecision` GÜNCELLENMEZ — connection-doctor
  o an için, en son modeli gerçekten çağıran ÖNCEKİ mesajın kararını
  gösterir. Yani `tenant_allowlist` görmek "approval doğru kuruldu" anlamına
  gelir, ama "bu spesifik son mesaj için karar buydu" anlamına gelmeyebilir
  eğer o mesaj fast-path'e düştüyse.

## 4) Route seçimi ile approval kontrolü GERÇEKTEN kopuk mu?

**Hayır, kopuk değil — iki ayrı eksen, ikisi de doğru bağlı.** Birleştirilmesi
gereken "eksik bir satır" yok çünkü:

- `resolveConversationModelRoute` (mimari seçimi) zaten canary'yi
  etkilemesi GEREKMEYEN bir karar — V2 mimarisi içinde kalırken, model
  çağrısının kendisi ayrı bir katmanda (`ModelExecutionService`) doğru
  şekilde canary'ye bağlı.
- Gerçek sebep: owner'ın approval'da seçtiği intent scope
  (`greeting_or_first_contact`/`candidate_first_contact`) ile test edilen 33
  mesajın intent'leri (`ask_job_definition`, `null`, tone-boundary fast-path)
  hiç kesişmiyor.

Eğer amaç "genel candidate trafiğinde canary'yi görmek" ise, düzeltilmesi
gereken kod değil, **test yöntemi**: canary'yi tetiklemek için, o candidate
numarasından YENİ bir konuşma açılıp ilk mesaj gerçek bir selamlama/ilk-temas
kalıbıyla ("Selam", "İş için yazdım" gibi) gönderilmeli, VE mesaj trafik
kovası (`trafficBucket = sha256(traceId) % 100`,
[modelExecutionService.ts:204](../../src/modelAdapter/modelExecutionService.ts#L204))
approval'daki `%10`'un içine düşmeli — yani her denemede sadece ~%10 ihtimalle
tetiklenir, tek denemede hiç tetiklenmemesi de olasılık dahilinde.

## Küçük not (davranışı etkilemiyor)

`AdapterSelectionInput.mode` alanı ([modelAdapterSelection.ts:38](../../src/modelAdapter/modelAdapterSelection.ts#L38))
`resolveModelAdapterExecution()` içinde hiç okunmuyor — ölü parametre. Karar
mantığını etkilemiyor, sadece temizlik notu.

## Aksiyon

Bu bir kod düzeltmesi gerektirmiyor. Owner'a öneri: canary'yi gerçekten test
etmek istiyorsa, ya (a) intent scope'u genişletip yeni bir approval çıkarsın
(örn. `ask_job_definition` da eklensin — ama bu, canary'nin ilk kapsamını
genişletir, ayrı bir karar), ya da (b) mevcut dar kapsamla, gerçekten yeni bir
"Selam" mesajıyla başlayan taze bir konuşmada birkaç kez dener (her seferinde
~%10 şans).
