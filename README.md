# WhatsApp Bot + Sinkronisasi Harga Shopee

Dua bagian yang berjalan terpisah:

1. **Bot WhatsApp** (`npm start`) — auto-reply menu, price list, lokasi, pembayaran, rekap pesanan, dan auto rekap pemasukan harian ke Google Sheet.
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

<a id="ringkasan-otomatis-ke-grup-lain"></a>
### Ringkasan otomatis ke grup lain

Setelah rekap masuk, bot mengirim ringkasannya ke grup **"booot"**:

```
kulakan yohan: Rp1.227.000
kas: Rp0
```

Angkanya sama dengan pesan total di grup pesanan — bedanya cuma tidak tenggelam di antara obrolan order. Nama grup, label, dan tombol matinya ada di `.env`:

| Variabel | Default | Guna |
|---|---|---|
| `REKAP_SUMMARY_ENABLED` | `true` | `false` = ringkasan tidak dikirim |
| `REKAP_SUMMARY_GROUP_NAME` | `booot` | Nama grup tujuan |
| `REKAP_SUMMARY_GROUP_ID` | kosong | Id grup; menang atas nama kalau diisi |
| `REKAP_SUMMARY_TOTAL_LABEL` | `kulakan yohan` | Label baris total |
| `REKAP_SUMMARY_CASH_LABEL` | `kas` | Label baris kas |

Kegagalan mengirim ringkasan **tidak** membatalkan rekap: sheet sudah terisi dan file sudah terkirim, jadi bot cuma menambahkan satu baris pemberitahuan di grup pesanan. Kalau `rekap` kebetulan dijalankan di grup tujuan itu sendiri, ringkasannya dilewati supaya angkanya tidak terkirim dua kali.

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

Pemetaannya ada di `triggerRules` pada [videoNoiseTrigger.js](src/video/videoNoiseTrigger.js) — menambah kata pemicu baru atau mengarahkannya ke engine lain cukup satu baris. Frasa terpanjang dicocokkan lebih dulu, jadi `kurangi noise` tidak tertutup oleh aturan `noise`.

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

**Tiga jebakan yang membuat alur ini gagal secara SENYAP** — ketiganya kena selama pengembangan dan alasannya ditulis sebagai komentar di [voiceCleanerClient.js](src/video/voiceCleanerClient.js):

1. **Klik elemen terdalam, bukan pembungkus.** UI-nya nol elemen `<button>` — semuanya `div`. Event DOM merambat ke atas, jadi mengklik pembungkus tidak memicu handler anaknya. Pembungkus juga sering memuat dua kontrol sekaligus (`Download Result` + `Upload New File`).
2. **Kecuali pemicu login dan tombol submit**, yang justru `<button>` asli — di situ strategi terdalam malah memilih `span` dekoratif yang tidak bisa diklik. Tombol submit ada **5 tingkat** di atas kolom password.
3. **Bukti login bukan munculnya `input[type=file]`.** Input itu baru ada setelah "My Device" diklik, jadi menunggunya akan menggantung walau login sukses. Yang dipakai: hilangnya kolom password.

Kalau alurnya rusak karena situsnya berubah, sunting blok `selectors` di [voiceCleanerClient.js](src/video/voiceCleanerClient.js) dan jalankan dengan `VOICECLEANER_HEADLESS=false` untuk melihat browsernya.

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

## Cek kilo (bandingkan foto catatan karyawan dengan report Bilas)

Kirim **foto catatan tulisan tangan** karyawan (daftar: nama pelanggan, kilo, keterangan) lalu picu dengan perintah `cek kilo`:

- kirim fotonya dengan caption `cek kilo`, atau
- reply foto yang sudah terkirim lalu tulis `cek kilo`.

Di **grup**, wajib mention bot (`@bot cek kilo ...`). Di **chat pribadi** cukup perintahnya.

Bot membaca angka dari foto dengan **Claude vision (via AWS Bedrock)**, menarik transaksi dari aplikasi **Bilas** untuk rentang tanggal yang diminta, mencocokkan nama pelanggan (toleran terhadap salah baca/gelar), lalu membalas satu tabel: nama, kilo di foto, kilo di Bilas, keterangan, cocok/tidak, dan nomor transaksi.

### Parameter (opsional, urutan bebas)

| Parameter | Contoh | Arti |
|---|---|---|
| `cabang:<nama>` | `cabang:sentral` | pilih outlet; default outlet pertama / `BILAS_DEFAULT_OUTLET` |
| `tgl:<tgl>` | `tgl:2026-09-01` | hanya satu hari |
| `tgl:<a>..<b>` | `tgl:2026-08-28..2026-09-01` | rentang tanggal |
| `hari:<n>` | `hari:7` | `n` hari terakhir s/d hari ini |

Tanpa parameter tanggal = **3 hari terakhir s/d hari ini**. Contoh lengkap:

