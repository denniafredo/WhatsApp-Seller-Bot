const { getSheetValues } = require('./googleSheets');

const DIMENSION_PATTERN = /(\d+x\d+x\d+)/;

function getHargaTerbaruSheetName() {
  return process.env.HARGA_TERBARU_SHEET_NAME || 'Harga Terbaru';
}

function isNumeric(value) {
  return value !== '' && value !== undefined && value !== null && Number.isFinite(Number(value));
}

function normalizeDimension(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function findDimension(value) {
  return normalizeDimension(value).match(DIMENSION_PATTERN)?.[1] || null;
}

/**
 * Tab "Harga Terbaru" tersusun sebagai blok: satu baris judul section (kolom C bukan angka)
 * diikuti baris-baris item dengan kolom C = harga beli dan kolom D = harga jual.
 */
async function loadHargaTerbaru() {
  const sheetName = getHargaTerbaruSheetName();
  const values = await getSheetValues(`'${sheetName}'!A1:D`);
  const sections = new Map();
  let currentSection = null;

  values.forEach((columns, index) => {
    const name = String(columns[0] ?? '').trim();
    const variant = String(columns[1] ?? '').trim();
    const buyPrice = columns[2];
    const sellPrice = columns[3];

    if (!name && !variant) {
      return;
    }

    if (name && !isNumeric(buyPrice)) {
      currentSection = name;
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      return;
    }

    if (!currentSection) {
      return;
    }

    sections.get(currentSection).push({
      row: index + 1,
      name,
      variant,
      buyPrice: isNumeric(buyPrice) ? Number(buyPrice) : null,
      sellPrice: isNumeric(sellPrice) ? Number(sellPrice) : null,
    });
  });

  return { sheetName, sections, boxLookups: new Map() };
}

function getBoxLookup(hargaTerbaru, sectionName) {
  if (hargaTerbaru.boxLookups.has(sectionName)) {
    return hargaTerbaru.boxLookups.get(sectionName);
  }

  const lookup = new Map();
  (hargaTerbaru.sections.get(sectionName) || []).forEach((item) => {
    // Section box normal menaruh ukuran di kolom B, section box bekas menaruhnya di kolom A.
    const dimension = findDimension(item.variant) || findDimension(item.name);
    if (!dimension) {
      return;
    }

    // 73x41x30 dipakai dua kali (Garuda 75 BS vs Garuda Keras), jadi disimpan per kualifier juga.
    const qualifiers = [/keras/i.test(item.name) ? 'keras' : 'biasa'];
    if (/polos/i.test(item.name)) {
      qualifiers.push('polos');
    }
    if (/lakban/i.test(item.name)) {
      qualifiers.push('lakban');
    }

    qualifiers.forEach((qualifier) => {
      const key = `${dimension}|${qualifier}`;
      if (!lookup.has(key)) {
        lookup.set(key, item);
      }
    });
    if (!lookup.has(dimension)) {
      lookup.set(dimension, item);
    }
  });

  hargaTerbaru.boxLookups.set(sectionName, lookup);

  return lookup;
}

function resolveBoxPrice(hargaTerbaru, { section, dimension, qualifiers = [] }) {
  const lookup = getBoxLookup(hargaTerbaru, section);
  const item = qualifiers
    .map((qualifier) => lookup.get(`${dimension}|${qualifier}`))
    .find(Boolean) || lookup.get(dimension);

  if (!item) {
    return { item: null, reason: `section "${section}" tidak punya ukuran ${dimension}` };
  }

  if (item.sellPrice === null) {
    return { item, reason: `harga jual kosong di ${hargaTerbaru.sheetName}!D${item.row}` };
  }

  return { item, price: item.sellPrice };
}

function findInSection(hargaTerbaru, sectionName, predicate) {
  const items = hargaTerbaru.sections.get(sectionName) || [];
  if (!items.length) {
    return { item: null, reason: `section "${sectionName}" tidak ada di ${hargaTerbaru.sheetName}` };
  }

  const matches = items.filter((item) => {
    try {
      return predicate(item);
    } catch (error) {
      return false;
    }
  });

  if (!matches.length) {
    return { item: null, reason: `tidak ada item yang cocok di section "${sectionName}"` };
  }

  if (matches.length > 1) {
    return {
      item: null,
      reason: `ambigu di section "${sectionName}" (baris ${matches.map((item) => item.row).join(' & ')})`,
    };
  }

  const [item] = matches;
  if (item.sellPrice === null) {
    return { item, reason: `harga jual kosong di ${hargaTerbaru.sheetName}!D${item.row}` };
  }

  return { item, price: item.sellPrice };
}

module.exports = {
  findDimension,
  findInSection,
  getHargaTerbaruSheetName,
  loadHargaTerbaru,
  resolveBoxPrice,
};
