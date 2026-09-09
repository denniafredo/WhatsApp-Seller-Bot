const {
  applyShopeeReferencePrices,
  getShopeePriceRows,
  updateShopeeMappingColumns,
} = require('../sheets/googleSheets');
const { loadHargaTerbaru } = require('../sheets/hargaTerbaru');
const { formatPrice } = require('./shopeePriceSync');
const { mapShopeeProduct } = require('./shopeeProductMap');

async function applyHargaTerbaru() {
  const [rows, hargaTerbaru] = await Promise.all([getShopeePriceRows(), loadHargaTerbaru()]);

  // Mapping dihitung ulang dari nama produk di kolom A, jadi perubahan harga jual di
  // "Harga Terbaru" langsung terbaca tanpa perlu menarik ulang produk dari Shopee.
  const remapped = rows.map((row) => {
    if (!row.product) {
      return { ...row, summary: '', referencePrice: null, source: '' };
    }

    const mapped = mapShopeeProduct(hargaTerbaru, row.product);

    return {
      ...row,
      previousReferencePrice: row.referencePrice,
      summary: mapped.summary,
      referencePrice: mapped.referencePrice,
      source: mapped.source,
    };
  });

  await updateShopeeMappingColumns(remapped);

  const filled = remapped.filter((row) => row.product);
  const mapped = filled.filter((row) => row.referencePrice);
  const refreshed = mapped.filter((row) => row.referencePrice !== row.previousReferencePrice);
  const changed = mapped.filter((row) => row.referencePrice !== row.price);
  const manual = filled.filter((row) => !row.referencePrice);

  if (changed.length) {
    await applyShopeeReferencePrices(
      changed.map((row) => ({ row: row.row, price: row.referencePrice }))
    );
  }

  return { total: filled.length, mapped, refreshed, changed, manual, sheetName: hargaTerbaru.sheetName };
}

function buildMapReport(result) {
  const lines = [
    `Kolom F disegarkan dari "${result.sheetName}": ${result.mapped.length} baris termapping, ${result.refreshed.length} berubah nilainya, ${result.manual.length} baris manual (tidak disentuh).`,
    `Kolom B disamakan dengan kolom F: ${result.changed.length} baris.`,
  ];

  result.changed.slice(0, 30).forEach((row) => {
    lines.push(
      `  baris ${row.row}: ${formatPrice(row.price ?? 0)} → ${formatPrice(row.referencePrice)}  [${row.summary || row.product.slice(0, 40)}]`
    );
  });

  if (result.changed.length > 30) {
    lines.push(`  ... dan ${result.changed.length - 30} baris lainnya.`);
  }

  if (result.changed.length) {
    lines.push('Cek sheet-nya dulu, kalau sudah oke: npm run sync:harga');
  }

  return lines.join('\n');
}

module.exports = { applyHargaTerbaru, buildMapReport };
