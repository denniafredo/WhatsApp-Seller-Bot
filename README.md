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
| [src/googleSheets.js](src/googleSheets.js) | Semua akses Google Sheets |
