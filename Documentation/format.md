# Temel İlke: Lineer Olay Akışı
Sahne, masada gerçekleşeceği **sırayla** akan bir **olay zinciridir**. Sheet'i yukarıdan aşağı okudukça oyun olay olay ilerler.
Modüller türe göre ayrı bölümlerde toplanmaz. Her olay, o anda gereken **her şeyi taşıyan bir kapsayıcıdır**:

- Bir olayda NPC ile karşılaşılıyorsa → o NPC bloğu olayın **altında**.
- Bir olayda yaratık/savaş varsa → stat bloğu olayın **altında**.
- O olaya ait Skill Checks, Yankı, Unexpected: → hepsi o olayın **altında**.

Renderer sayfayı ortadan 2 ye bölüp sağ kolon ve sol kolon olarak ayırır. Bu nedenle render seviyeleri önemlidir.
Render seviyeleri:
- `# ` Bu bloğun altındakiler bulduğu ilk ## bloğuna kadar full render yapar. Yani kolona ayırmaz.
- `## Olay: bla bla` Bu bloğun altındakiler sol kolonda renderlanır.
- `### NPC / Skill Checks / Item / Savaş / Obje …` Bütün kartlar **varsayılan olarak sol kolonda** renderlanır.

Kolon seçimi (`Side:`):
- Her kartın **varsayılanı sol kolondur**. Bir kartı sağ kolona almak için kartın içine `Side: R` satırı eklenir.
- `Side: L` açıkça soldur (varsayılan, yazmaya gerek yok). Değer büyük/küçük harf duyarsızdır ve yalnızca ilk harf önemlidir (`R`/`Right` → sağ, gerisi → sol).
- `Side:` satırı ekranda görünmez; tüm kart türlerinde çalışır (NPC, Item, Ability, Obje, Savaş, STD, Unexpected, Skill Checks).

```md
### Obje: Sandık        -> sol kolon (varsayılan)

### Obje: Sandık
Side: R                 -> sağ kolon
```

# CHATGPT İÇİN ÖNEMLİ:
* koymak yerine - kullanarak pointler yap.

---

# Master Template
Aşağıdaki şablon kopyalanıp doldurulur. Olmayan modüller silinir.

```md
# Sahne Adı
Tahmini Süre: X dk

Öz: Tek cümlelik kanca — bu sahnede ne oluyor.

Amaç:
- Amaç 1
- Amaç 2

---

## Olay 1: Olay Adı
> Oyunculara senin ağzından okunacak betimleme; ikinci şahıs, "...görürsünüz". Tam yazılır, özetlenmez.
- İlk anda söylenmeyen ek bilgi (araştırınca/sorunca ortaya çıkar)
`Bu olayın amacı / gizli gerçek. (lore ref)`

### NPC: İsim
Kişilik:
- Özellik
- Özellik
İlk Diyalog:
> "Tek nefeste söylenen replikler tek satırda. İkinci cümle de burada."
Sorarsa:
> "Tam cevap."
Bildikleri:
- Bildiği şey
Bilmedikleri:
- Bilmediği şey
`NPC'nin amacı.`

### Savaş: Düşman Adı
> Oku: ilk görünüş / savaşın başlangıcı.
Stat:
- AC X | HP Y | Hız Z
- Atak: ... +N, hasar
- Zayıf kurtarma: ...
Taktik:
- Nasıl davranır
`Savaşın amacı. (lore ref)`

### Skill Checks
- Passive Perception:
> 10: Herkesin fark edebileceği bilgi
> 15: Dikkatli olanların fark ettiği bilgi
- İlk Bakışta:
> Aktif olarak bakan herkesin görebileceği bilgi
- Investigation:
> 15: Ek bilgi
> 20: Daha detaylı bilgi
- Arcana:
> 20: Büyüsel bilgi
- Speak with Dead:
> Konuşma metni veya "çalışmaz, çünkü X."

### Yankı
> Geçmişe ait, tüm oyuncuların gördüğü görüntü. Tam yazılır.
`Oyuncuların ne anlaması / anlamaması gerektiği.`

### Unexpected:
- Oyuncular X yaparsa: ...
- Savaşı atlarsa / kaçarsa: ...
Başarısız check:
- <Skill> başarısız: ilerleme engellenmez, yüzeysel bilgi.

---

## Olay 2: Olay Adı
> ...
`...`

---

## Gizli Rol Notları
Kültist:
- Bu sahnedeki fırsat / mühür.
- `Kırarsa otomatik başarılı, zar atma.`
Cult Hunter:
- Engelleme fırsatı.
`Açık ihanet değil, manipülasyon teşvik et.`

---

# Modüller

