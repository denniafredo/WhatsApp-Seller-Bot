# WhatsApp Bot + Sinkronisasi Harga Shopee

Dua bagian yang berjalan terpisah:

1. **Bot WhatsApp** (`npm start`) — auto-reply menu, price list, lokasi, pembayaran, dan rekap pesanan ke Google Sheet.
2. **Sinkronisasi harga Shopee** (CLI) — tarik produk dari Shopee ke Google Sheet, isi harganya dari tab "Harga Terbaru", lalu push balik ke Shopee.

Bagian 2 **sengaja tidak dipasang di bot WhatsApp**. Ubah harga itu langsung kena pembeli, jadi hanya bisa dijalankan manual dari terminal.

---

## Setup awal

```bash
npm install
cp .env.example .env
```

Isi `.env`, lalu jalankan botnya:

```bash
npm start
```

Untuk setup di Ubuntu server (Chrome, dependency Puppeteer), lihat [UBUNTU.md](UBUNTU.md).

---

# Bagian 1 — Bot WhatsApp

`npm start` akan menampilkan QR di terminal. Scan sekali; sesinya disimpan di `tokens/` jadi tidak perlu scan lagi.

## Yang dibalas otomatis

| Pemicu | Balasan |
|---|---|
| Chat pertama dari nomor baru | Menu sambutan (list message) |
| `PL box`, `PL Box Warna`, `PL Thermal Bag`, `PL Lembaran`, `PL PE foam`, `PL Ice Pack`, `PL Ice Gel`, `PL Lem Sterofoam`, `PL Pemotong Sterofoam`, `PL Palet Plastik` | Gambar price list dari `assets/` |
| `qris` | Gambar QRIS |
| `transfer` | Info rekening |
| Pertanyaan lokasi/alamat | Alamat toko |
| Pertanyaan lowongan kerja | Diabaikan (tidak dibalas) |

## Rekap pesanan grup

Di dalam grup, **mention bot** lalu tulis salah satu:

- `rekap` atau `rekap hari ini`
- `rekap kemarin`

Bot membaca 300 pesan terakhir, mengisi tab "Template pembayaran" di Google Sheet, lalu mengirim balik file rekap + total.

## Noise reduction video

Kirim video ke **chat pribadi** bot, lalu picu dengan salah satu cara:

- kirim videonya langsung dengan caption `noise`
- atau reply video yang sudah terkirim lalu tulis `noise`

Kata pemicunya sekaligus menentukan engine:

| Kata pemicu | Engine |
|---|---|
| `noise`, `denoise`, `kurangi noise`, `hilangkan noise` | `voicecleaner` |
| `lokal` | `deepfilternet` |
| `bersihkan suara`, `bersihin suara` | ikut `VIDEO_DENOISE_ENGINE` |

Pemetaannya ada di `triggerRules` pada [videoNoiseTrigger.js](src/videoNoiseTrigger.js) — menambah kata pemicu baru atau mengarahkannya ke engine lain cukup satu baris. Frasa terpanjang dicocokkan lebih dulu, jadi `kurangi noise` tidak tertutup oleh aturan `noise`.

Bot membersihkan **noise audio** (desis, hum, AC, kipas, mobil lewat) dengan model AI yang jalan **lokal tanpa cloud**. Video stream di-`copy` tanpa re-encode, jadi **kualitas gambar tidak berubah sama sekali** — terbukti bit-exact lewat perbandingan MD5 stream video input dan output.

Throughput terukur: `deepfilternet` ~4,5x realtime, `arnndn` ~45x realtime.