```
@bot cek kilo cabang:sentral tgl:2026-08-28..2026-09-01
cek kilo cabang:discount hari:7
```

### Cara baca hasilnya

- ✅ cocok — selisih kg dalam toleransi (`KILO_TOLERANCE`, default ±0,3 kg; Bilas menyimpan 2 desimal sedangkan tulisan tangan biasanya dibulatkan).
- ❌ beda kilo — nama ketemu tapi kg di luar toleransi.
- ❌ tak ada di Bilas — nama di foto tidak ditemukan di transaksi.
- ⚠️ ragu baca — AI tidak yakin membaca baris itu; cek manual, **bukan** dianggap kebocoran.
- Bagian **"Ada di Bilas, tidak ada di foto"** menandai transaksi yang tidak tercatat di buku — pola kebocoran yang paling umum.

Balasan hanya memuat nama yang ada di foto (tidak pernah menampilkan seluruh report), dan setiap pemakaian dicatat nomor pengirimnya di log.

Konfigurasi `.env`: `BILAS_USERNAME`, `BILAS_PASSWORD`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`, opsional `BILAS_DEFAULT_OUTLET`, `KILO_TOLERANCE`, `KILO_MAX_MB`. Lihat `.env.example`.

---

## Cek ongkir (tarif pengiriman Maxim)

Ada dua cara pakai. **Bertahap** — kirim `cek ongkir` saja, lalu bot menuntun:

```
kamu : @bot cek ongkir
bot  : Cek ongkir — kirim dari mana?
       1. Dashmall
       2. Gudang
kamu : 1
bot  : Titik jemput: Dashmall. Kirim ke mana?
kamu : Tlogosari Raya I 65c      (atau link Google Maps)
bot  : [screenshot tarif + ringkasan harga]
```

Titik jemput muncul sebagai menu WhatsApp; kalau menu ditolak WhatsApp, bot otomatis mengirim daftar bernomor. Balasannya boleh nomor (`1`) atau nama (`dashmall`). Ketik `batal` untuk berhenti, dan sesi hangus sendiri setelah 10 menit.

**Sekali kirim** — kalau sudah hafal, langsung lengkap dalam satu pesan:

```
cek ongkir
dari: dashmall
ke: Tlogosari Raya I 65c
```

Di **grup**, mention bot hanya diperlukan untuk memulai (`@bot cek ongkir`); jawaban berikutnya tidak perlu mention, dan hanya balasan dari orang yang memulai yang dibaca. Di **chat pribadi** cukup perintahnya.

Bot menjalankan **aplikasi Maxim di emulator MuMuPlayer** lewat `adb`, mengisi kedua titik, membuka daftar tarif Delivery, lalu membalas **screenshot layar tarif** + ringkasan teks. Satu permintaan memakan waktu sekitar 45 detik dan diantre satu per satu (emulatornya cuma satu).

### Titik asal dan tujuan

| Isian | Contoh | Arti |
|---|---|---|
| `dari:` alias | `dari: dashmall` | alias dari `.env` (`ONGKIR_ORIGIN_*`), diterjemahkan jadi kata kunci pencarian |
| `dari:` / `ke:` alamat | `ke: Tlogosari Raya I 65c` | diketik apa adanya ke pencarian Maxim |
| `ke:` link Google | `ke: https://maps.app.goo.gl/...` | link dibuka, **nama tempatnya** dipakai jadi kata kunci |

Link Google **tidak** memuat koordinat — yang dipakai hanyalah teks alamat di URL hasil redirect, karena pencarian Maxim memang menerima teks. Alamat dari link dipendekkan lebih dulu (`Jl. Kukilo Mukti Raya No.143, Pedurungan Kidul` → `Kukilo Mukti Raya 143`); bentuk panjang membuat Maxim meleset ke POI lain sekelurahan. Kalau pencarian bentuk pendek gagal, bot mengulang dengan bentuk panjang.

### Cara baca hasilnya

Balasan selalu menyebut **alamat yang benar-benar dipilih Maxim** (`Dari:` / `Ke:`), bukan yang kamu ketik. Cek baris itu dulu: kalau tempatnya bukan yang kamu maksud, harganya juga bukan punya rute yang kamu maksud. Tulis alamat lebih spesifik lalu ulangi.

Harga yang ditampilkan adalah seluruh tarif Delivery yang sedang berlaku: Food&Shop, Bike Delivery (Regular), Bike Delivery (Xpress), dan Car Delivery.

### Uji tanpa WhatsApp

```bash
node src/cli/ongkirCli.js dashmall "Tlogosari Raya I 65c"
node src/cli/ongkirCli.js gudang "https://maps.app.goo.gl/..."
```

Screenshot hasilnya ditulis ke `data/ongkir-terakhir.png`.

### Syarat jalan