## Başlık Bloğu
Her sahnenin başında bulunur:
- `# Sahne Adı`
- `Tahmini Süre: X dk`
- `Öz:` tek cümlelik kanca — DM sahneyi açmadan ne olduğunu bilir.

## Amaç
Sahnenin başında, kısa maddeler halinde. Bu sahne neyi başarmalı.

## Olay
Lineer gövdenin temel birimi. `## Olay N: Ad` ile sıralı yazılır. Her olay:
- `Göster:` bloğu:
  - İlk satır blockquote (`>`) — oyunculara senin ağzından okunacak betimleme (ikinci şahıs, "...görürsünüz").
  - Altındaki `-` maddeler — ilk anda söylenmeyen ek bilgi (araştırınca/sorunca ortaya çıkar) veya DM'e portre/oynatma notu.
- Altında, o olaya ait nested alt-bloklar (NPC, Savaş, Skill Checks, Yankı, Beklenmedik).
- `gizli not.` 

## NPC
Karşılaşıldığı olayın altında (`### NPC: İsim`). Alan etiketleri:
-`Kişilik`
- `İlk Diyalog` (`>`)
- `Sorarsa` (`>`)
- `Bildikleri`
- `Bilmedikleri`
- `DM:` amaç

Diyalog konuları, NPC bloğunun altında düz `Başlık:` satırlarıyla yazılır
(`####` kullanma). Yukarıdaki beş alan etiketi dışındaki her `Başlık:` satırı
bir diyalog alt-kartı olarak gösterilir. Altına o konunun soruları (`-`) ve
cevapları (`>`) gelir. Örnek:
```md
### NPC: Destek Birimi
Kişilik:
- Resmî, kısa cevap verir.
İlk Diyalog:
> "Destek Birimi göreve hazır."
Görevi:
- "Görevin ne?"
> "Koruyuculara destek sağlamak."
Yapı:
- "Burası neresi?"
> "Yetkili Salonu."
```

## Savaş Bloğu
Savaşın olduğu olayın altında (`### Savaş: Düşman`). Kompakt tutulur — yalnızca oynatmak için gerekenler:
- Açılış okuma metni (`>`)
- `Stat:` AC / HP / Hız / Atak / Zayıf kurtarma
- `Taktik:` düşman nasıl davranır
- `DM:` savaşın amacı

## Skill Checks
İncelenen şeyin altında katmanlı yazılır:
```md
### Skill Checks
- Passive Perception:
> 10: Herkesin fark edebileceği bilgi
> 15: Dikkatli olanların fark ettiği bilgi
- İlk Bakışta:
> Aktif olarak bakan herkesin görebileceği bilgi
- Investigation:
> 15: Daha detaylı bilgi
> 20: Çok detaylı bilgi
- Arcana:
> 20: Büyüsel bilgi
- INT:
> 15: Saf zekâ/hatırlama check'i (skill belirtmeden)
- SWD:
> Konuşma metni veya "çalışmaz, çünkü X."
```

### İkonlar ve kısaltmalar
- Standart bir D&D skill'i yazınca satırın başına otomatik olarak **ana stat ikonu** gelir: Arcana/History/Investigation/Nature/Religion → 🧠 (INT), Insight/Perception/Medicine/Survival/Animal Handling → 👁 (WIS), Athletics → 💪 (STR), Acrobatics/Stealth/Sleight of Hand → 🏃 (DEX), Deception/Intimidation/Performance/Persuasion → 💬 (CHA). Passive Perception ve İlk Bakışta → 👁.
- **Ana stat check'i** doğrudan yazılabilir: `STR:` `DEX:` `CON:` `INT:` `WIS:` `CHA:`. Render edilirken tam isimle (Strength, Dexterity, …) ve ability ikonuyla gösterilir.
- **Bilgi büyüleri kısaltmayla yazılabilir** (uzun isim yer kapladığı için tercih edilir) ve hep kısa render edilir:
  - `SWD:` = Speak with Dead → 💀 SWD (değerler DC değil, sıra numarasıdır)
  - `DT:` = Detect Thoughts → 🧠 DT
  - `SWA:` = Speak with Animals → 🐾 SWA
  - Tam isim de yazılabilir; render yine kısa forma çevirir.

