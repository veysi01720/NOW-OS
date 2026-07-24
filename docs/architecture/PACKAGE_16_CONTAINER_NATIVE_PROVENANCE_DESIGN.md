# Package 16 - Container-Native Provenance (Design Only, Not Applied)

Date: 23 Temmuz 2026
Status: DESIGN ONLY. Kod yazılmadı, Dockerfile/scriptler değiştirilmedi.
Onay sonrası uygulanacak. Bu gece hiçbir deploy/build aksiyonu alınmadı;
VPS'teki `now_os_backend` önceki sağlıklı commit (`7059928`) üzerinde
dokunulmadan çalışmaya devam ediyor.

## Kabul Edilen Kök Neden

Package 03'ün orijinal varsayımı ([PACKAGE_03_BUILD_PROVENANCE_SEAL.md](PACKAGE_03_BUILD_PROVENANCE_SEAL.md)):
"Compiled `dist/` has its own deterministic tree hash" — yani host'ta
(veya `temporary_node_image` container'ında) üretilen `dist/`'in, Docker
build'in kendi içinde `RUN npm run build` ile ürettiği `dist/` ile birebir
aynı olacağı varsayıldı. Bu varsayım yanlış çıktı: host/temp-container
tsc çalıştırması ile Docker image'in kendi içindeki tsc çalıştırması iki
ayrı toolchain/OS/filesystem üzerinde gerçekleşiyor, bu yüzden
byte-seviyesinde farklı `dist/` çıktısı üretebiliyorlar. Mevcut akış:

```text
1. Host/temp-container: npm ci + npm run build  -> dist/ (A)
2. Host/temp-container: generate-build-provenance.mjs -> manifest.json
   (source_tree_hash, dist_tree_hash A, ... hesaplanır)
3. docker build: manifest.json COPY'lenir (statik dosya, değişmez)
4. docker build: COPY src/ docs/ scripts/ ... (host'tan container'a)
5. docker build: RUN npm ci + RUN npm run build -> dist/ (B, container İÇİNDE,
   AYRI bir toplama)
6. docker build: verify-build-provenance.mjs, container'ın KENDİ dosya
   durumunu (dist B dahil) COPY'lenen manifest'teki (dist A'ya göre
   hesaplanmış) değerlerle karşılaştırır -> MISMATCH (dist A != dist B)
```

Manifest dosyasının kendisi (COPY'lendiği haliyle) bozulmadığı için
`manifest_hash` eşleşiyor; ama içindeki `dist_tree_hash` (ve olası
`source_tree_hash`/`package_lock_hash`, host/container `npm ci` farkına
göre) container'ın gerçek durumuyla eşleşmiyor. Bu, script'lerin
hash mantığında bir hata değil — mimari olarak iki ayrı ortamda iki
ayrı build'in aynı olacağını varsaymanın hatası.

## Hedef Değişmez (Invariant)

**Manifest, sadece container'ın kendi içine COPY'lenmiş dosyalardan ve
container'ın kendi tek `npm run build` çalıştırmasından üretilmeli.
Host'ta (veya ayrı bir temp-container'da) hiçbir provenance hash'i
önceden hesaplanmamalı ve container'a COPY'lenmemeli.** Böylece
host/container farkı yapısal olarak imkansız hale gelir — çünkü
karşılaştırılacak "iki ayrı ortam" diye bir şey kalmaz, tek ortam vardır.

## Yeni Build Akışı (Dockerfile, kavramsal — kod değil)

```text
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts Dockerfile .dockerignore workspace.identity.json ./
COPY src/ ./src/
COPY docs/ ./docs/
COPY scripts/ ./scripts/

# ESKİ: COPY build/provenance/source-manifest.json ...  -> KALDIRILDI
# ESKİ: host/temp-container'da önceden hesaplanan --expected-* build-arg'ları
#       -> KALDIRILDI (artık host tarafında hiçbir hash hesaplanmıyor)

RUN npm run build                                   # dist/ SADECE burada, TEK sefer üretilir
RUN node scripts/generate-build-provenance.mjs \
      --test-result "$TEST_RESULT_REFERENCE"        # manifest, container'ın kendi
                                                       # src/docs/scripts/dist/package-lock.json'ından
                                                       # container İÇİNDE üretilir
RUN node scripts/verify-build-provenance.mjs \
      --manifest build/provenance/source-manifest.json
      # (opsiyonel) --expected-source/--expected-lock/... bir git-commit'e
      # pinlemek istenirse, bu değerler HOST'ta ayrı bir build'den değil,
      # repo'ya commit'lenmiş bilinen-iyi bir referans dosyadan gelmeli
      # (bkz. "Opsiyonel Pinning" altı) - varsayılan tasarımda YOK.

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Bu haliyle `verify-build-provenance.mjs`'in tek işlevi kalır: manifest'in
generate anındaki hâliyle şu an container'daki dosyalarla iç tutarlılığını
doğrulamak (örn. generate'ten sonra RUN adımı sırasında beklenmedik bir
dosya değişikliği olmadığını teyit eden bir sanity check). Host/container
karşılaştırması diye bir kavram tamamen ortadan kalkar.

## Çözülmesi Gereken Asıl Mekanik Sorun: LABEL'lar

Mevcut tasarımda `now_os.source_tree_hash` gibi Docker `LABEL`'ları,
`docker build --build-arg SOURCE_TREE_HASH=...` ile **build başlamadan
önce host'ta bilinen** bir değer olarak veriliyor ([Dockerfile:3-19](../../Dockerfile#L3-L19)).
Yeni tasarımda bu hash'ler artık build'in **içinde**, bir `RUN` adımında
hesaplanıyor — ve standart Dockerfile sözdiziminde bir `RUN` adımının
ürettiği bir değeri aynı build'in `LABEL`'ına geri yazmanın doğrudan bir
yolu yok. Üç seçenek:

**Seçenek A - LABEL'ı tamamen bırak, runtime endpoint'e geç.**
Image içine gömülü `build/provenance/source-manifest.json` zaten tek
gerçek kaynak; `/healthz` yanına bir `/provenance` (veya connection-doctor
içine) endpoint eklenip dosya içeriği/hash'i runtime'da okunup raporlanır.
En basit, Docker'a hiç hile gerektirmiyor. Dezavantaj: mevcut P0 gate
script'inin `docker inspect --format '{{.Config.Labels}}'` ile anlık
kontrol alışkanlığı kaybolur; `docker run` ile container'ı ayağa kaldırıp
endpoint'i sorgulamak gerekir.

**Seçenek B - Build sonrası LABEL damgalama (ÖNERİLEN).**
```text
1. docker build -t now_os_backend:candidate .    (host'ta hiçbir hash hesabı YOK)
2. id=$(docker create now_os_backend:candidate)
3. docker cp $id:/app/build/provenance/source-manifest.json /tmp/manifest.json
4. HASH'LER /tmp/manifest.json İÇİNDEN OKUNUR (yeniden hesaplanmaz - image
   içine gömülü dosyanın ta kendisi okunuyor, host'ta ayrı bir build/hash
   üretimi yok)
5. docker commit --change "LABEL now_os.source_tree_hash=... now_os.dist_tree_hash=..." \
     $id now_os_backend:candidate
6. docker rm $id
```
Bu, mevcut P0 gate script'inin `image_label_match` adımını (neredeyse)
değişmeden korur — çünkü LABEL, image'in İÇİNDEKİ dosyadan okunuyor,
host'un bağımsız hesabından değil. Host/container drift'i yapısal olarak
imkansız: label her zaman "bu spesifik image'in içinde gerçekten ne var"ı
yansıtır.

**Seçenek C - BuildKit `--metadata-file` / OCI annotation.**
Daha karmaşık, BuildKit-özel tooling'e bağımlı; bu ölçekte gereksiz
karmaşıklık. Değerlendirildi, önerilmiyor.

**Öneri: Seçenek B.** Mevcut deploy script disiplinini (label inspect ile
hızlı kontrol) korurken host/container drift'ini yapısal olarak ortadan
kaldırıyor.

## Test (`npm test`) Nerede Kalmalı?

İki seçenek, ayrı bir karar:
- **(i) Host/CI'da, docker build'den önce (mevcut disiplin gibi):** Build
  hızlı kalır, test artefact'leri image'e hiç girmez. Dezavantaj: test'in
  çalıştığı Node ortamı, image'in Node ortamından (Alpine) farklı olabilir
  — teoride test sonucu ile image davranışı arasında (küçük) bir boşluk
  kalır, ama bu provenance drift'i DEĞİL, ayrı bir konu.
- **(ii) Docker build'in içine `RUN npm test` olarak taşı:** Tam
  self-contained, test de container'ın kendi ortamında koşar. Dezavantaj:
  her build ~1-2 dakika daha uzun sürer (606 test).

Bu, bu gece çözülmesi gereken drift bug'ıyla doğrudan ilgili değil —
tercih tercihi yarın karar verilebilir. Varsayılan öneri: (i)'yi koru,
sadece dist/provenance'ı container'a taşı.

## P0 Gate Script'inde Kalkacak/Değişecek Adımlar

Kalkacak:
- Host/`temporary_node_image` içinde host-side `npm run build` +
  `generate-build-provenance.mjs` çalıştırma adımı.
- Dockerfile'a `--build-arg SOURCE_TREE_HASH=... --build-arg DIST_TREE_HASH=...`
  gibi host-hesaplı argüman geçme adımı.
- `COPY build/provenance/source-manifest.json` satırı.

Kalacak (değişmeden veya küçük değişiklikle):
- `npm ci` + `npm run build` + `npm test` host/CI tarafında (test PASS
  gate'i olarak, image build'inden önce - "build başarısız olursa image'e
  hiç girme").
- `docker build --no-cache` (host-side hash argümanı olmadan).
- Seçenek B'nin `docker create` + `cp` + `commit` + `rm` adımları.
- `image_label_match` kontrolü (artık image'in kendi içinden okunan
  değerle, tautolojik ama yine de sanity check olarak faydalı).
- `backend_recreate_only` + `healthz`/`readyz` (değişmedi).

## Opsiyonel Pinning (ileride, gerekirse)

Eğer "bu image'in TAM OLARAK şu git commit'in kodundan üretildiğini"
harici olarak doğrulamak istenirse (supply-chain audit amaçlı), bu host'ta
AYRI bir `dist/` build'i ile değil, sadece `git rev-parse HEAD` +
`git diff --stat` gibi salt kaynak-kontrolü yöntemleriyle yapılmalı —
asla ikinci bir bağımsız `npm run build` çalıştırılıp `dist_tree_hash`
karşılaştırılarak değil (bu, tam da bu gece düzelttiğimiz hatayı geri
getirir).

## Kapsam Dışı

- Canary/owner-approval mantığına dokunulmuyor.
- Mevcut sağlıklı VPS deploy'una (`7059928`) bu gece hiçbir aksiyon
  alınmadı.
- `1e12ac6` (CANARY_DECISION_LOGGED değişikliği) commit'lendi/push edildi
  ama VPS'e deploy edilmedi; bu tasarım onaylanıp uygulandıktan sonra
  aynı P0 gate disipliniyle (yeni, container-native haliyle) deploy
  edilecek.

## Onay Sonrası Uygulama Adımları (yarın)

1. Dockerfile: host-side ARG/LABEL host-hesaplı hash'leri kaldır, `RUN npm
   run build` + `RUN generate-build-provenance.mjs` + `RUN
   verify-build-provenance.mjs`'i container içine taşı.
2. `scripts/` altında Seçenek B'nin `docker create`/`cp`/`commit`/`rm`
   adımlarını yürüten küçük bir deploy-helper script'i ekle (veya mevcut
   P0 gate script'ine göm).
3. Full suite + build PASS doğrulaması (host/CI tarafında, değişmedi).
4. Yeni akışla bir kez candidate image build edilip, `image_label_match`
   ve `healthz`/`readyz`'in hâlâ PASS olduğu doğrulanır.
5. Sadece bundan sonra gerçek deploy (`1e12ac6` dahil) yapılır.