Model ada di `assets/sh.rnnn` (~290KB, public domain, dari [GregorR/rnnoise-models](https://github.com/GregorR/rnnoise-models), varian *Recording noise x Speech signal*).

Engine bisa ditukar lewat `VIDEO_DENOISE_ENGINE`:

| Nilai | Isi |
|---|---|
| `arnndn` (default kode) | AI/RNNoise, satu pass ffmpeg. Butuh `assets/sh.rnnn`. |
| `deepfilternet` | Deep learning modern, binary terpisah. Butuh `bin/deep-filter`. |
| `afftdn` | Filter DSP klasik, tanpa AI: `highpass` + `afftdn` + `anlmdn`. |

#### voicecleaner.ai

Layanan web tanpa API, jadi audionya bolak-balik lewat sesi browser headless. Alur yang dipakai sudah diverifikasi langsung ke situsnya:

```
1. buka voicecleaner.ai
2. klik "Log in to receive credits for free"     -> modal login
3. isi email + password, klik "Log In"           -> bukti sukses: modal tertutup
4. klik "My Device"                              -> input[type=file] baru muncul di sini
5. uploadFile(audio.wav)
6. tunggu panel "Select Enhancement Type"
7. klik chip "Remove Noise"
8. klik "Enhance Media"                          -> proses mulai
9. tunggu "Download Result" muncul (~15-25 s)
10. klik "Download Result" SEKALI               -> file turun via CDP
11. mux ulang ke video dengan -c:v copy
```

Terukur: **35 detik** total untuk video 8 detik (login 4s, upload 2s, proses 18s, unduh 4s, mux 4s). Video tetap bit-exact dan audio-video tetap sinkron.

**Wajib login dan memakai kredit harian.** Saat kuota habis, `VOICECLEANER_FALLBACK_ENGINE` (default `deepfilternet`) mengambil alih supaya pengirim tetap menerima video bersih, bukan pesan error. Kosongkan nilainya untuk mematikan fallback.

```
VOICECLEANER_EMAIL=
VOICECLEANER_PASSWORD=
VOICECLEANER_ENHANCEMENT=Remove Noise
VOICECLEANER_FALLBACK_ENGINE=deepfilternet
VOICECLEANER_HEADLESS=true
```

`VOICECLEANER_ENHANCEMENT` menerima nama chip lain yang tersedia di situsnya: `Remove Echo`, `Remove Wind Noise`, `Studio Sound`, `Normalize`, `Remove Background Audio`, `Remove Reverb`, dan lain-lain.

**Tiga jebakan yang membuat alur ini gagal secara SENYAP** — ketiganya kena selama pengembangan dan alasannya ditulis sebagai komentar di [voiceCleanerClient.js](src/voiceCleanerClient.js):

1. **Klik elemen terdalam, bukan pembungkus.** UI-nya nol elemen `<button>` — semuanya `div`. Event DOM merambat ke atas, jadi mengklik pembungkus tidak memicu handler anaknya. Pembungkus juga sering memuat dua kontrol sekaligus (`Download Result` + `Upload New File`).
2. **Kecuali pemicu login dan tombol submit**, yang justru `<button>` asli — di situ strategi terdalam malah memilih `span` dekoratif yang tidak bisa diklik. Tombol submit ada **5 tingkat** di atas kolom password.
3. **Bukti login bukan munculnya `input[type=file]`.** Input itu baru ada setelah "My Device" diklik, jadi menunggunya akan menggantung walau login sukses. Yang dipakai: hilangnya kolom password.

Kalau alurnya rusak karena situsnya berubah, sunting blok `selectors` di [voiceCleanerClient.js](src/voiceCleanerClient.js) dan jalankan dengan `VOICECLEANER_HEADLESS=false` untuk melihat browsernya.

#### DeepFilterNet

Engine terbaik yang terukur, dan yang dipakai di `.env` proyek ini. Bukan filter ffmpeg melainkan binary tersendiri, jadi jalannya tiga langkah: ekstrak WAV 48k → `deep-filter` → mux ulang dengan `-c:v copy`.

Binary tidak di-commit (`bin/` masuk `.gitignore`). Unduh dari [rilis DeepFilterNet](https://github.com/Rikorose/DeepFilterNet/releases/latest):

| Platform | Asset | Ukuran |
|---|---|---|
| Windows | `deep-filter-<versi>-x86_64-pc-windows-msvc.exe` | 25,7 MB |
| Ubuntu | `deep-filter-<versi>-x86_64-unknown-linux-musl` | 34,7 MB (static, tanpa dependency) |

Simpan sebagai `bin/deep-filter.exe` (Windows) atau `bin/deep-filter` (Linux, jangan lupa `chmod +x`), atau arahkan `DEEPFILTER_PATH` ke lokasi lain.

Flag `-D` selalu dipakai untuk mengompensasi delay STFT + lookahead model. Tanpa itu audio tertinggal 30 ms dari video (terukur); dengan itu 0 ms.

`VIDEO_DENOISE_ATTEN_DB` membatasi kekuatan penekanan (100 = penuh). Turunkan kalau hasilnya terasa tidak natural. `VIDEO_DENOISE_DFN_POSTFILTER=true` menambah penekanan tanpa menambah ketumpulan.

Kecepatannya ~4,5x realtime, jauh lebih lambat dari `arnndn` (~45x) tapi masih di atas kebutuhan.

Perilaku yang perlu diketahui:

- Batas ukuran input `VIDEO_MAX_MB` (default 16). Video lebih besar ditolak dengan pesan jelas.
- Bitrate audio hasil tidak pernah melebihi bitrate sumber, supaya file tidak membengkak lewat batas kirim WhatsApp.
- Video sekali-lihat (view-once) sengaja tidak diproses.
- Video tanpa track audio dibalas dengan penjelasan, bukan error.
- Proses dibatasi satu ffmpeg sekaligus; video berikutnya masuk antrean (maks 5 menunggu).
- Timeout `VIDEO_JOB_TIMEOUT_MS` (default 5 menit), lalu proses di-kill dan folder temp dibersihkan.
- Pesan biasa yang kebetulan memuat kata `noise` tanpa video tidak memicu apa-apa.

Butuh `ffmpeg` + `ffprobe` di server (`FFMPEG_PATH` kalau tidak di PATH). Di Ubuntu: `sudo apt install ffmpeg`.

### Menyetel kekuatan denoise

`mix` memasang plafon matematis pada hasil: bagian sinyal yang tidak disentuh dilewatkan apa adanya, jadi `mix=0.85` menyisakan 20·log10(0,15) = **-16,5 dB** noise berapa pun bagusnya model. Karena itu defaultnya `mix=1` plus satu lapis `afftdn` ringan (`VIDEO_DENOISE_POLISH`).

Terukur pada uji drive-by sintetis, di region tanpa suara orang:

| Setelan | Noise terbuang |
|---|---|
| `mix=0.85` (default lama) | 16,1 dB |
| `mix=1` | 39,9 dB |
| `mix=1` + polish `afftdn` | 51,9 dB |

**Batasnya:** angka di atas hanya berlaku saat tidak ada yang bicara. Ketika noise menimpa suara orang, semua setelan `arnndn` mentok di ~4 dB — itu batas arsitektur RNNoise, bukan salah setelan. Untuk kasus itu perlu model yang lebih baru seperti DeepFilterNet.

### Kalau suara terdengar berat/tumpul

Membersihkan lebih banyak noise selalu menumpulkan suara. Yang terukur pada pita 3-8 kHz:

| Setelan | Noise turun | Ketumpulan |
|---|---|---|
| `arnndn` + `POLISH=true` | 48,4 dB | -6,7 dB (terdengar berat) |
| `arnndn` (default) | 36,4 dB | -4,7 dB |
| `arnndn` + `TREBLE=3` | 36,0 dB | -3,3 dB |
| **`deepfilternet` + post-filter** | **37,4 dB** | **-1,8 dB** |
| `deepfilternet` | 30,8 dB | -1,8 dB |

DeepFilterNet menang di dua sisi sekaligus: membersihkan lebih banyak dari `arnndn` sekaligus 2,9 dB lebih tidak tumpul. Setelan `arnndn` mana pun harus memilih salah satu.

`VIDEO_DENOISE_POLISH` default `false` justru karena ketumpulan lebih terasa mengganggu daripada tambahan pembersihannya. Kalau masih terdengar berat, naikkan `VIDEO_DENOISE_TREBLE` ke `3` atau `5`.

### Membandingkan setelan pada video sendiri

```bash
npm run uji:noise -- path/ke/video.mp4
```

Menghasilkan 6 versi dengan setelan berbeda di folder yang sama, plus angka penurunan lantai noise. Angkanya untuk menyortir; keputusan tetap dengan mendengarkan, karena artefak berdenging atau suara hampa tidak muncul sebagai angka.

### Membandingkan hasil dari sumber mana pun

```bash
npm run banding:noise -- asli.mp4 hasil-a.mp4 hasil-b.mp4
```

Argumen pertama file asli, sisanya hasil dari engine atau layanan apa pun — termasuk file yang kamu proses manual di layanan web lalu diunduh. Berguna untuk membuktikan apakah suatu layanan benar-benar mengalahkan engine lokal sebelum repot mengintegrasikannya.

Metriknya memakai selisih persentil di dalam file yang sama, jadi **imun terhadap normalisasi loudness** — setiap layanan menormalisasi dengan caranya sendiri, dan perbandingan RMS absolut hanya akan mengukur makeup gain mereka, bukan kualitas denoise-nya.

Angka dari `banding:noise` **tidak sebanding** dengan angka dari `uji:noise`: yang pertama mengukur file jadi, yang kedua mengukur sebelum `loudnorm`.

---

# Bagian 2 — Sinkronisasi harga Shopee

## Alurnya

```
              Harga Terbaru (sheet master kamu)
                     │ kolom D = Harga Jual
                     │
                     ▼ map:harga
Shopee ──ambil:harga──►  Harga Shopee  ──sync:harga──► Shopee
                       kolom A, C          kolom B
```

```bash
npm run ambil:harga   # tarik daftar produk & varian dari Shopee (kolom A, C)
npm run map:harga     # baca "Harga Terbaru" -> isi kolom E, F, G lalu kolom B
npm run sync:harga    # push kolom B ke Shopee
```

`ambil:harga` dan `map:harga` **tidak menyentuh Shopee sama sekali** — cuma nulis ke sheet. Jadi sheet itu tempat kamu review sebelum push. Cuma `sync:harga` yang beneran mengubah harga di toko.

### Kapan pakai yang mana

**Cuma ganti harga?** Edit kolom D di "Harga Terbaru", lalu:

```bash
npm run map:harga
npm run sync:harga
```

Nggak perlu `ambil:harga`. Mapping dihitung ulang dari nama produk di kolom A, jadi harga baru langsung terbaca tanpa menarik ulang 73 produk dari Shopee.

**Ada produk atau varian baru di Shopee?** Baru jalankan `ambil:harga` dulu, karena kolom A dan C perlu diisi ulang.

## Struktur tab "Harga Shopee"

Tab ini **dibuat ulang penuh** setiap `ambil:harga`. Jangan simpan catatan apa pun di sini.

| Kolom | Isi | Diisi oleh |
|---|---|---|
| A | Nama produk lengkap dari Shopee | `ambil:harga` |
| B | **Harga yang akan dipush** | `map:harga`, atau kamu ketik manual |
| C | `item_id` atau `item_id:model_id` | `ambil:harga` — jangan diubah |
| D | Status hasil sync | `sync:harga` |
| E | Label ringkas (biar nama panjang kebaca) | `map:harga` |
| F | Harga jual hasil mapping dari "Harga Terbaru" | `map:harga` |
| G | Asal harganya (baris mana di "Harga Terbaru") | `map:harga` |

Kolom E, F, G **selalu ditulis ulang** setiap `map:harga`, jadi kolom F tidak pernah basi terhadap "Harga Terbaru".

Produk bervariasi jadi **satu baris per varian**, dengan `item_id:model_id` di kolom C. Kamu tidak perlu mengetik itu manual.

Contoh satu baris:

| A | B | C | E | F | G |
|---|---|---|---|---|---|
| `[Khusus Luar Semarang] BOX ALUMINIUM + LAKBAN COKLAT / Box Frozen Food / ...` | 340000 | `42468494667:355701486638` | `LUAR · Lakban Coklat +AL · Panjang Biasa 120x43x32` | 340000 | `Harga Terbaru!D147 · Sterofoam Box + Lakban + Aluminium (Luar Kota) › Panjang Biasa` |

**Kolom E** ada supaya nama produk 200 karakter bisa dibaca sekilas. **Kolom G** supaya setiap harga bisa dilacak asalnya.

## Cara mapping bekerja

Nama produk Shopee sudah memuat semua kunci untuk mencari harga di "Harga Terbaru":

```
[Khusus Luar Semarang] BOX ALUMINIUM + LAKBAN COKLAT / ... - 120x43x32, Cokelat + AL
 └─ Luar Kota           └─ + Aluminium  └─ pakai lakban  └─ ukuran   └─ warna  └─ + AL
```

Dipetakan ke section di "Harga Terbaru" seperti ini:

| Nama produk Shopee | Section "Harga Terbaru" |
|---|---|
| `Sterofoam Box POLOS` | Sterofoam Box |
| `Sterofoam Box Lakban` (Cokelat) | Sterofoam Box + Lakban |
| `BOX ALUMINIUM + LAKBAN COKLAT` | Sterofoam Box + Lakban + Aluminium |
| `BOX ALUMINIUM + LAKBAN WARNA WARNI` | Sterofoam Box + Lakban Warna + Aluminium |
| Ada `[Khusus Luar Semarang]` | ditambah ` (Luar Kota)` |
| Ada `BEKAS` / `SECOND` | Sterofoam Box Bekas |

Lalu barisnya dicari dari **ukuran** di nama varian (`120x43x32`). Untuk `73x41x30` yang muncul dua kali, dibedakan pakai kata `Biasa` / `Keras`.

Produk **non-box** (Ice Pack, PE Foam, Lakban, Therma Pack Bag, dll) tidak punya pola, jadi dipetakan lewat aturan eksplisit di [src/hargaTerbaruAliases.js](src/hargaTerbaruAliases.js). Tambah produk baru? Tambah aturan di situ.

Aturannya sengaja eksplisit, bukan hasil pencocokan mirip-mirip. Kalau produk baru belum ada aturannya, hasilnya "gagal resolve" (kolom F kosong) — bukan harga salah yang diam-diam ke-push.

## Kalau harga tidak termapping

Kolom F kosong, kolom G isinya `manual` atau `? <alasan>`:

- **`manual`** — produknya memang tidak ada di "Harga Terbaru" (mis. Keranjang Buah, Kardus, Ex Kado). Ketik harganya sendiri di kolom B. `map:harga` tidak akan menimpanya.
- **`? harga jual kosong di Harga Terbaru!D7`** — barisnya ada, tapi kolom Harga Jual di "Harga Terbaru" masih kosong. Isi dulu di situ.
- **`? tidak ada item yang cocok di section "..."`** — variannya belum ada di "Harga Terbaru" (mis. Foil Roll 10 meter padahal cuma ada 3/5/20 m).
- **`? ambigu di section "..." (baris X & Y)`** — aturannya kena lebih dari satu baris. Perlu diperbaiki di `hargaTerbaruAliases.js`.

## Membaca kolom D setelah sync

| Kolom D | Arti |
|---|---|
| `OK 129.000 -> 141.000 · 28 Jul, 09.15` | Berhasil diubah |
| `SAMA 141.000 · 28 Jul, 09.15` | Harga sudah sama, API Shopee tidak dipanggil |
| `GAGAL <alasan> · 28 Jul, 09.15` | Gagal, alasannya dari Shopee |

Baris tanpa `item_id` di kolom C dilewati dan kolom D-nya tidak ditulis.

---

## Autorisasi Shopee

Access token Shopee cuma hidup ~4 jam dan refresh token ~30 hari, **dan setiap refresh menghasilkan refresh token baru**. Karena itu token runtime disimpan di `data/shopee-token.json` (sudah di-gitignore), bukan di `.env`. Yang di `.env` hanya dipakai sebagai nilai awal.

Setelah token diambil sekali, refresh-nya otomatis. Kamu hanya perlu authorize ulang kalau refresh token sudah kedaluwarsa (lebih dari 30 hari tidak dipakai).

```bash
npm run shopee:auth
```

Perintah itu mencetak link authorize. Buka di browser, login sebagai seller, klik **Confirm Authorization**. Kamu akan diarahkan ke `SHOPEE_REDIRECT_URL` dengan `?code=...&shop_id=...` di URL-nya. Ambil keduanya:

```bash
npm run shopee:auth -- <code> <shop_id>
```

Pastikan `SHOPEE_SHOP_ID` di `.env` sama dengan `shop_id` yang dicetak.

> **Sandbox vs production.** `SHOPEE_HOST=https://partner.shopeemobile.com` untuk toko live. Host sandbox (`openplatform.sandbox.test-stable.shopee.sg`) memakai partner_id dan shop_id yang berbeda dan **tidak bisa** mengubah produk di toko live.

---

## Konfigurasi `.env`

Selain variabel bot yang sudah ada:

| Variabel | Keterangan |
|---|---|
| `SHOPEE_HOST` | `https://partner.shopeemobile.com` untuk production |
| `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` | Dari app di Shopee Open Platform |
| `SHOPEE_REDIRECT_URL` | Harus sama dengan yang didaftarkan di app |
| `SHOPEE_SHOP_ID` | ID toko yang diautorisasi |
| `SHOPEE_ACCESS_TOKEN`, `SHOPEE_REFRESH_TOKEN` | Nilai awal saja; setelahnya dipegang `data/shopee-token.json` |
| `SHOPEE_SHEET_NAME` | Default `Harga Shopee` |
| `HARGA_TERBARU_SHEET_NAME` | Default `Harga Terbaru` |
| `SHOPEE_IMPORT_ITEM_STATUS` | Default `NORMAL,UNLIST` — status produk yang ditarik |
| `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` | Service account harus punya akses **Editor** ke spreadsheet |

---

## Hal yang perlu diperhatikan

- **`ambil:harga` menimpa tab "Harga Shopee".** Kalau kamu sudah mengedit kolom B tapi belum `sync:harga`, editanmu hilang. Urutannya harus ambil → map/edit → sync.
- **Produk yang sedang ikut promo/diskon.** `update_price` hanya mengubah harga normal. Harga yang tampil di app bisa tetap harga promo sampai promonya habis.
- **Tidak ada langkah konfirmasi.** `sync:harga` langsung eksekusi ke semua baris yang punya `item_id` dan harga valid. Kalau mau uji ke beberapa produk dulu, kosongkan kolom C untuk baris yang belum mau disentuh.

---

## Struktur file

| File | Isi |
|---|---|
| [src/index.js](src/index.js) | Entry bot WhatsApp |
| [src/shopeeClient.js](src/shopeeClient.js) | Signature Shopee, auto-refresh token, token store |
| [src/shopeePriceImport.js](src/shopeePriceImport.js) | Shopee → sheet (`ambil:harga`) |
| [src/shopeePriceMap.js](src/shopeePriceMap.js) | "Harga Terbaru" → kolom E/F/G → kolom B (`map:harga`) |
| [src/shopeePriceSync.js](src/shopeePriceSync.js) | Sheet → Shopee (`sync:harga`) |
| [src/hargaTerbaru.js](src/hargaTerbaru.js) | Parser tab "Harga Terbaru" |
| [src/hargaTerbaruAliases.js](src/hargaTerbaruAliases.js) | Aturan mapping produk non-box |
| [src/shopeeProductMap.js](src/shopeeProductMap.js) | Parser nama produk Shopee → section + ukuran |
| [src/videoNoiseHandler.js](src/videoNoiseHandler.js) | Alur perintah noise reduction: validasi, antrean, balasan |
| [src/videoNoiseReduction.js](src/videoNoiseReduction.js) | Engine denoise + pemanggilan ffmpeg/ffprobe |
| [src/videoNoiseTrigger.js](src/videoNoiseTrigger.js) | Deteksi kata pemicu, caption, dan reply |
| [src/videoJobQueue.js](src/videoJobQueue.js) | Antrean job (concurrency 1) |
| [src/videoNoiseAbCli.js](src/videoNoiseAbCli.js) | Bandingkan setelan denoise pada satu video (`uji:noise`) |
| [src/videoNoiseCompareCli.js](src/videoNoiseCompareCli.js) | Bandingkan file hasil dari sumber mana pun (`banding:noise`) |
| [src/voiceCleanerClient.js](src/voiceCleanerClient.js) | Automation browser ke voicecleaner.ai |
| [src/progressReporter.js](src/progressReporter.js) | Satu pesan status yang diperbarui per tahap |
| [src/audioMetrics.js](src/audioMetrics.js) | Pengukuran audio bersama untuk kedua CLI |
| [src/googleSheets.js](src/googleSheets.js) | Semua akses Google Sheets |