SWD/DT/SWA gibi bilgi büyüleri de bu blokta yer alır (Unexpected:'da değil).
Başarısız sonuçlar `Unexpected:`'da ele alınır.

## Yankı (Echo)
Geçmiş görüntüleri. Tetiklendiği olayın altında. Tam okuma metni (`>`) + `DM:` not. Yankılar asla doğrudan gizli rolü işaret etmez.

## Gizli Rol Notları
Kültist / Cult Hunter için o sahneye özel tetikler. Genel mekanik `Tema.md`'de; burada yalnızca bu sahnedeki fırsat/mühür. Sahne geneline yayılıyorsa sahne seviyesinde, tek olaya bağlıysa o olayın altında.

## item (Eşya / Loot)
Bir eşya `### item: Ad` veya `### Item: Ad` ile yazılır. Alanlar: `Tür:`, `Nadirlik:` (1=Common, 2=Rare,
3=Epic), açıklama (`>`) ve `Özellikler:` listesi. Varsayılan olarak item sol kolonda,
ayrı bir kart olarak renderlanır. `Side: R` satırı item'ı sağ kolona alır.

- `Yapışık: T` (İngilizce eşdeğeri: `Combine: T`) → item'ı **bir önceki objeye** (veya bir önceki yapışık item'a)
  yapıştırır: item, objenin bulunduğu kolona iner ve aralarında boşluk/köşe kalmadan
  tek bir kesintisiz blok gibi görünür. Loottan çıkan eşyaları kaynağıyla bağlamak için.
  Flag yalnızca item gerçekten bir objenin/yapışık item'ın **hemen altındaysa** etki eder;
  arada başka kart veya yeni olay varsa item normal şekilde ayrık (sağ kolonda) kalır.
  Truthy değerler: `T`, `true`, `evet`, `1`, `yes`. Flag satırı ekranda görünmez.

```md
### Obje: Sandıklar
Checks:
- Lockpick:
> 12: Sandık açılır.
Loot:
- Permatik traş eldiveni

### item: Permatik Traş Eldiveni
Tür: Eldiven
Nadirlik: 2
Yapışık: T
> Traş olurken günü kurtaracak olan çılgın eldiven
Özellikler:
- Karizmaya +1 (maks 18).
```

## ability (Skill / Spell / Passive / Effect)
Bir yetenek `### Skill: Ad`, `### Spell: Ad`, `### Passive: Ad` veya `### Effect: Ad` ile
yazılır. Kullanılan **anahtar kelime kartın etiketi olur** (`### Spell: Alev Topu` → `SPELL`).
Alanlar:
- `Tür:` (`Type:`) kategori
- `Maliyet:` / `Menzil:` / `Bekleme:` (`Cost:` / `Range:` / `Cooldown:`) → meta satırları
- `Nadirlik:` (`Rarity:`) (1=Common, 2=Rare, 3=Epic) → renkli rozet
- açıklama (`>`)
- `Özellikler:` (`Properties:`) listesi
- `Lore:` → altındaki içerik read-aloud (`>`) gibi ayrı bir lore panelinde gösterilir

Tüm alan etiketleri Türkçe veya İngilizce yazılabilir.

Görsel tema item kartından farklıdır (indigo/mor arcane). Varsayılan olarak yetenek sol
kolonda ayrı bir kart olarak renderlanır; `Side: R` ile sağ kolona alınır.

- `Yapışık: T` (İngilizce eşdeğeri: `Combine: T`) → yeteneği **bir önceki item'a, objeye**
  (veya bir önceki yapışık yeteneğe) yapıştırır: yetenek host'un bulunduğu kolona iner ve
  aralarında boşluk/köşe kalmadan tek bir kesintisiz blok gibi görünür. Bir eşyanın verdiği
  büyü/pasifi kaynağıyla bağlamak için. Item'ın objeye yapışması ile aynı mekanik. Flag
  yalnızca yetenek gerçekten host'un **hemen altındaysa** etki eder.

```md
### item: Alev Asası
Tür: Asa
Nadirlik: 2
Yapışık: T
> Ucu hâlâ sıcak.

### Spell: Alev Topu
Tür: Evokasyon
Maliyet: 1 Aksiyon
Menzil: 45m
Nadirlik: 3
Yapışık: T
> Avucunda bir alev küresi belirir.
Özellikler:
- 8d6 ateş hasarı (Dex yarısı).
Lore:
> Eski Lora rahiplerinin savaş büyüsü.
```

## Unexpected: (Contingency)
Sapmalar ve başarısız check sonuçları:
- "Oyuncular X yaparsa: ..."
- "Savaşı atlarsa / kaçarsa: ..."
- Başarısız check → ilerleme engellenmez, yüzeysel bilgi verilir.

---

# Kurallar

## 1. Okuma Metni Tamlığı (öncelik)
DM'in oyunculara okuyacağı her şey blockquote (`>`) ile **tam** yazılır, asla özetlenmez.

Yanlış:
```md
> Burada lanet hakkında bir şeyler söyle.
```
Doğru:
```md
> Yol kenarında yakın zamanda ölmüş bir adam yatıyor. Boğazı kendi eliyle kesilmiş gibi.
```
Doğaçlama serbest olan yerler `DM:` notuyla işaretlenir, blockquote yapılmaz.