- **MuMuPlayer** terpasang dengan aplikasi **Maxim** sudah login. Bot menyalakan emulator sendiri kalau mati (cold start ±80 detik, dibanding ±45 detik kalau emulator sudah hidup), tapi tidak bisa login sendiri.
- Setelah emulator baru menyala, Maxim menanyakan kota dan menebak **Jakarta** dari GPS emulator. Bot menjawabnya sendiri dengan `MAXIM_CITY` (default Semarang) — kalau dibiarkan terjawab "OK", seluruh tarif dihitung untuk kota yang salah.
- Bot harus jalan di mesin yang sama dengan emulator (Windows). Fitur ini **tidak** bisa jalan di server Ubuntu.
- Favorites di aplikasi Maxim tidak dipakai: mengetik nama favorit tidak memunculkannya, dan favorit hanya tampil saat kolom pencarian kosong.

Konfigurasi `.env`: `MUMU_DIR`, `MUMU_VM_INDEX`, `MUMU_BOOT_TIMEOUT_MS`, `MAXIM_PACKAGE`, `MAXIM_CATEGORY`, `MAXIM_CITY`, `ONGKIR_LINK_TIMEOUT_MS`, `ONGKIR_MENU_MODE`, `ONGKIR_SESSION_TTL_MS`, dan alias `ONGKIR_ORIGIN_<NAMA>`. Lihat `.env.example`.

## Auto rekap (pemasukan & pengeluaran harian ke Google Sheet)

Merekap satu hari ke spreadsheet "Shopee Summary", dari **empat sumber**:

| Sumber | Kolom | Ditulis sebagai |
|---|---|---|
| Saldo Shopee yang ditarik hari itu | C (Pemasukan) | satu baris `Income Shopee` |
| `offline <angka>` diketik di grup | C (Pemasukan) | satu baris `Offline` per catatan |
| Ringkasan rekap yang dikirim bot sendiri ke grup | D (Pengeluaran) | satu baris `Kulakan Yohan` + satu baris `Kas` per hari |
| `pengeluaran <angka>` diketik di grup | D (Pengeluaran) | satu baris `Pengeluaran` per catatan |

