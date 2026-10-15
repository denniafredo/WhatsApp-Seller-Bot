// Nota pembayaran Dash Mall, meniru nota cetak yang dipakai sekarang: kop +
// logo, kolom No/Nama/Tanggal, tabel 4 kolom, blok rekening, dan kolom tanda
// terima / hormat kami.
//
// Ukurannya A5 dalam satuan mm supaya PDF-nya presisi kalau dicetak, dan
// JPG-nya (screenshot halaman yang sama) tidak pernah beda tata letak.

const { formatNumber } = require('../notaParser');
const { optionalDataUri, escapeHtml } = require('../notaAssets');

// Minimal 7 baris seperti nota cetaknya; sisanya dibiarkan kosong supaya
// bentuknya tetap sama walau cuma sebaris item.
const MIN_ROWS = 7;

const palette = {
  navy: '#3f4b5b',
  ink: '#2f3945',
  line: '#9aa4b0',
};

function iconPhone() {
  return `<svg viewBox="0 0 24 24" fill="${palette.navy}"><path d="M6.6 10.8c1.1 2.2 2.9 4 5.1 5.1l1.7-1.7c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1C10.3 20 4 13.7 4 6c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3 0 .7-.2 1l-1.7 1.7z"/></svg>`;
}

function iconPin() {
  return `<svg viewBox="0 0 24 24" fill="${palette.navy}"><path d="M12 2c-3.5 0-6.3 2.8-6.3 6.3C5.7 13 12 22 12 22s6.3-9 6.3-13.7C18.3 4.8 15.5 2 12 2zm0 8.8a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/></svg>`;
}

function logoBlock(brand) {
  const logo = optionalDataUri(brand.assets.logo);
  if (logo) {
    return `<img class="logo" src="${logo}" alt="${escapeHtml(brand.label)}">`;
  }
  // Logonya belum ada: nama tokonya tetap harus terbaca di kop.
  return `<div class="wordmark">${escapeHtml(brand.wordmark)}</div>`;
}

function signatureBlock(brand) {
  const signature = optionalDataUri(brand.assets.signature);
  return signature ? `<img src="${signature}" alt="">` : '';
}

function itemRows(items) {
  const filled = items.map(
    (item) => `<tr>
      <td class="c-qty">${escapeHtml(item.quantity)}</td>
      <td class="c-name">${escapeHtml(item.name)}</td>
      <td class="c-num">${escapeHtml(formatNumber(item.price))}</td>
      <td class="c-num">${escapeHtml(formatNumber(item.total))}</td>
    </tr>`
  );

  const blanks = Array.from(
    { length: Math.max(0, MIN_ROWS - filled.length) },
    () => '<tr><td class="c-qty">&nbsp;</td><td></td><td></td><td></td></tr>'
  );

  return [...filled, ...blanks].join('');
}