## 2. Lineer Olay Akışı
Sahne olay olay, sırayla ilerler. NPC/Savaş/Skill Checks, ait olduğu olayın **altına** gömülür; türe göre ayrı bölümde toplanmaz.

## 3. Bilgide Uzun Paragraf Yasak (DM anlatımı serbest)
Bilgi kısa maddeyle verilir; DM anlatımında paragraf serbesttir.

Kötü:
```md
Köylüler uzun süredir burada yaşamaktadır ve...
```
İyi:
```md
- Köylüler korkuyor.
- Vakalar son 2 ayda arttı.
```

## 4. Lore Ayrı Dosyada
Lore `Lore.md`'de tutulur. Sheet'te yalnızca oynatmalık bilgi olur; geçtiği yerler parantez içinde lore başlık numarasıyla referanslanır (örn. `(7.2.1)`).

## 5. DM Notları = Inline Code
DM'e özel gizli bilgiler, sahnenin gerçek amacı veya ileride çıkacak gerçekler inline code (`` ` ``) ile yazılır.
```md
`Gerçek: Defineciler laneti başlattı.`
```
Amaç: DM notlarını oyuncuya okunacak metinden ayırmak ve gizli gerçekleri hızlı fark etmek. Kısa tutulur.

## 6. Stat Bloğu Kompakt
Savaş bloğunda yalnızca oynatmak için gerekenler bulunur: AC, HP, Hız, Atak, zayıf kurtarma, taktik. Tam stat bloğu şişirilmez.

## 7. Gizli Rol Notları Sahneye Özel
Genel mekanik `Tema.md`'de. Sheet'te yalnızca o sahnedeki tetik/fırsat yazılır.

## 8. Tahmini Süre ve Amaç
Her sahnenin başında bulunur. Amaçlar kısa madde.

## 9. Az Enter
Gereksiz boş satır koyma.

Doğru:
```md
Bildikleri:
- Bildiği şey
`NPC'nin amacı.`
```
Yanlış:
```md
Bildikleri:

- Bildiği şey

`NPC'nin amacı.`
```

## 10. Tek Bakışta Oynatılabilirlik
Bir olay okunurken DM 30 saniye içinde anlayabilmeli: ne oluyor, kiminle karşılaşılıyor, statları ne, hangi bilgi veriliyor, olay nasıl bitiyor. Formatın temel amacı budur.

## 11. Replik Satırları
Aynı anda / tek nefeste söylenen replikler veya aynı betimleme **tek bir `>` satırında** birleştirilir. Her cümleyi ayrı `>` satırına bölme; alt alta kırılır ve parçalı görünür.

Kötü:
```md
> "Bu hafta üçüncüsü."
> "Önce karısını öldürmüş."
> "Sonra kendini."
```
İyi:
```md
> "Bu hafta üçüncüsü. Önce karısını öldürmüş. Sonra kendini."
```
Yalnızca bilinçli bir duraklama veya ayrı paragraf gerekiyorsa araya boş `>` satırı koyarak ayır:
```md
> Taş kapı ağır bir sesle açılır.
>
> İçeride geniş bir oda görürsünüz.
```

---

# Kısa Örnek

```md
# Koridor
Tahmini Süre: 10 dk
Öz: İlk savaş; lanetin gerçek olduğu kanıtlanır.
## Amaç
- İlk aksiyonu yaşatmak
- Lanetin gerçek olduğunu göstermek
---

## Olay 1: Lanetli Köylü
> Dar, nemli koridorda kirli ve bitkin bir köylü kendi kendine anlaşılmaz şeyler mırıldanır. Sizi görünce üstünüze atılır.
- Açlıktan tükenmiş; gözlerinde yoğun korku var.
`Amaç kaynak tüketmek değil. Lanetin insanları etkilediğini göster. (5.2.1)`

### Savaş: Lanetli Köylü
Stat:
- AC 10 | HP 11 | Hız 9m
- Atak: Pençe +3, 1d6 fiziksel
- Zayıf kurtarma: Bilgelik
Taktik:
- Düşünmeden saldırır, kendini korumaz.
`Savaş kısa sürmeli.`

### Skill Checks
- İlk Bakışta:
> Hasta görünmüyor; uzun süredir aç ve uykusuz.
- Insight:
> 12: Bu bir hastalık değil; zihni dışarıdan bozulmuş.

### Unexpected:
- Oyuncular konuşturmaya çalışırsa: konuşamaz, yalnızca mırıldanır.
- Köylüyü etkisiz bırakıp bağlarlarsa: kısa süre sonra yine saldırmaya çalışır.
```
