# Handover Protocol

Bu dosya repo köküne (`HANDOVER_PROTOCOL.md`) commit edilir ve her iki
makinedeki Codex oturumu tarafından aynı şekilde takip edilir. Amaç:
limit bittiğinde veya makine değiştiğinde, iş kaybı, çakışma veya
karmaşa olmadan devir yapmak.

## Temel Kural

**Aynı anda sadece BİR Codex bu repo üzerinde çalışabilir.** Bir taraf
"kapanış" adımlarını tamamlayıp "transfer için hazır" demeden, diğer
taraf hiçbir kod yazmaz, hiçbir commit atmaz. Bu, `git diverge`
(iki ayrı commit dalının çakışması) riskini tamamen ortadan kaldırır.

---

## A) LİMİT BİTMEDEN ÖNCE — Kapanan taraf bunu çalıştırır

```
Limit bitmeden devir teslim hazırlığı yap - kod yazma, sadece belgeleme:

1. git status kontrol et - commit edilmemiş HİÇBİR değişiklik kalmasın.
   Varsa net bir mesajla commit et (örn. "handover: pre-transfer
   checkpoint <tarih>").

2. Şu an çalışılan pakette elde edilen EN SON test/qualification
   sonucunu (varsa) commit edilmiş bir rapor dosyası olarak
   outputs/<ilgili-paket>/ altına yaz - sohbette veya terminalde
   kalıp repo'ya işlenmemiş hiçbir sonuç olmasın.

3. HANDOVER_PROTOCOL_STATE.md dosyasını (yoksa oluştur, varsa güncelle)
   şu bölümlerle yaz:
   - Şu an tam olarak hangi paket/adımda kalındığı
   - Son kararların özeti (hangi tasarım onaylandı, hangi düzeltme
     uygulandı)
   - Son çalıştırılan test/qualification sonucu (PASS/FAIL, kaç/kaç)
   - Kalan tek blocker (varsa) net olarak ne
   - Production/canary/deploy durumu (dokunuldu mu, dokunulmadıysa
     "NO" ile teyit)
   - Son 5 commit'in dosya değişim özeti (git diff --stat HEAD~5..HEAD)

4. git log --oneline -5 çıktısını ver, son commit hash'ini bildir.

Production/VPS/Evolution'a HİÇBİR şekilde dokunma. Bu adımlar
tamamlanınca "transfer için hazır, son commit: <hash>" diye bildir,
başka hiçbir şey yapma.
```

---

## B) DEVRALAN TARAF — Yeni makinedeki Codex bunu çalıştırır

```
Bu proje başka bir makineden devredildi. Son commit: <önceki taraftan
alınan hash>. Devralmadan önce doğrula, kod yazma:

1. git log --oneline -10 çalıştır, HEAD'in <hash> ile eşleştiğini
   doğrula.
2. HANDOVER_PROTOCOL_STATE.md dosyasını oku.
3. npm run build ve full test suite'i çalıştır - sonucu bildir
   (kaç/kaç PASS). HANDOVER_PROTOCOL_STATE.md'deki son bilinen
   sonuçla eşleşiyor mu kontrol et.
4. HANDOVER_PROTOCOL_STATE.md'de listelenen "kalan blocker" ve
   "production/canary durumu" maddelerini kod üzerinden teyit et
   (ilgili flag/env değerlerini oku, iddiayla eşleştiğini göster).

Hepsi eşleşiyorsa "devralma doğrulandı, buradan devam edebilirim" de.
Herhangi bir uyuşmazlık varsa (build fail, test fail, dosya eksik,
state dosyasıyla kod arasında çelişki) detaylıca bildir, ben karar
vereceğim.

Bu doğrulama tamamlanmadan hiçbir yeni kod yazma, hiçbir env/production
değişikliği yapma.
```

---

## Eray İçin Kontrol Listesi (her devirde)

- [ ] Kapanan taraftan "transfer için hazır, son commit: X" mesajı geldi
- [ ] Repo klasörü (.git dahil, node_modules hariç) yeni makineye taşındı
- [ ] Devralan tarafa B promptu, doğru hash ile verildi
- [ ] "Devralma doğrulandı" mesajı geldi VE build/test sonucu eski
      taraftakiyle eşleşiyor
- [ ] Ancak bundan sonra devralan tarafa yeni görev/paket verilir

## Neden Bu Şekilde

- Devir, sohbet geçmişine değil **repo'daki dosyalara** dayanıyor -
  hangi Codex/hangi makine olursa olsun aynı kaynaktan okuyor.
- Her devirde build+test tekrar çalıştırılıyor - "iddia" değil,
  "kanıt" ile devam ediliyor, tıpkı projenin geri kalanındaki disiplin
  gibi.
- Tek kural (aynı anda tek taraf çalışır) çakışma riskini yapısal
  olarak ortadan kaldırıyor - karmaşık merge/conflict çözümüne hiç
  gerek kalmıyor.
