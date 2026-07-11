const PRODUCT_ROWS = {
  'box 68': 3,
  '68x47x40': 3,
  'box 73': 4,
  '73x41x30': 4,
  'box 50': 5,
  '50x37x32': 5,
  'box 51': 6,
  '51x34x16': 6,
  'box 37': 7,
  '37x29x32': 7,
  'box 39 gepeng': 8,
  '39 gepeng': 8,
  '39x25x16': 8,
  'box 26': 9,
  '26x17x27': 9,
  'box 33': 10,
  '33x24x30': 10,
  'box 39 tebal': 11,
  '39 tebal': 11,
  '39x24x29': 11,
  'box 25': 12,
  '25x20x28': 12,
  'box 120': 13,
  '120x43x32': 13,
  'box 73 keras': 14,
  '73x41x30 keras': 14,
  '73x41x30 - keras': 14,
  'lembaran 1cm': 16,
  'lembaran tebal 1 cm': 16,
  'lembaran 2cm': 17,
  'lembaran tebal 2 cm': 17,
  'lembaran 3cm': 18,
  'lembaran tebal 3 cm': 18,
  'lembaran 4cm': 19,
  'lembaran tebal 4 cm': 19,
  'lembaran 5cm': 20,
  'lembaran tebal 5 cm': 20,
  'box 68 lakban': 23,
  '68x47x40 lakban': 23,
  'box 73 lakban': 24,
  '73x41x30 lakban': 24,
  'box 50 lakban': 25,
  '50x37x32 lakban': 25,
  'box 51 lakban': 26,
  '51x34x16 lakban': 26,
  'box 37 lakban': 27,
  '37x29x32 lakban': 27,
  'box 39 gepeng lakban': 28,
  'box 39 lakban gepeng': 28,
  '39 gepeng lakban': 28,
  '39x25x16 lakban': 28,
  'box 26 lakban': 29,
  '26x17x27 lakban': 29,
  'box 33 lakban': 30,
  '33x24x30 lakban': 30,
  'box 39 tebal lakban': 31,
  'box 39 lakban tebal': 31,
  '39 tebal lakban': 31,
  '39x24x29 lakban': 31,
  'box 25 lakban': 32,
  '25x20x28 lakban': 32,
  'box 120 lakban': 33,
  '120x43x32 lakban': 33,
  'box 73 keras lakban': 34,
  'box 73 lakban keras': 34,
  '73x41x30 keras lakban': 34,
  'pe foam lembaran 50x100 1cm': 37,
  'pe foam lemaran 50x100 1cm': 37,
  'pe foam 1cm': 37,
  'pe foam lembaran 50x100 2cm': 38,
  'pe foam lemaran 50x100 2cm': 38,
  'pe foam 2cm': 38,
  'pe foam lembaran 50x100 3cm': 39,
  'pe foam lemaran 50x100 3cm': 39,
  'pe foam 3cm': 39,
  'pe foam lembaran 50x100 5cm': 40,
  'pe foam lemaran 50x100 5cm': 40,
  'pe foam 5cm': 40,
  'aluminium foil': 42,
  'aluminium foil bubble': 43,
  'aluminium foil bubble per rol': 43,
  'ice gel': 45,
  'ice gell': 45,
  'pe pipa d 8 td 1,5 - 2 mtr': 47,
  'pe pipa d8': 47,
  'pipa d8': 47,
  'pe pipa d 9 td 2,5 - 2 mtr': 48,
  'pe pipa d9': 48,
  'pipa d9': 48,
  'model pisau kawat - segitiga': 50,
  'pisau kawat segitiga': 50,
  'model pensil - solder 10 cm': 51,
  'solder 10 cm': 51,
  'solder 10cm': 51,
  'model pensil - solder 25 cm': 52,
  'solder 25 cm': 52,
  'solder 25cm': 52,
  'lem 100ml': 54,
  'lem 100 ml': 54,
  'lem 500ml': 55,
  'lem 500 ml': 55,
  'box 50 bekas': 60,
  'box 33 bekas': 61,
};

function normalizeProductName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/lembaran\s+(\d+)\s*cm/g, 'lembaran $1cm')
    .replace(/^box\s+lakban\s+(\d+)(?:\s+(.+))?$/, (_, size, variant) =>
      `box ${size}${variant ? ` ${variant}` : ''} lakban`
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRecapPart(body) {
  const lines = String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dateMatch = lines[0]?.match(/^(revisi\s+)?(\d{1,2})\s+([a-zA-Z]{3,})$/i);
  const quantities = [];
  const unknownProducts = [];

  for (const line of lines.slice(dateMatch ? 1 : 0)) {
    const itemMatch = line.match(/^(.+?)\s*=\s*(\d+)(?:\s+set)?$/i);
    if (!itemMatch) {
      continue;
    }

    const product = normalizeProductName(itemMatch[1]);
    const row = PRODUCT_ROWS[product];
    if (!row) {
      unknownProducts.push(itemMatch[1].trim());
      continue;
    }

    quantities.push({ product, row, quantity: Number(itemMatch[2]) });
  }

  if (!dateMatch && !quantities.length) {
    return null;
  }

  return {
    date: dateMatch ? `${dateMatch[2]} ${dateMatch[3]}` : null,
    isRevision: Boolean(dateMatch?.[1]),
    quantities,
    unknownProducts,
  };
}

function parseRecapMessage(body) {
  const recap = parseRecapPart(body);
  return recap?.date && recap.quantities.length ? recap : null;
}

function normalizeRecapDate(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bmay\b/g, 'mei')
    .replace(/\baug\b/g, 'agu')
    .replace(/\boct\b/g, 'okt')
    .replace(/\bdec\b/g, 'des')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRecapFromMessages(messages, targetDate) {
  const parts = messages
    .map((message) => parseRecapPart(message.body))
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part);
  const datedParts = parts.filter(({ part }) => part.date);
  const normalizedTargetDate = normalizeRecapDate(targetDate);
  const start = datedParts
    .filter(({ part }) => !normalizedTargetDate || normalizeRecapDate(part.date) === normalizedTargetDate)
    .at(-1);

  if (!start) {
    return null;
  }

  const combinedQuantities = new Map();
  const unknownProducts = new Set();
  for (const { part, index } of parts) {
    if (index < start.index) {
      continue;
    }
    if (index > start.index && part.date) {
      break;
    }

    for (const item of part.quantities) {
      const existing = combinedQuantities.get(item.product);
      combinedQuantities.set(item.product, {
        ...item,
        quantity: (existing?.quantity || 0) + item.quantity,
      });
    }
    part.unknownProducts.forEach((product) => unknownProducts.add(product));
  }

  const quantities = [...combinedQuantities.values()];
  if (!quantities.length) {
    return null;
  }

  return {
    date: start.part.date,
    quantities,
    unknownProducts: [...unknownProducts],
  };
}

module.exports = { buildRecapFromMessages, parseRecapMessage, parseRecapPart, PRODUCT_ROWS };
