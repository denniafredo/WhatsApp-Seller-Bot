const { findDimension, findInSection, resolveBoxPrice } = require('../sheets/hargaTerbaru');
const { findAliasRule } = require('../sheets/hargaTerbaruAliases');

const BROWN_COLORS = ['cokelat', 'coklat'];
const TAPE_COLORS = [...BROWN_COLORS, 'biru', 'hijau', 'hitam', 'kuning', 'merah', 'pink', 'putih', 'lainnya'];

// Produk yang kebetulan punya angka mirip dimensi tapi bukan box gabus.
const NOT_A_BOX = /lembaran|palet|pallet|keranjang|kardus|butiran|jasa potong/i;
const BOX_MATERIALS = /sterofoam|styrofoam|gabus/i;
const BOX_SHAPES = /\bbox\b|kotak/i;

const SHORT_BOX_NAMES = new Map([
  ['68x47x40', 'Box 60 kg'],
  ['73x41x30', 'Garuda 75'],
  ['50x37x32', 'Box 35 kg'],
  ['51x34x16', 'Box 10 kg'],
  ['37x29x32', 'Box 30 kg'],
  ['39x25x16', 'Box 5 kg'],
  ['26x17x27', 'Box'],
  ['33x24x30', 'Box Tanggung'],
  ['39x24x29', 'Wawan Besar'],
  ['25x20x28', 'Wawan Kecil'],
  ['120x43x32', 'Panjang Biasa'],
]);

function splitProductName(fullName) {
  const separatorIndex = String(fullName).lastIndexOf(' - ');

  if (separatorIndex <= 0) {
    return { parent: String(fullName).trim(), variant: '' };
  }

  return {
    parent: String(fullName).slice(0, separatorIndex).trim(),
    variant: String(fullName).slice(separatorIndex + 3).trim(),
  };
}

/**
 * Nama produk Shopee mengandung semua info yang dibutuhkan untuk mencari harga di "Harga Terbaru":
 *   "[Khusus Luar Semarang] BOX ALUMINIUM + LAKBAN COKLAT / ... - 120x43x32, Cokelat + AL"
 *    ^ luar kota                    ^ pakai aluminium        ^ ukuran     ^ warna lakban
 * Untuk produk tanpa variasi, ukurannya ada di nama induk:
 *   "Box Es / Box Sterofoam / Box Gabus / Ice Box Styrofoam 68x47x40cm"
 */
function parseShopeeProductName(fullName) {
  const { parent, variant } = splitProductName(fullName);
  const combined = `${parent} ${variant}`;
  const dimension = findDimension(variant) || findDimension(parent);

  if (
    !dimension ||
    NOT_A_BOX.test(parent) ||
    !BOX_MATERIALS.test(combined) ||
    !BOX_SHAPES.test(combined)
  ) {
    return { parent, variant, isBox: false };
  }

  const variantLower = variant.toLowerCase();
  const color = TAPE_COLORS.find((candidate) => variantLower.includes(candidate)) || null;
  const isSecondHand = /bekas|second/i.test(combined);
  const isOutOfTown = /khusus luar semarang|luar kota/i.test(parent);
  const isHard = /keras/i.test(combined);
  const hasAluminium = /\+\s*al\b|aluminium/i.test(variantLower) || /aluminium/i.test(parent);
  const isBrown = BROWN_COLORS.includes(color);
  // Untuk box bekas, polos/lakban hanya boleh dibaca dari nama varian: nama induknya
  // menyebut "Lakban" untuk semua varian, termasuk yang polos.
  const hasTape = isSecondHand
    ? /lakban|isolasi/i.test(variant)
    : Boolean(color) || /lakban|isolasi/i.test(combined);

  let section;
  let qualifiers = [isHard ? 'keras' : 'biasa'];

  if (isSecondHand) {
    section = 'Sterofoam Box Bekas';
    qualifiers = [hasTape ? 'lakban' : 'polos'];
  } else if (!hasTape) {
    section = 'Sterofoam Box';
  } else if (isBrown || !color) {
    section = hasAluminium ? 'Sterofoam Box + Lakban + Aluminium' : 'Sterofoam Box + Lakban';
  } else {
    section = hasAluminium
      ? 'Sterofoam Box + Lakban Warna + Aluminium'
      : 'Sterofoam Box + Lakban Warna';
  }

  if (isOutOfTown && !isSecondHand) {
    section += ' (Luar Kota)';
  }

  const shortName = SHORT_BOX_NAMES.get(dimension) || 'Box';
  let finish = 'Polos';
  if (isSecondHand) {
    finish = hasTape ? 'Bekas Lakban' : 'Bekas Polos';
  } else if (color) {
    finish = [
      isBrown ? 'Lakban Coklat' : `Lakban ${color[0].toUpperCase()}${color.slice(1)}`,
      hasAluminium ? '+AL' : '',
    ].filter(Boolean).join(' ');
  } else if (hasTape) {
    finish = hasAluminium ? 'Lakban Coklat +AL' : 'Lakban Coklat';
  }

  const summary = [
    isOutOfTown ? 'LUAR' : 'SMG',
    finish,
    `${shortName} ${dimension}${isHard ? ' Keras' : ''}`,
  ].join(' · ');

  return {
    parent,
    variant,
    isBox: true,
    section,
    dimension,
    qualifiers,
    isHard,
    color,
    hasAluminium,
    isSecondHand,
    isOutOfTown,
    summary,
  };
}

function buildResult(hargaTerbaru, parsed, resolved, summary) {
  if (!resolved.item || !resolved.price) {
    return {
      parsed,
      summary,
      referencePrice: null,
      source: resolved.reason ? `? ${resolved.reason}` : 'manual',
    };
  }

  const label = `${parsed.section} › ${resolved.item.name || resolved.item.variant}`;

  return {
    parsed,
    summary,
    referencePrice: resolved.price,
    source: `${hargaTerbaru.sheetName}!D${resolved.item.row} · ${label}`,
  };
}

function mapShopeeProduct(hargaTerbaru, fullName) {
  const parsed = parseShopeeProductName(fullName);

  if (parsed.isBox) {
    return buildResult(hargaTerbaru, parsed, resolveBoxPrice(hargaTerbaru, parsed), parsed.summary);
  }

  const rule = findAliasRule(parsed.parent);
  if (!rule) {
    return { parsed, summary: '', referencePrice: null, source: 'manual' };
  }

  const context = { ...parsed, section: rule.section, hargaTerbaru };
  const resolved = findInSection(hargaTerbaru, rule.section, (item) => rule.find(item, context));
  // "Nama Barang" adalah baris judul blok teratas, bukan nama kategori yang berguna dibaca.
  const sectionLabel = rule.section === 'Nama Barang' ? '' : `${rule.section} · `;
  const summary = resolved.item
    ? `${sectionLabel}${resolved.item.name || resolved.item.variant}`
    : '';

  return buildResult(hargaTerbaru, { ...parsed, section: rule.section }, resolved, summary);
}

module.exports = { mapShopeeProduct, parseShopeeProductName, splitProductName };
