# Knowledge Base ZIP Comparison

Date: 2026-08-16
Source ZIP: `now-os-egitim-paketi.zip`
Source files: 12 text files (`00_master_now_os_egitim_metni.txt` through `11_owner_dinamik_egitim_yonlendirme.txt`)

This is a comparison only. No ZIP content was added to the knowledge bank.

## Status Legend

- **YENI**: materially absent from the current knowledge bank.
- **AYNI**: current content covers the rule without a detected conflict.
- **CELISIYOR**: the ZIP and current knowledge bank contain different operational values or behaviors; owner decision is required.

## Comparison Table

| Baslik | ZIP'te yazan: ozet ve kritik degerler | Mevcut bilgi bankasinda | Durum | Siniflandirma onerisi |
|---|---|---|---|---|
| Indirme linkleri ve davet kodlari | Layla/NIVI icin tek dogrulanmis yonlendirme linki: `https://api.pocketliveapp.com/api/code/invite/redirect?code=G-8UNHAWUFC`. Amar icin davet URL'si ve `xvrgZkf6`; TanChat/TanStar magazada aranir ve `X3XREZ`; Linky `M9W5B8`; Soyo `3997`; Timo `VVXVUD`. Cihaz bazli kesin link uydurulmaz. | Uygulama tablosunda kodlar mevcut; kurulum adimlarinda uygulama adlari/kodlar var. `official_url` hucreleri bos. | **YENI** | information + constraint |
| Ajans kodlari ve kontrol ekranlari | Kodlar buyuk/kucuk harfe duyarlidir. Layla/NIVI: Ben > Ajans > Ajansa Katil, `8UNHAWUFC`, Arda/Now Ajans gorunmeli; yaklasik 30 dakika bekleme ve ikinci deneme. TanChat: Bakiyem/Veri, Now Ajans. Amar: Ben > uc cizgi > Ajans, gerekirse `10621`, ekran goruntusu. Linky otomatik; Soyo `3997` ve yonetim onayi; Timo otomatik. | Genel kurulum kaniti, uygulama kodlari, Now Ajans gorunurlugu, tek retry ve yonetim devri var. ZIP'in uygulama-ozel ekran yollarinin ve bekleme ayrintilarinin tamami tek yerde gorunmuyor. | **YENI** | constraint |
| Odeme kurallari | Gunluk cekim; 1-3 is gunu, hafta sonu haric. Cekim iptal edilemez; yanlis tutar beklenir; reddedilirse bakiye iade. Minimum/kesinti uygulama ekranindan; sabit komisyon yok. Banka hesabi temel yontem, alternatifler onerilmez; 3 is gunu asilirsa ekran goruntusu ve yonetim devri. | 1-3 is gunu, hafta sonu, IBAN duzeltme, iptal edilememe, minimum/kesinti ekran kontrolu, garanti vermeme ve teknik destek akisi var. Mevcut `payment_policy` ayrica “gunluk veya anlik” ifadesini kullaniyor. | **CELISIYOR**: ZIP “gunluk”, mevcut metin “gunluk veya anlik” diyor. | constraint |
| Egitim akisi | Kurulum + ajans tamamlaninca baslar. Genel egitim botta; uygulama egitimi ayri. Ucretsiz, sinirsiz destek; tek oturum genellikle yaklasik 1 saat, kesin sure siniri yok. Yazili/sesli/video/birebir olabilir. Anladim denince sinav gerekmez. Guncel egitim kisisi owner tarafindan belirlenir. | Egitim kapisi, uygulama-ozel egitim ayrimi, egitim formati ve owner uzerinden dinamik yonlendirme mevcut. ZIP'teki ucretsiz/sinirsiz destek, yaklasik 1 saat ve sinav gerekmemesi ayrintilari eksik. | **YENI** | training |
| Destek, ban ve teknik sorunlar | Hata ekran goruntusu istenir; uygulama, Uye ID, kullanici adi ve kod kontrol edilir. Iki dogru denemeden sonra yonetim. Yanlis ajans, ban, hesap erisimi ve teknik konuda hesap asma/yeni kimlik/izinsiz taklit onerilmez. Emin olunmayan bilgi uydurulmaz. | Ekran goruntusu, Uye ID/kullanici adi, kod/ajans kontrolu, ban ve teknik konularda insan devri, uydurmama ve hassas veri kurallari var; ZIP'in ayrintili iki-deneme ve ban alt akisleri eksik/ozet. | **YENI** | constraint |
| Ayrilma/vazgecme sureci | Aday istedigi zaman durur/ara verir/uygulamayi silebilir; silmek ajans baglantisini kaldirmaz. Ajans cikisi verilmez. Eski bakiye yeni hesaba aktarilmaz. Acik istemeyene ikna, takip, kurulum veya kod gonderilmez. | Takip/kapanis ve kurulum sinirlari var; ancak uygulamayi silme, bakiye aktarilmamasi, ajans cikisi ve yeniden donus davranisi ayri bir bolum olarak yok. | **YENI** | constraint |
| Erkek/kadin aday yonlendirme motoru | Erkek: 18-30, genel olarak Layla/NIVI; Layla kullanildiysa sartli Amar; uygunluk yoksa alternatif yok. Kadin: 18-40 normal; 40-50 deneyimli aday degerlendirilebilir; 50+ kapatilir. Kadin sirasi ve tercihleri: Amar, Layla, TanChat, Soyo, Timo, Linky; deneyim/iletisim tercihiyle degisir. | Mevcut uygunluk: erkek 18-30, kadin 18-40. Routing matrix sabit sira olmadigini; cihaz/tercih/deneyim ile oneriyi ve ikincil uygulamalari soyluyor. | **CELISIYOR**: ZIP, 40-50 deneyimli kadin icin istisna ve daha belirgin cinsiyet bazli sira getiriyor; mevcut kadin ust siniri 40 ve esnek matrix ile farkli. | constraint |
| Ilk mesaj ve acik onay akisi | Ilk mesaj yalnizca yas, cinsiyet, gunluk sure; uygulama/kod/link/gecmis uygulama yok. Is anlatimindan sonra acik onay. “Evet/uygun/tamam” tek basina kurulum izni degil; “baslayalim”, “kuruluma gecelim”, “uygulamayi gonder” gibi acik baslangic ifadeleri gecerli. | Ilk temas siniri ve kurulum izni bolumleri mevcut; acik baslangic geregi ve uygulama/kod/kurulumun erken verilmemesi uyusuyor. ZIP'teki tam ornek ifade katalogu ve ilk mesajdaki gunluk sure vurgusu mevcut metinde ayni ayrintiyla yok. | **YENI** | constraint |
| Gecmis uygulama kontrolu | Ilk mesajda sorulmaz; acik onaydan sonra sorulur. Kullanilan uygulama, hesap, ajans ve ban durumu kontrol edilir. Kullanilmis uygulama otomatik onerilmez; kadin adaylarda Amar/Layla/TanChat gecmisi ayri degerlendirilir; sonraki sira Soyo/Timo/Linky. | Gecmis uygulama bilgisi, uygulama bagimsizligi, tekrar sormama ve routing matrix mevcut. ZIP'in uygulama bazli karar agaci ve kadin aday istisnalari tam olarak ayri bir kaynakta yok. | **YENI** | constraint |
| Kota, ciddiyet ve sessiz aday takibi | Her uygulamada gunluk 5 dolar hedefi; kurulum/ajans sonrasi anlatilir, garanti degildir. Ilk hafta toleransli, sonra duzenlilik beklenir. Sessiz adayda 2 saat sonra yalnizca bir takip; istemeyene tekrar yazilmaz. | Gunluk sure, performans/aktiflik, garanti vermeme ve israrci takip etmeme var. Sabit 5 dolar hedefi, ilk hafta toleransi ve 2 saatlik tek takip zamanlamasi mevcut bilgi bankasinda yok. | **YENI** | constraint |
| Owner uzerinden dinamik egitim yonlendirmesi | Owner yeni egitimci/kurulum/uygulama bilgisini verdiginde guncel kaynak kazanir; sabit numara varsayilmaz. Kurulum + ajans + secilen uygulama tamamlaninca ilgili egitim kisisi; yetki/insan karari gerektiren durum yonetim devri. | Owner dinamik egitim bolumu, kurulum kapisi, secilen uygulamaya gore egitim ve insan devri mevcut. | **AYNI** | constraint |

