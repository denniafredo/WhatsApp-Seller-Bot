// Daftar toko yang notanya bisa dibuat bot.
//
// Tiap toko punya nota cetak sendiri yang bentuknya memang beda - Dash Mall
// A5 dengan kolom Jumlah dan Nama pelanggan, Marvel A6 tanpa keduanya - jadi
// yang dibedakan bukan cuma isi teksnya, tapi templatenya. Modul ini hanya
// menyimpan datanya; yang menggambar ada di notaTemplate.js.
//
// Semua isinya bisa ditimpa lewat .env dengan pola NOTA_<BRAND>_<FIELD>,
// misalnya NOTA_MARVEL_PHONE. Nomor rekening dan alamat berubah tanpa perlu
// menyentuh kode.

function env(brandKey, field, fallback) {
  const value = process.env[`NOTA_${brandKey.toUpperCase()}_${field}`];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

// Dipisah ";" karena "|" sudah dipakai sebagai pemisah kolom di perintahnya.
function envList(brandKey, field, fallback) {
  return env(brandKey, field, fallback)
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildDashMall() {
  const key = 'dashmall';
  return {
    key,
    label: 'Dash Mall',
    aliases: ['dashmall', 'dash', 'dm'],
    template: 'dashmall',
    // A5, ukuran nota cetaknya.
    widthMm: 148,
    minHeightMm: 210,
    // Notanya punya kolom "Nama:" untuk pelanggan.
    showsCustomerName: true,
    assets: { logo: 'nota-dashmall-logo.png', signature: 'nota-dashmall-ttd.png' },
    wordmark: 'DASH MALL',
    business: {
      phone: env(key, 'PHONE', '0851-7670-7544'),
      address: env(key, 'ADDRESS', 'Jl. Gendong Raya 38, Sendangmulyo, Semarang'),
      accountName: env(key, 'ACCOUNT_NAME', 'Denni Afredo Suryono H'),
      banks: envList(key, 'BANKS', 'BCA | 8915836379;Seabank | 901150516761'),
      signer: env(key, 'SIGNER', 'Denni'),
    },
  };
}

function buildMarvel() {
  const key = 'marvel';
  return {
    key,
    label: 'Marvel Sterofoam',
    aliases: ['marvel', 'mv'],
    template: 'marvel',
    // A6, notanya memang selembar kecil.
    widthMm: 105,
    minHeightMm: 148,
    // Notanya TIDAK punya kolom nama pelanggan, jadi "nama:" di perintahnya
    // diabaikan seluruhnya - tidak ke nota, tidak ke nama file.
    showsCustomerName: false,
    assets: { logo: 'nota-marvel-logo.png', signature: 'nota-marvel-ttd.png' },
    wordmark: 'MARVEL STEROFOAM',
    business: {
      phone: env(key, 'PHONE', '0851-6354-6804'),
      address: env(key, 'ADDRESS', 'Kukilo Mukti Raya 127, Pedurungan Kidul, Semarang'),
      // Notanya menulis rekeningnya satu baris utuh: "8915267927 A.N Yohan Marvel".
      bankLabel: env(key, 'BANK', 'BCA'),
      accountNumber: env(key, 'ACCOUNT_NUMBER', '8915267927'),
      accountName: env(key, 'ACCOUNT_NAME', 'Yohan Marvel'),
      signer: env(key, 'SIGNER', 'Yohan'),
    },
  };
}

const builders = [buildDashMall, buildMarvel];

// Dibangun ulang tiap panggilan supaya .env yang berubah langsung terpakai,
// sejalan dengan cara ongkirTrigger membaca alias titik asal.
function listBrands() {
  return builders.map((build) => build());
}

const DEFAULT_BRAND = 'dashmall';

/**
 * @param alias nama toko yang diketik ("marvel"), boleh kosong.
 * @returns brand, atau null bila aliasnya tidak dikenal.
 */
function resolveBrand(alias) {
  const normalized = String(alias || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const brands = listBrands();

  if (!normalized) {
    return brands.find((brand) => brand.key === DEFAULT_BRAND) || brands[0];
  }

  return brands.find((brand) => brand.aliases.includes(normalized)) || null;
}

function listAliases() {
  return listBrands().map((brand) => ({ alias: brand.aliases[0], label: brand.label }));
}

module.exports = {
  listBrands,
  listAliases,
  resolveBrand,
  DEFAULT_BRAND,
};
