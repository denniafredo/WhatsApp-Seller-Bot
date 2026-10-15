// Nota Marvel Sterofoam, meniru nota cetaknya: selembar A6 hitam-putih dengan
// kop logo + kotak tanggal/alamat, tabel empat kolom, dan pita rekening di
// kaki.
//
// Bedanya dengan nota Dash Mall: tidak ada kolom "Nama" pelanggan - yang ada
// di kop cuma tanggal dan alamat toko - jadi "nama:" di perintahnya cuma
// dipakai sebagai nama file untuk brand ini.

const { formatNumber } = require('../notaParser');
const { optionalDataUri, escapeHtml } = require('../notaAssets');

// Sebanyak baris kosong di nota cetaknya.
const MIN_ROWS = 11;

const palette = {
  ink: '#333333',
  bar: '#9d9d9d',
  band: '#b8b8b8',
  border: '#8c8c8c',
  muted: '#f2f2f2',
};

function iconWhatsApp() {
  return `<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18a8 8 0 01-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1112 20zm4.4-5.8c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.6 6.6 0 01-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 4 .6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.4-.6 1.6-1.2.2-.6.2-1.1.1-1.2l-.4-.2z"/></svg>`;
}

function logoBlock(brand) {
  const logo = optionalDataUri(brand.assets.logo);
  if (logo) {
    return `<img class="logo" src="${logo}" alt="${escapeHtml(brand.label)}">`;
  }
  // Logo belum dikirim: nama tokonya ditulis dengan bentuk yang sama seperti
  // di nota cetaknya - "MARVEL" tebal di atas "STEROFOAM".
  const [first, ...rest] = brand.wordmark.split(/\s+/);
  return `<div class="wordmark">
    <div class="w1">${escapeHtml(first)}</div>
    <div class="w2">${escapeHtml(rest.join(' '))}</div>
  </div>`;
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

function signatureBlock(brand) {
  const signature = optionalDataUri(brand.assets.signature);
  return signature ? `<img class="ttd" src="${signature}" alt="">` : '';
}

function render(nota, brand) {
  const { business } = brand;
  const signer = business.signer
    ? `<div class="nama-terang">${escapeHtml(business.signer)}</div>`
    : '';

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
    padding: 7mm 6mm 6mm;
    font-family: Arial, Helvetica, 'DejaVu Sans', sans-serif;
    color: ${palette.ink};
    font-size: 2.6mm;
    line-height: 1.3;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Kop: logo + kotak tanggal/alamat ---- */

  .kop { display: flex; align-items: flex-start; gap: 4mm; }

  .kop .logo { width: 46mm; height: auto; display: block; }

  .wordmark { width: 46mm; line-height: 1.02; }
  .wordmark .w1 { font-size: 7.4mm; font-weight: 700; letter-spacing: 0.02em; }
  .wordmark .w2 { font-size: 5.4mm; font-weight: 700; letter-spacing: 0.02em; }

  .kotak-tanggal {
    flex: 1;
    border: 0.25mm solid ${palette.border};
    padding: 1.6mm 2mm 2mm;
    text-align: center;
  }
  .kotak-tanggal .label {
    font-size: 2.3mm;
    font-weight: 700;
    letter-spacing: 0.16em;
    color: #8f8f8f;
  }
  .kotak-tanggal .nilai {
    margin-top: 0.8mm;
    padding-bottom: 1mm;
    border-bottom: 0.3mm solid ${palette.ink};
    font-size: 2.6mm;
  }
  .kotak-tanggal .alamat { margin-top: 1.2mm; font-size: 2.3mm; font-weight: 700; line-height: 1.25; }

  /* ---- Tabel ---- */

  table { width: 100%; border-collapse: collapse; margin-top: 3.5mm; table-layout: fixed; }

  th, td {
    border: 0.22mm solid ${palette.border};
    padding: 1mm 1.4mm;
    height: 5.4mm;
    vertical-align: middle;
    font-size: 2.6mm;
  }

  th {
    background: ${palette.bar};
    color: #fff;
    font-weight: 700;
    font-size: 2.3mm;
    letter-spacing: 0.1em;
    height: 5mm;
    text-align: center;
  }

  col.k-qty { width: 13%; }
  col.k-name { width: 40%; }
  col.k-harga { width: 23.5%; }
  col.k-total { width: 23.5%; }

  .c-qty { text-align: center; }
  .c-name { word-break: break-word; }
  .c-num { text-align: right; font-variant-numeric: tabular-nums; }

  /* ---- Tanda terima / hormat kami / total ---- */

  /* Lebarnya disamakan dengan kolom tabel di atasnya supaya "Hormat Kami" dan
     kotak Total jatuh tepat di bawah kolom Harga dan Total. */
  .kaki { display: flex; align-items: flex-start; margin-top: 2mm; }
  .kaki .kolom { width: 23.5%; font-size: 2.5mm; }
  .kaki .kolom.lebar { width: 53%; }

  /* Ruang tanda tangan dikunci tingginya supaya tata letaknya tidak bergeser
     saat gambar tanda tangannya menyusul. */
  .kaki .ruang { height: 11mm; display: flex; align-items: flex-end; }
  .kaki .ruang .ttd { height: 9mm; width: auto; display: block; }
  .kaki .nama-terang { font-size: 2.4mm; }

  .total {
    display: flex;
    align-items: stretch;
    border: 0.25mm solid ${palette.ink};
    font-weight: 700;
    font-size: 2.7mm;
  }
  .total .label { padding: 1.2mm 1.4mm; border-right: 0.25mm solid ${palette.ink}; }
  .total .nilai { flex: 1; padding: 1.2mm 1.4mm; text-align: right; font-variant-numeric: tabular-nums; }

  /* ---- Pita rekening ---- */

  .pita {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin-top: 4mm;
    background: ${palette.band};
    padding: 2mm 3mm;
  }
  .pita .rekening { flex: 1; text-align: center; line-height: 1.3; }
  .pita .rekening .judul { font-size: 2.2mm; font-weight: 700; letter-spacing: 0.06em; }
  .pita .rekening .bank { font-size: 3.6mm; font-weight: 700; letter-spacing: 0.04em; }
  .pita .rekening .nomor { font-size: 2.3mm; font-weight: 700; }

  .pita .telepon { display: flex; align-items: center; gap: 1.6mm; font-size: 2.6mm; font-weight: 700; }
  .pita .telepon .bulat {
    width: 4.6mm;
    height: 4.6mm;
    border-radius: 50%;
    background: ${palette.ink};
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .pita .telepon svg { width: 3.2mm; height: 3.2mm; }
</style>
</head>
<body>

  <div class="kop">
    ${logoBlock(brand)}
    <div class="kotak-tanggal">
      <div class="label">TANGGAL</div>
      <div class="nilai">${escapeHtml(nota.dateLabel)}</div>
      <div class="alamat">${escapeHtml(business.address)}</div>
    </div>
  </div>

  <table>
    <colgroup>
      <col class="k-qty"><col class="k-name"><col class="k-harga"><col class="k-total">
    </colgroup>
    <thead>
      <tr><th>JML</th><th>NAMA BARANG</th><th>HARGA</th><th>TOTAL</th></tr>
    </thead>
    <tbody>${itemRows(nota.items)}</tbody>
  </table>

  <div class="kaki">
    <div class="kolom lebar">
      <div>Tanda Terima</div>
      <div class="ruang"></div>
    </div>
    <div class="kolom">
      <div>Hormat Kami</div>
      <div class="ruang">${signatureBlock(brand)}</div>
      ${signer}
    </div>
    <div class="kolom">
      <div class="total">
        <div class="label">Total</div>
        <div class="nilai">${escapeHtml(formatNumber(nota.total))}</div>
      </div>
    </div>
  </div>

  <div class="pita">
    <div class="rekening">
      <div class="judul">REKENING PEMBAYARAN</div>
      <div class="bank">${escapeHtml(business.bankLabel)}</div>
      <div class="nomor">${escapeHtml(business.accountNumber)} A.N ${escapeHtml(business.accountName)}</div>
    </div>
    <div class="telepon">
      <span class="bulat">${iconWhatsApp()}</span>
      <span>${escapeHtml(business.phone)}</span>
    </div>
  </div>

</body>
</html>`;
}

module.exports = { render, MIN_ROWS };