## Detected Conflicts

### 1. Kadin aday ust yas siniri

- ZIP: 40-50 yas arasi deneyimli kadin aday degerlendirilebilir; 50 ustu kapatilir.
- Current knowledge bank: kadin adaylar 18-40 araliginda degerlendirilir; ust sinir disinda uygulama/kod/kurulum verilmez.
- Impact: eligibility and routing behavior directly differs. Owner must choose one policy before activation.

### 2. Cekim talebi sikligi

- ZIP: para cekme talebi gunluk verilebilir.
- Current `payment_policy`: “gunluk veya anlik” cekim talebi ifadesi bulunuyor.
- Impact: candidate'e cekim talebi ne zaman verilebilecegi konusunda farkli cevap gidebilir. Owner karar vermeli.

### 3. Cinsiyet bazli yonlendirme kati sirasi

- ZIP: erkek adaylarda genel olarak Layla/NIVI, kadinlarda belirli uygulama sirasi ve tercih dallari.
- Current routing matrix: sabit tek sira yok; tercih, deneyim, cihaz ve performansa gore oneriliyor.
- Impact: ZIP davranis motoru olarak aktarilirsa mevcut esnek routing mantigini daraltabilir. Bu, bilgi degil davranis kisitidir ve ayri owner onayi gerektirir.

### 4. Amar kodu reddedilirse sonraki adim

- ZIP: fotograf sonrasi tekrar; yine olmazsa kodsuz devam edilebilir.
- Current setup/support material: dogrulama basarisizligi ve tekrar denemesi sonrasi yonetim devri/fail-closed vurgusu var; kodsuz devam davranisi net olarak ayni sekilde yazili degil.
- Impact: kurulum guvenligi ve ajans baglantisi kaniti etkilenebilir. Owner, kodsuz devam edilip edilemeyecegini kesinlestirmeli.

## Owner Review Notes

- **Constraint olarak ayri onay gerektirenler:** yas/cinsiyet istisnalari, uygulama sirasi, kurulum retry/kodsuz devam, odeme sikligi, 5 dolar hedefi ve sessiz aday takip zamanlamasi.
- **Information olarak degerlendirilebilecekler:** dogrulanmis linkler, ekran yolu isimleri, uygulama magazasi arama davranisi, egitim formatlari ve uygulama ekranlarinin adlari.
- **Training olarak tutulmasi gerekenler:** genel/uygulama-ozel egitim anlatimlari, formatlar, sadeleştirilmis tekrar aciklamalari ve owner'in guncel egitim yonlendirmesi.
- ZIP'te bulunan kodlar ve linkler bu raporda karsilastirma amaciyla yazilmistir; hicbiri bu islemle aktif bilgi bankasina alinmamistir.
