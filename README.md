# WhatsApp Product Image Bot

Bot WhatsApp ini membalas chat yang berisi keyword tertentu dengan gambar price list.

## Keyword dan file gambar

Taruh file gambar di folder `assets/` dengan nama berikut:

| Keyword | File gambar |
| --- | --- |
| `PL box` | `assets/pl-box.jpg` |
| `PL box warna` | `assets/pl-box-warna.jpg` |
| `PL Thermal Bag` | `assets/pl-thermal-bag.jpg` |
| `PL Lembaran` | `assets/pl-lembaran.jpg` |
| `PL PE foam` | `assets/pl-pe-foam.jpg` |
| `PL Ice Pack` | `assets/pl-ice-pack.jpg` |
| `PL Ice Gel` | `assets/pl-ice-gel.jpg` |
| `PL Lem Sterofoam` | `assets/pl-lem-sterofoam.jpg` |
| `PL Pemotong Sterofoam` | `assets/pl-pemotong-sterofoam.jpg` |
| `PL Palet Plastik` | `assets/pl-palet-plastik.jpg` |
| `qris` | `assets/qris.jpg` |

Keyword dicocokkan secara exact, case-insensitive, dan spasi berlebih akan diabaikan. Contoh: `pl   box` tetap dianggap `PL box`.

## Template pesan pertama

Saat customer pertama kali chat, bot akan mengirim template:

```text
Terimakasih sudah menghubungi Dashmall - Sterofoam!

Kami Sedia :
- Box Sterofoam / Cooler Box (aluminium)
- Box Sterofoam Lakban Warna-warni
- Sterofoam Lembaran
- Ice Pack
- Ice Gel
- Termal Bag / tas termal
- PE Foam
- Lem Sterofoam
- Pemotong Sterofoam - Sterofoam Cutter
- Palet Plastik

Ada yang bisa kami bantu?
```

Bot akan mencoba mengirim menu interaktif memakai `sendListMessage`. Kalau list message gagal dikirim di versi WhatsApp Web/WPPConnect yang sedang dipakai, bot otomatis fallback ke template teks dengan link `wa.me`.

Aktifkan link otomatis dengan mengisi nomor bisnis saat menjalankan bot. Format nomor pakai kode negara tanpa tanda `+`, misalnya `6281234567890`.

## Instalasi

Install Node.js 18 atau lebih baru, lalu jalankan:

```bash
npm install
```

Library yang dipakai adalah `@wppconnect-team/wppconnect`, sesuai dokumentasi WPPConnect:
https://wppconnect.io/docs/tutorial/basics/installation/

## Menjalankan bot

```bash
npm start
```

Dengan link menu otomatis:

```bash
$env:BUSINESS_PHONE="6281234567890"; npm start
```

Atau isi file `.env`:

```env
WPP_SESSION=business-bot
BUSINESS_PHONE=6281234567890
WELCOME_MENU_MODE=list
TEXT_MENU_FALLBACK=false
```

Template akan dikirim saat customer pertama kali chat.

`WELCOME_MENU_MODE=list` akan memakai `sendListMessage`. Kalau list gagal dan kamu tetap mau bot mengirim template teks/link, ubah `TEXT_MENU_FALLBACK=true`.

## Pembayaran

Kalau chat mengandung kata `qris`, bot akan mengirim `assets/qris.jpg`.

Kalau chat mengandung kata `transfer`, bot akan mengirim:

```text
Pembayaran melalui transfer bisa ke :

BCA 8915836379

Atas nama
Denni Afredo Suryono Hartanu
```

## Alamat

Bot akan mengirim alamat kalau chat mengandung kata seperti `alamat`, `lokasi`, `maps`, `shareloc`, `sendangmulyo`, `pickup`, `cod`, `ambil`, atau pertanyaan seperti `toko dimana`.

```text
DASH MALL

Lokasi :
Jl. Gendong Raya No. 38, Sendangmulyo (sebelah sentral laundry) https://maps.app.goo.gl/BKVKYdovFFUqV5i97
```

Saat pertama kali jalan, QR WhatsApp akan muncul di terminal. Scan QR itu dari WhatsApp Business yang ingin dipakai. Session akan disimpan di folder `tokens/`, jadi login tidak perlu diulang setiap start selama token masih valid.

Kalau mau mengganti nama session:

```bash
$env:WPP_SESSION="nama-session"; npm start
```

## Mengubah keyword atau caption

Edit file `src/keywordReplies.js`.
