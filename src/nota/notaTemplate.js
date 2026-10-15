// Pemilih template nota. Tiap toko punya nota cetak dengan bentuk yang
// berbeda - jumlah kolom, ukuran kertas, letak rekening - jadi masing-masing
// punya modul penggambar sendiri di templates/, bukan satu berkas penuh
// percabangan.

const dashmall = require('./templates/dashmall');
const marvel = require('./templates/marvel');

const templates = { dashmall, marvel };

/**
 * @param nota hasil parseNota().nota
 * @param brand hasil resolveBrand()
 * @returns string HTML lengkap, siap dipakai page.setContent()
 */
function renderNotaHtml(nota, brand) {
  const template = templates[brand?.template];

  if (!template) {
    throw new Error(`Template nota "${brand?.template}" tidak dikenal.`);
  }

  return template.render(nota, brand);
}

module.exports = {
  renderNotaHtml,
  templates,
};
