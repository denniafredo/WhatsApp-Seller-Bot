// Logo dan tanda tangan untuk template nota.
//
// Aset ditempel sebagai data URI, bukan <img src="file://">: halaman dibuat
// lewat setContent() yang tidak punya base URL, jadi path file relatif tidak
// akan pernah termuat.
//
// Aset yang belum ada TIDAK membuat nota gagal - template yang memutuskan apa
// gantinya (tulisan nama toko, atau kolom tanda tangan dikosongkan). Brand
// baru sering dipakai lebih dulu, logonya menyusul.

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', '..', 'assets');

// Hanya keberhasilan yang disimpan. Kalau file-nya belum ada, pemeriksaannya
// diulang tiap render supaya logo yang baru ditaruh langsung terpakai tanpa
// perlu restart bot.
const cache = new Map();

/**
 * @returns data URI, atau null bila filenya belum ada.
 */
function optionalDataUri(fileName) {
  if (!fileName) {
    return null;
  }

  if (cache.has(fileName)) {
    return cache.get(fileName);
  }

  const filePath = path.join(assetsDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const uri = `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
  cache.set(fileName, uri);
  return uri;
}

function hasAsset(fileName) {
  return optionalDataUri(fileName) !== null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  optionalDataUri,
  hasAsset,
  escapeHtml,
  assetsDir,
};