function bankLines(brand) {
  return brand.business.banks.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

function render(nota, brand) {
  const { business } = brand;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<style>
  @page { size: ${brand.widthMm}mm auto; margin: 0; }

  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    width: ${brand.widthMm}mm;
    padding: 11mm 10mm 9mm;
    /* DejaVu Sans selalu ada di Ubuntu, Arial di Windows - nota harus sama
       bentuknya di laptop dan di server. */
    font-family: Arial, Helvetica, 'DejaVu Sans', sans-serif;
    color: ${palette.ink};
    font-size: 3.1mm;
    line-height: 1.35;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Kop ---- */

  .kop { display: flex; align-items: flex-start; gap: 7mm; }
  .kop .logo { width: 30mm; height: auto; display: block; }
  .kop .wordmark { width: 30mm; font-size: 5mm; font-weight: 700; letter-spacing: 0.06em; }

  .kontak { padding-top: 1.5mm; display: grid; gap: 1.6mm; font-size: 3.05mm; }
  .kontak .baris { display: flex; align-items: flex-start; gap: 2.2mm; }
  .kontak svg { width: 3.6mm; height: 3.6mm; flex: none; margin-top: 0.2mm; }

  .garis-kop { border: 0; border-top: 0.45mm solid ${palette.navy}; margin: 4mm 0 4.5mm; }

  /* ---- Judul + identitas nota ---- */

  .judul-blok { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; }

  .judul { font-size: 7.6mm; font-weight: 700; line-height: 1.12; letter-spacing: -0.02em; }

  .identitas { flex: 1; padding-top: 1mm; display: grid; gap: 2.1mm; font-size: 3.1mm; }
  .identitas .baris { display: flex; align-items: baseline; gap: 2mm; }
  .identitas .label { width: 17mm; flex: none; }
  /* Titik-titik dibuat dari border supaya panjangnya selalu mengisi sisa kolom,
     bukan deretan karakter "." yang berubah panjang mengikuti font. */
  .identitas .isi {
    flex: 1;
    min-height: 4mm;
    border-bottom: 0.3mm dotted ${palette.line};
    padding: 0 0 0.4mm 1mm;
  }

  /* ---- Tabel item ---- */

  table { width: 100%; border-collapse: collapse; margin-top: 5mm; table-layout: fixed; }

  th, td {
    border: 0.25mm solid ${palette.navy};
    padding: 1.5mm 2mm;
    height: 7.2mm;
    vertical-align: middle;
    font-size: 3.1mm;
  }

  th {
    background: ${palette.navy};
    color: #fff;
    font-weight: 700;
    font-size: 3mm;
    height: 6.6mm;
    text-align: center;
  }

  th:nth-child(2) { text-align: left; }

  col.k-qty { width: 15%; }
  col.k-name { width: 40%; }
  col.k-harga { width: 22.5%; }
  col.k-total { width: 22.5%; }

  .c-qty { text-align: center; }
  .c-name { word-break: break-word; }
  .c-num { text-align: right; font-variant-numeric: tabular-nums; }

  /* ---- Rekening + total ---- */

  .bawah-tabel { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; margin-top: 3.5mm; }

  .rekening { font-size: 2.95mm; line-height: 1.5; }
  .rekening .nama { margin-top: 1.6mm; }

  .total { display: flex; width: 68mm; flex: none; }
  .total .label {
    width: 24mm;
    background: ${palette.navy};
    color: #fff;
    font-weight: 700;
    text-align: center;
    padding: 1.8mm 0;
    border: 0.25mm solid ${palette.navy};
  }
  .total .nilai {
    flex: 1;
    border: 0.25mm solid ${palette.navy};
    border-left: 0;
    padding: 1.8mm 2mm;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* ---- Tanda terima / hormat kami ---- */

  .ttd-blok { display: flex; justify-content: space-between; gap: 10mm; margin-top: 9mm; }
  .ttd { width: 52mm; }
  .ttd .judul-kecil { font-weight: 700; font-size: 3.1mm; }
  /* Tinggi dikunci supaya garis tanda tangan kiri dan kanan tetap sejajar,
     baik kolomnya berisi gambar tanda tangan maupun kosong. */
  .ttd .ruang { height: 15mm; display: flex; align-items: flex-end; }
  .ttd .ruang img { height: 13mm; width: auto; display: block; margin-left: 4mm; }
  .ttd .garis { border-top: 0.3mm dotted ${palette.line}; }
  .ttd .nama-terang { margin-top: 1.4mm; text-align: center; font-size: 3mm; }
</style>
</head>
<body>

  <div class="kop">
    ${logoBlock(brand)}
    <div class="kontak">
      <div class="baris">${iconPhone()}<span>${escapeHtml(business.phone)}</span></div>
      <div class="baris">${iconPin()}<span>${escapeHtml(business.address)}</span></div>
    </div>
  </div>

  <hr class="garis-kop">

  <div class="judul-blok">
    <div class="judul">Nota<br>Pembayaran</div>
    <div class="identitas">
      <div class="baris"><span class="label">No:</span><span class="isi"></span></div>
      <div class="baris"><span class="label">Nama:</span><span class="isi">${escapeHtml(nota.customerName)}</span></div>
      <div class="baris"><span class="label">Tanggal:</span><span class="isi">${escapeHtml(nota.dateLabel)}</span></div>
    </div>
  </div>

  <table>
    <colgroup>
      <col class="k-qty"><col class="k-name"><col class="k-harga"><col class="k-total">
    </colgroup>
    <thead>
      <tr><th>Jumlah</th><th>Nama Item</th><th>Harga</th><th>Total</th></tr>
    </thead>
    <tbody>${itemRows(nota.items)}</tbody>
  </table>

  <div class="bawah-tabel">
    <div class="rekening">
      <div>Pembayaran dapat dilakukan</div>
      <div>melalui rekening :</div>
      <div class="nama">${escapeHtml(business.accountName)}</div>
      ${bankLines(brand)}
    </div>
    <div class="total">
      <div class="label">Total</div>
      <div class="nilai">${escapeHtml(formatNumber(nota.total))}</div>
    </div>
  </div>

  <div class="ttd-blok">
    <div class="ttd">
      <div class="judul-kecil">Tanda Terima,</div>
      <div class="ruang"></div>
      <div class="garis"></div>
    </div>
    <div class="ttd">
      <div class="judul-kecil">Hormat Kami,</div>
      <div class="ruang">${signatureBlock(brand)}</div>
      <div class="garis"></div>
      <div class="nama-terang">${escapeHtml(business.signer)}</div>
    </div>
  </div>

</body>
</html>`;
}

module.exports = { render, MIN_ROWS };