Kulakan dan kas **tidak diketik manual**: angkanya diambil dari dua baris yang dikirim bot sesudah `rekap` (lihat [Ringkasan otomatis ke grup lain](#ringkasan-otomatis-ke-grup-lain)), jadi yang masuk buku keuangan persis angka yang sudah dilihat orang di grup. Kas dihitung pengeluaran karena uangnya dipindahkan ke rekening lain, bukan hilang.

Nominal `Rp0` tidak ditulis — baris kosong tidak mengubah `SUM` apa pun dan cuma memanjangkan blok harian.

### Cara angka dibaca

Angka **tanpa satuan**: kelipatan 1000 dibaca apa adanya, sisanya dikali 1000.

| Ditulis | Dibaca | Kenapa |
|---|---|---|
| `offline 105` | Rp105.000 | bukan kelipatan 1000 → ditulis singkat |
| `offline 1225` | Rp1.225.000 | bukan kelipatan 1000 → ditulis singkat |
| `offline 85000` | Rp85.000 | kelipatan 1000 → ditulis lengkap |
| `offline 150.000` | Rp150.000 | kelipatan 1000 → ditulis lengkap |
| `pengeluaran 9rb` | Rp9.000 | satuan ditulis eksplisit |
| `offline 12,5rb` | Rp12.500 | koma = desimal |

Dasarnya: orang menulis singkat (`105`, `1225`) atau lengkap (`85000`), dan yang lengkap selalu berakhiran `000`. Ambang tetap seperti "di bawah 1000 = ribuan" tidak bisa membedakan keduanya — `1225` akan jadi Rp1.225.

Yang tersisa ambigu cuma nominal bulat ribuan yang ditulis singkat: `offline 1000` dibaca **Rp1.000**, bukan Rp1 juta. Tulis `1jt` atau `1.000.000` untuk itu.

```
kamu : @bot auto rekap
bot  : Auto rekap 15 Sep 2026 diproses, tunggu ya...
bot  : *Auto rekap — 15 Sep 2026*
       Tab: September 2026

       Shopee: *Rp1.250.000* (tarik dana berhasil)

       Offline: 3 setoran, total Rp425.000
         • Ani: Rp150.000 (offline 150)
         • Budi: Rp200.000 (offline 200rb)
         • Budi: Rp75.000 (offline 75)

       Pengeluaran:
         • Kulakan Yohan: *Rp1.227.000* (ditulis di baris 42)
         • Kas: Rp0 (tidak ditulis)
         • Budi: Rp9.000 (Pengeluaran 9rb)
         • Budi: Rp12.000 (pengeluaran 12rb)

       Masuk: *Rp1.675.000*
       Keluar: *Rp1.248.000*
       7 baris baru (blok tanggal baru)
```

Di **grup** wajib mention bot; di **chat pribadi** cukup perintahnya. Perintah ini menarik dana, jadi tidak boleh terpicu obrolan yang kebetulan menyebut "auto rekap".

### Batas hari kerja (rekap lewat tengah malam)

Rekap biasanya dikerjakan setelah tutup, kadang sudah lewat tengah malam. Kalau memakai tanggal kalender, menjalankan `auto rekap` jam 00:30 tanggal 16 akan menulis ke blok tanggal 16 yang masih kosong — padahal seluruh setoran dan saldo yang dimaksud milik tanggal 15.

Jadi jam `00:00` s/d `KEUANGAN_DAY_CUTOFF_HOUR` (default **4**) masih dihitung hari sebelumnya:

| Dijalankan | Blok tanggal | Shopee ditarik? |
|---|---|---|
| 15 Sep 21:00 | 15 Sep | ya |
| 16 Sep 00:30 | **15 Sep** | **ya** — saldonya memang hasil tanggal 15 yang belum ditarik |
| 16 Sep 03:59 | 15 Sep | ya |
| 16 Sep 04:00 | 16 Sep | ya |

`KEUANGAN_DAY_CUTOFF_HOUR=0` mematikannya (ikut kalender apa adanya).

Batas ini dipakai di **dua** tempat sekaligus: saat menentukan tanggal target, dan saat memilah pesan grup mana yang termasuk hari itu. Kalau hanya salah satu, pesan jam 00:10 akan jatuh ke hari yang berbeda dari bloknya. Karena itu `auto rekap kemarin` yang dijalankan jam 00:30 tanggal 16 menunjuk tanggal **14**, bukan 15.

Zona waktunya `RECAP_TIMEZONE` (di `.env` sekarang `Asia/Jakarta`).

### Parameter (opsional)

| Isian | Arti |
|---|---|
| `auto rekap` | hari ini, Shopee ikut ditarik |
| `auto rekap kemarin` | tanggal kemarin, Shopee **dilewati** |
| `auto rekap tgl:2026-09-15` | tanggal tertentu; dilewati Shopee kalau bukan hari ini |
| `auto rekap tanpa shopee` | hanya setoran offline |

Tarik dana hanya berlaku untuk saldo **saat ini**, jadi merekap tanggal lampau tidak pernah ikut menarik uang — nominalnya sudah bukan saldo hari itu.

### Setoran offline dari grup

Bot menelusuri 500 pesan terakhir (`KEUANGAN_HISTORY_COUNT`) di grup `KEUANGAN_GROUP_NAME` dan mengumpulkan semua yang cocok template `offline <angka>`:

| Ditulis karyawan | Dibaca jadi | Alasan |
|---|---|---|
| `offline 150` | Rp150.000 | di bawah 1000 dianggap ribuan |
| `offline 200rb` | Rp200.000 | satuan eksplisit |
| `offline 150000` | Rp150.000 | 1000 ke atas dibaca apa adanya |
| `offline 1,5jt` | Rp1.500.000 | satuan eksplisit |
| `besok offline ya` | — | tidak ada angka, dilewati |

Satu pesan boleh memuat beberapa setoran (`offline 75 dan offline 25` = dua entri). Pesan yang waktunya tidak terbaca **tidak** ikut dihitung dan jumlahnya dilaporkan di balasan, karena tanpa waktu tidak ada cara memastikan pesan itu milik tanggal yang diminta. Balasan bot sendiri diabaikan — kalau tidak, menjalankan perintah dua kali akan menghitung ringkasannya sebagai setoran baru.

### Bentuk spreadsheetnya: buku jurnal, bukan satu baris per hari

Ini yang menentukan seluruh perilaku penulisan:

```
A=Tanggal      B=Keterangan     C=Pemasukan    D=Pengeluaran
14/09/2026     Income Shopee    Rp1.265.759
               Offline          Rp85.000
               Offline          Rp45.000
               Kulakan Yohan                   Rp1.353.000
15/09/2026     Income Shopee    ...
```

- Tanggal ditulis **sekali saja**, di baris pertama blok hari itu.
- Setiap setoran offline punya **barisnya sendiri** — tidak dijumlahkan jadi satu. Begitu juga tiap catatan `pengeluaran`.
- Kulakan dan kas sebaliknya: **satu baris per hari**. Rekap yang diulang **menimpa** nominalnya, karena rekap terakhir hari itu yang berlaku — bukan menambah baris baru.
- `F1=SUM(C:C)`, `G1=SUM(D:D)`, `I1=F1-G1` memakai seluruh kolom, jadi baris baru otomatis ikut terhitung dan tidak ada formula yang perlu disentuh.
- Kolom A sudah berformat `dd/mm/yyyy` dan C/D berformat Rupiah sampai jauh ke bawah, jadi baris baru langsung tampil benar.

Tab-nya **per bulan**, dan namanya tidak selalu konsisten (`September 2026`, tapi `Feb 2026`). Karena itu nama tab **dicocokkan dengan daftar tab sungguhan** berdasarkan bulan + tahun tanggalnya — bukan dirangkai dari nama bulan. Biarkan `KEUANGAN_SHEET_NAME` kosong; mengisinya dengan "September 2026" akan salah tab begitu ganti bulan. Kalau tab bulan berikutnya belum dibuat, bot melapor `TAB_NOT_FOUND` dan tidak menulis apa pun.

### Menjalankan perintah dua kali

Aman, dan memang dirancang untuk itu — setoran biasanya masuk bertahap sepanjang hari:

- **Shopee** — nominalnya sudah tercatat dengan angka sama, jadi tidak ditulis ulang.
- **Offline & `pengeluaran`** — nominal yang sudah ada di blok hari itu dilewati, hanya catatan baru yang ditambahkan. Perbandingannya per lembar, jadi tiga setoran `Rp41.000` tetap jadi tiga baris.
- **Kulakan & kas** — kalau nominalnya sama, barisnya tidak disentuh; kalau `rekap` diulang dan angkanya berubah, sel kolom D-nya **ditimpa** di tempat.
- Kalau tidak ada yang berubah, balasannya **"Sheet tidak berubah — semuanya sudah tercatat"** dan tidak ada satu pun request tulis yang dikirim.

Untuk tanggal lampau yang bloknya ada di tengah, barisnya **disisipkan** (bukan ditambah di bawah) supaya urutan tanggalnya tidak rusak.

### Kenapa Shopee lewat Seller Centre, bukan API

Modul Payment di Shopee Open API v2 hanya baca (`get_wallet_transaction_list`, `get_payout_detail`, `get_escrow_list`, …) — **tidak ada endpoint yang memulai penarikan**. Jadi tahap ini menyetir halaman Seller Centre dengan Puppeteer: buka Saldo Saya → baca "saldo dapat ditarik" → Tarik Dana → isi password → tunggu konfirmasi.

Halaman itu memindahkan uang dan tidak punya kontrak versi, jadi ada tiga pengaman di `src/keuangan/shopeeWithdrawClient.js` yang **jangan dihapus** saat memperbaiki selektor:

1. **Satu penarikan per tanggal.** Hasil penarikan sukses dicatat di `data/keuangan-state.json`. Menjalankan `auto rekap` lagi di hari yang sama memakai nominal tercatat dan tidak menarik ulang.
2. **Satu penarikan sekaligus.** Antreannya `concurrency: 1, maxPending: 1`, ditambah penjaga di dalam modul, jadi dua perintah bersamaan tidak bisa menarik dua kali.
3. **Dry run.** `KEUANGAN_DRY_RUN=true` menjalankan seluruh alur tapi tidak pernah menekan Tarik Dana.

Shopee juga dikerjakan lebih dulu daripada penulisan sheet. Kalau penarikan gagal, **tidak ada apa pun yang tertulis** ke spreadsheet — tidak ada angka separuh jadi yang perlu dibersihkan.

### Login pertama kali

Login Seller Centre hampir selalu minta OTP, dan bot tidak bisa membacanya. Jalankan sekali dengan jendela terlihat:

```bash
SHOPEE_SELLER_HEADLESS=false npm run cek:saldo
```

Saat `HEADLESS=false`, skrip **tidak mengisi form login sendiri** — dia membuka halaman lalu menunggu kamu login manual (termasuk OTP) sampai `SHOPEE_SELLER_MANUAL_TIMEOUT_MS` (default 5 menit), dan lanjut sendiri begitu kamu sudah masuk. Ini disengaja: kalau skrip ikut mengetik dan men-submit sementara kamu juga sedang login, keduanya saling membatalkan dan navigasinya gagal dengan `net::ERR_ABORTED`.

Sesinya disimpan di `data/shopee-seller-profile`, jadi run berikutnya bisa `HEADLESS=true` tanpa OTP lagi. Kalau sesi habis, bot melapor `SESSION_EXPIRED` dan kamu cukup ulangi langkah di atas.

Perintah yang sama juga dipakai untuk memverifikasi selektor tanpa menarik dana — hasilnya menampilkan nominal yang terbaca beserta teks aslinya:

```
--- HASIL ---
Status  : dry-run
Nominal : Rp1.250.000
Label   : "Saldo dapat ditarik"
Teks asli: "Rp1.250.000"
```

Tambahkan `--tarik` hanya kalau memang ingin menarik dana sungguhan (ada jeda 5 detik untuk membatalkan), dan `--paksa` untuk menembus catatan harian.

### Kalau Shopee minta verifikasi identitas (IVS)

Shopee kadang melempar tantangan verifikasi di **host yang berbeda** (`shopee.co.id/verify/ivs`), bahkan setelah email+kata sandi diterima — dan khususnya saat halaman keuangan diminta. Sebagian akun **hanya** diberi opsi "Verifikasi melalui link", tanpa pilihan kode sama sekali.

Yang menentukan berhasil atau tidak adalah **di mana link itu dibuka**, karena verifikasi menempel pada sesi browser yang membukanya:

1. Tekan "Verifikasi melalui link" di jendela Chrome yang dibuka skrip.
2. Buka email/WhatsApp, **salin** link verifikasinya.
3. **Tempel link itu ke address bar jendela Chrome yang dibuka skrip** — jangan diklik langsung.

Kalau link diklik langsung, dia terbuka di browser harianmu. Yang terverifikasi adalah sesi browser itu, bukan profil `data/shopee-seller-profile` milik bot, jadi bot tetap terpantul ke login.

Tahap membuka halaman saldo punya putaran sendiri untuk ini: kalau terpantul ke verifikasi, skrip menunggu kamu menyelesaikannya lalu mencoba lagi, sampai tiga kali. Kalau tetap gagal, errornya `VERIFICATION_REQUIRED`.

Status login juga tidak ditebak dari "tidak ada tanda-tanda login". Dulu `ready` adalah nilai default, sehingga halaman IVS — yang tidak punya kolom password dan URL-nya bukan `/account/signin` — lolos sebagai sukses. Sekarang `ready` hanya diberikan kalau host-nya benar-benar `seller.shopee.*` dan bukan halaman login/verifikasi.

### Label saldo di halaman "Saldo Penjual"

Menu **Keuangan -> Saldo Saya** bermuara di `/portal/finance/wallet/shopeepay`, judulnya "Saldo Penjual". Kartu "Informasi Saldo" memakai label sependek **`Saldo`**, tepat di samping tombol Tarik Dana:

```
Informasi Saldo
Saldo
Rp754.805
Tarik Dana
```

Karena "saldo" terlalu umum, pencocokannya **baris persis** (`/^saldo$/i`) — bukan "mengandung kata saldo", yang akan ikut menyambar "Informasi Saldo", "Saldo Penjual", "Saldo Tertahan", atau "Total Saldo".

`selectors.withdrawableLabels` adalah daftar **berurutan**, dicoba dari paling eksplisit ke paling longgar. Urutannya penting dan bukan sekadar alternatif: kalau digabung jadi satu regex, yang menang adalah label yang posisinya paling atas di halaman, sehingga "Total Saldo" berpeluang mengalahkan "Saldo dapat ditarik". Untuk angka uang itu tidak boleh terjadi. Hasil dry run mencetak `Cocok via:` supaya bisa dicek mata, plus peringatan kalau yang cocok cuma label longgar.

Halaman yang sama juga memuat iklan SPinjam berbunyi "dana tunai hingga **Rp1.5 Milyar**". Digitnya saja terbaca `15` — salah delapan digit. Karena itu `parseRupiah` **menolak** nominal yang diikuti satuan kata (milyar/miliar/juta/ribu/rb/jt), bukan mengira-kira: ini jalur uang.

Kalau label saldonya berubah, errornya mendiagnosis sendiri — mencetak setiap nominal yang ada di halaman beserta labelnya:

```
Label saldo tidak ditemukan di halaman. Nominal yang ADA di halaman:
  - Saldo => Rp754.805
  - SPinjam Untuk Penjual => Kembangkan toko Anda dengan dana tunai hingga Rp1.5 Milyar!
```

### Halaman Saldo Saya terkunci kata sandi

Membuka Saldo Saya kadang memunculkan popup kata sandi — untuk **melihat** saldonya, terpisah dari konfirmasi saat menarik dana. Bot mengisinya sendiri memakai `SHOPEE_SELLER_PASSWORD`. Popupnya tidak selalu muncul; kalau tidak ada, tahap ini dilewati tanpa efek.

Gerbang ini tetap dilewati di mode dry run, karena tanpa itu saldonya tidak bisa dibaca sama sekali. Yang **tidak** dilakukan di dry run tetap sama: tombol Tarik Dana tidak pernah ditekan.

Kalau pengisian otomatis gagal dan jendelanya terlihat (`SHOPEE_SELLER_HEADLESS=false`), skrip menyerahkannya ke kamu — isi popup itu manual, dan skrip lanjut sendiri begitu saldonya tampil. Kalau kata sandinya ditolak, errornya `BALANCE_PASSWORD_REJECTED` dan tidak ada dana yang ditarik.

**Syarat "halaman siap" adalah nominalnya terbaca, bukan judulnya cocok.** Ini pernah jadi bug: judul "Saldo Penjual" tetap ada di latar belakang walau popup kata sandi menutupinya, jadi memakai penanda teks membuat halaman terkunci lolos sebagai siap — dan saldonya lalu terbaca kosong dengan pesan yang menyesatkan ("label tidak ditemukan", padahal sebenarnya terkunci). Urutannya sekarang: periksa gerbang kata sandi dulu, baru tunggu nominalnya muncul. Pesan errornya juga membedakan kedua penyebab itu.

### Mencari URL halaman saldo

URL halaman keuangan Seller Centre tidak boleh ditebak — tebakan yang salah mendarat di `seller.shopee.co.id/404`, dan itu terbaca sebagai "sudah login tapi URL keliru", bukan masalah sesi.

Untuk menemukannya:

```bash
npm run cek:menu          # pantau 5 menit
npm run cek:menu -- 10    # pantau 10 menit
```

Perintah ini memakai sesi yang sudah tersimpan, menyapu semua tautan berbau keuangan di halaman, lalu **memantau perubahan URL**: kamu klik sendiri sampai halaman Saldo Saya terbuka, dan setiap URL baru dicetak di terminal. Cara ini dipakai karena menu Seller Centre banyak yang digerakkan JavaScript tanpa `href` sungguhan, jadi menyapu DOM saja bisa buta.

Salin URL yang benar ke `.env` sebagai `SHOPEE_SELLER_BALANCE_URL`.

### Kenapa navigasinya dicoba ulang

Seller Centre adalah SPA yang sering melakukan redirect sendiri, terutama sesaat setelah login. Kalau `page.goto` kebetulan jalan bersamaan dengan redirect itu, Chrome membatalkan navigasi kita dengan `net::ERR_ABORTED` — padahal halamannya sering tetap sampai ke tujuan. Karena itu semua navigasi lewat `gotoStable`: `waitUntil: domcontentloaded` (dasbor Shopee terus polling, jadi jaringannya praktis tidak pernah idle), cek "apakah sudah mendarat di path yang benar" sebelum menyerah, lalu coba ulang sampai tiga kali.

Status login juga tidak ditebak dari ada/tidaknya kolom password. Halaman OTP juga tidak punya kolom password, jadi cara itu membuat tantangan OTP terbaca sebagai login sukses.

### Alur Tarik Dana dan PIN 6 digit

Ditelusuri dari halaman aslinya:

```
Saldo Penjual
  [Tarik Dana]  ->  HALAMAN BARU "Tarik Dana"
                      Tarik Dana ke        : ShopeePay / rekening bank
                      Jumlah Penarikan Dana: (sudah terisi)
                      Biaya transaksi      : Rp0
                      [Konfirmasi]  ->  POPUP PIN 6 DIGIT
```

**Kata sandi akun dan PIN penarikan adalah dua hal berbeda.** `SHOPEE_SELLER_PASSWORD` membuka halaman saldo; `SHOPEE_SELLER_WITHDRAW_PIN` menyelesaikan penarikan. Kalau PIN dibiarkan kosong, bot berhenti di popup PIN dan melapor `WITHDRAW_PIN_REQUIRED` — penarikannya **belum** selesai dan harus dituntaskan manual.

Dua pengaman berhenti **sebelum** tombol Konfirmasi ditekan, jadi kalau salah satunya gagal tidak ada apa pun yang terkirim:

| Pengaman | Env | Kalau tidak cocok |
|---|---|---|
| Tujuan penarikan | `SHOPEE_SELLER_WITHDRAW_TO` | `WITHDRAW_DESTINATION_MISMATCH` |
| Nominal di form vs saldo dibaca | — | `WITHDRAW_AMOUNT_MISMATCH` |

Pengaman tujuan itu bukan hiasan: halaman Tarik Dana menawarkan ShopeePay **dan** rekening bank, dan salah tujuan tidak bisa dibatalkan. Kosongkan `SHOPEE_SELLER_WITHDRAW_TO` hanya kalau kamu sengaja mematikan pengaman itu.

Popup PIN ditangani untuk dua bentuk: enam kotak terpisah (digitnya disebar satu-satu) maupun satu kolom (diketik utuh).

Catatan selektor: `pinMarker` memakai `\bpin\b` dengan batas kata. Tanpa itu, `/pin/` polos akan cocok di dalam **"SPinjam Untuk Penjual"** — iklan yang ada di halaman saldo — dan bot mengira popup PIN sudah muncul padahal masih di halaman saldo.

### Kalau penarikan menggantung

Kalau bot melapor **"Tidak ada konfirmasi sukses setelah 120 detik"**, jangan ulangi perintahnya. Timeout bukan berarti gagal — permintaannya bisa sudah terkirim. Cek dulu di Seller Centre, karena catatan harian tidak ditandai sukses pada kasus ini dan perintah berikutnya **akan** menarik lagi.

Konfigurasi `.env`: `KEUANGAN_SHEET_ID`, `KEUANGAN_SHEET_NAME`, `KEUANGAN_SHOPEE_LABEL`, `KEUANGAN_OFFLINE_LABEL`, `KEUANGAN_HEADER_ROWS`, `KEUANGAN_LAST_ROW`, `KEUANGAN_GROUP_NAME`, `KEUANGAN_GROUP_ID`, `KEUANGAN_HISTORY_COUNT`, `KEUANGAN_MAX_WITHDRAW`, `KEUANGAN_DRY_RUN`, `SHOPEE_SELLER_USERNAME`, `SHOPEE_SELLER_PASSWORD`, `SHOPEE_SELLER_BALANCE_URL`, `SHOPEE_SELLER_LOGIN_URL`, `SHOPEE_SELLER_HEADLESS`. Lihat `.env.example`.

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

Produk **non-box** (Ice Pack, PE Foam, Lakban, Therma Pack Bag, dll) tidak punya pola, jadi dipetakan lewat aturan eksplisit di [src/sheets/hargaTerbaruAliases.js](src/sheets/hargaTerbaruAliases.js). Tambah produk baru? Tambah aturan di situ.

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
| [src/shopee/shopeeClient.js](src/shopee/shopeeClient.js) | Signature Shopee, auto-refresh token, token store |
| [src/shopee/shopeePriceImport.js](src/shopee/shopeePriceImport.js) | Shopee → sheet (`ambil:harga`) |
| [src/shopee/shopeePriceMap.js](src/shopee/shopeePriceMap.js) | "Harga Terbaru" → kolom E/F/G → kolom B (`map:harga`) |
| [src/shopee/shopeePriceSync.js](src/shopee/shopeePriceSync.js) | Sheet → Shopee (`sync:harga`) |
| [src/sheets/hargaTerbaru.js](src/sheets/hargaTerbaru.js) | Parser tab "Harga Terbaru" |
| [src/sheets/hargaTerbaruAliases.js](src/sheets/hargaTerbaruAliases.js) | Aturan mapping produk non-box |
| [src/shopee/shopeeProductMap.js](src/shopee/shopeeProductMap.js) | Parser nama produk Shopee → section + ukuran |
| [src/video/videoNoiseHandler.js](src/video/videoNoiseHandler.js) | Alur perintah noise reduction: validasi, antrean, balasan |
| [src/video/videoNoiseReduction.js](src/video/videoNoiseReduction.js) | Engine denoise + pemanggilan ffmpeg/ffprobe |
| [src/video/videoNoiseTrigger.js](src/video/videoNoiseTrigger.js) | Deteksi kata pemicu, caption, dan reply |
| [src/video/videoJobQueue.js](src/video/videoJobQueue.js) | Antrean job (concurrency 1) |
| [src/cli/videoNoiseAbCli.js](src/cli/videoNoiseAbCli.js) | Bandingkan setelan denoise pada satu video (`uji:noise`) |
| [src/cli/videoNoiseCompareCli.js](src/cli/videoNoiseCompareCli.js) | Bandingkan file hasil dari sumber mana pun (`banding:noise`) |
| [src/video/voiceCleanerClient.js](src/video/voiceCleanerClient.js) | Automation browser ke voicecleaner.ai |
| [src/shared/progressReporter.js](src/shared/progressReporter.js) | Satu pesan status yang diperbarui per tahap |
| [src/shared/groupResolver.js](src/shared/groupResolver.js) | Cari id grup dari namanya (dipakai rekap + auto rekap) |
| [src/shared/recapSummary.js](src/shared/recapSummary.js) | Ringkasan kulakan/kas ke grup "booot" |
| [src/video/audioMetrics.js](src/video/audioMetrics.js) | Pengukuran audio bersama untuk kedua CLI |
| [src/keuangan/keuanganHandler.js](src/keuangan/keuanganHandler.js) | Alur "auto rekap": Shopee → grup → sheet → balasan |
| [src/keuangan/keuanganTrigger.js](src/keuangan/keuanganTrigger.js) | Deteksi perintah "auto rekap" + tanggalnya |
| [src/keuangan/businessDay.js](src/keuangan/businessDay.js) | Batas hari kerja (rekap lewat tengah malam) |
| [src/keuangan/offlineParser.js](src/keuangan/offlineParser.js) | Parser `offline <angka>` / `pengeluaran <angka>` dari grup rekap harian |
| [src/keuangan/pengeluaranParser.js](src/keuangan/pengeluaranParser.js) | Baca kulakan & kas dari ringkasan rekap di grup |
| [src/keuangan/shopeeWithdrawClient.js](src/keuangan/shopeeWithdrawClient.js) | Automation Seller Centre: baca saldo + tarik dana |
| [src/keuangan/keuanganSheet.js](src/keuangan/keuanganSheet.js) | Tulis pemasukan harian ke spreadsheet keuangan |
| [src/cli/shopeeSaldoCli.js](src/cli/shopeeSaldoCli.js) | Cek saldo Shopee / verifikasi selektor (`cek:saldo`) |
| [src/cli/shopeeMenuCli.js](src/cli/shopeeMenuCli.js) | Cari URL halaman saldo Seller Centre (`cek:menu`) |
| [src/sheets/googleSheets.js](src/sheets/googleSheets.js) | Semua akses Google Sheets |
