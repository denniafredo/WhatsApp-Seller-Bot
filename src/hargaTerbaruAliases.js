/**
 * Aturan pemetaan produk NON-BOX dari nama produk Shopee ke item di tab "Harga Terbaru".
 * Nama produk non-box tidak mengikuti pola apa pun, jadi dipetakan eksplisit di sini
 * daripada ditebak. Urutan penting: aturan yang lebih spesifik ditaruh lebih dulu.
 *
 * Setiap aturan:
 *   parent  = regex untuk nama produk induk di Shopee
 *   section = nama section di tab "Harga Terbaru"
 *   find    = predikat untuk memilih satu item di section itu; harus cocok tepat satu
 */

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactNumbers(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function firstNumber(value) {
  return String(value ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)/)?.[1] || null;
}

/** Ambil angka ketebalan, mis. "Lembaran 50x100cm Tebal 1cm" -> "1" (bukan "50"). */
function thickness(value) {
  const text = String(value ?? '').replace(',', '.');
  return text.match(/tebal\s*(\d+(?:\.\d+)?)/i)?.[1] || firstNumber(text);
}

/** Ambil pasangan dimensi 2 angka pertama, mis. "Ice Pack 15 x 19,5 x 3 cm" -> "15x19,5" */
function firstDimensionPair(value) {
  return compactNumbers(value).match(/(\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?)/)?.[1] || null;
}

function tapeColor(value) {
  const text = normalize(value);
  if (/fragile/.test(text)) return 'fragile';
  if (/double tape/.test(text)) return 'double';
  if (/bening/.test(text)) return 'bening';
  if (/coklat|cokelat/.test(text)) return 'coklat';
  if (/warna/.test(text)) return 'warna';
  return null;
}

function yardCount(value) {
  return normalize(value).match(/(\d+)\s*yard/)?.[1] || null;
}

function millimetreWidth(value) {
  return normalize(value).match(/(\d+)\s*mm/)?.[1] || null;
}

const PIPE_DIAMETER_BY_THICKNESS = new Map([['1.5', 'd 8'], ['2', 'd 9']]);

const ALIAS_RULES = [
  {
    id: 'thermal-mini-bag',
    parent: /thermal mini bag/i,
    section: 'Therma Pack Bag',
    find: (item, { variant }) => normalize(item.name) === normalize(`Mini Bag - ${variant}`),
  },
  {
    id: 'thermal-lunch-bag',
    parent: /thermal lunch bag/i,
    section: 'Therma Pack Bag',
    find: (item, { variant }) => normalize(item.name) === normalize(`Lunch Bag - ${variant}`),
  },
  {
    id: 'thermal-cake-bag',
    parent: /thermal cake bag/i,
    section: 'Therma Pack Bag',
    find: (item, { variant }) => normalize(item.name) === normalize(`Cake Bag - ${variant}`),
  },
  {
    id: 'ice-pack',
    parent: /ice pack/i,
    section: 'Ice Pack',
    find: (item, { parent, variant }) => {
      const pair = firstDimensionPair(item.name);
      return Boolean(pair) && compactNumbers(`${variant} ${parent}`).includes(pair);
    },
  },
  {
    id: 'ice-gel-renceng',
    parent: /ice gel lembaran|thermafreeze/i,
    section: 'Nama Barang',
    find: (item) => /ice gel \(renceng/i.test(item.name),
  },
  {
    id: 'ice-gel-bekas',
    parent: /ice (gel|cool)/i,
    section: 'Ice Gel Pack Bekas',
    find: (item, { parent, variant }) => {
      const wantFrozen = /sudah beku|siap pakai/i.test(parent);
      if (wantFrozen !== /beku/i.test(item.name)) {
        return false;
      }

      const pair = firstDimensionPair(item.variant);
      return Boolean(pair) && compactNumbers(variant).includes(pair);
    },
  },
  // PE Foam harus diperiksa sebelum aturan lembaran styrofoam: namanya menyebut
  // "Busa Sterofoam Lembaran" padahal harganya ada di section PE FOAM.
  {
    id: 'pe-foam-pipa',
    parent: /pe foam silinder|foam .*pipa/i,
    section: 'PE FOAM',
    find: (item, { variant }) => {
      const diameter = PIPE_DIAMETER_BY_THICKNESS.get(firstNumber(variant));
      return Boolean(diameter) && normalize(item.name).includes(`pipa ${diameter}`);
    },
  },
  {
    id: 'pe-foam-lembaran',
    parent: /pe foam lembaran/i,
    section: 'PE FOAM',
    find: (item, { variant }) =>
      /lembaran/i.test(item.name) && thickness(item.name) === firstNumber(variant),
  },
  {
    id: 'busa-karangan-bunga',
    parent: /busa karangan/i,
    section: 'PE FOAM',
    find: (item) => /busa karangan/i.test(item.name),
  },
  {
    id: 'styrofoam-lembaran',
    parent: /lembaran (styrofoam|sterofoam)|(sterofoam|styrofoam) lembaran/i,
    skip: /jasa|pe foam|polyfoam|polifoam/i,
    section: 'Sterofoam Lembaran 50x100cm',
    find: (item, { variant }) => thickness(item.name) === firstNumber(variant),
  },
  {
    id: 'foil-roll',
    parent: /kertas panggang|foil roll food/i,
    section: 'Aluminium Foil Roll',
    find: (item, { variant }) => firstNumber(item.variant) === firstNumber(variant),
  },
  {
    id: 'aluminium-foil-bubble-roll',
    parent: /aluminium foil bubble roll/i,
    section: 'Nama Barang',
    find: (item) => /aluminium foil bubble roll/i.test(item.name),
  },
  {
    id: 'aluminium-foil-bubble-meteran',
    parent: /aluminium foil bubble/i,
    section: 'Nama Barang',
    find: (item) => /^aluminium foil bubble \(/i.test(item.name),
  },
  {
    id: 'bubble-wrap-roll',
    parent: /bubble ?wrap roll|roll utuh/i,
    section: 'Nama Barang',
    find: (item) => /bubble wrap hitam roll/i.test(item.name),
  },
  {
    id: 'bubble-wrap-meteran',
    parent: /bubble ?wrap/i,
    section: 'Nama Barang',
    find: (item) => /^bubble wrap hitam \(/i.test(item.name),
  },
  {
    id: 'lakban',
    parent: /lakban|isolasi|double tape/i,
    section: 'Lakban & Double Tape',
    find: (item, { parent, variant, section, hargaTerbaru }) => {
      const wantColor = tapeColor(variant) || tapeColor(parent);
      if (tapeColor(item.name) !== wantColor) {
        return false;
      }

      // Warna lakban bisa punya beberapa panjang/lebar; disaring hanya kalau memang perlu.
      const sameColor = (hargaTerbaru.sections.get(section) || []).filter(
        (candidate) => tapeColor(candidate.name) === wantColor
      );
      if (sameColor.length === 1) {
        return true;
      }

      const wantYard = yardCount(variant) || yardCount(parent);
      const byYard = sameColor.filter((candidate) => yardCount(candidate.name) === wantYard);
      if (byYard.length === 1) {
        return byYard[0].row === item.row;
      }

      const wantWidth = millimetreWidth(parent);
      const pool = byYard.length ? byYard : sameColor;
      const byWidth = pool.filter((candidate) => millimetreWidth(candidate.name) === wantWidth);

      return byWidth.length === 1 && byWidth[0].row === item.row;
    },
  },
  {
    id: 'lem-sterofoam',
    parent: /lem (sterofoam|styrofoam)|eha bond/i,
    section: 'Nama Barang',
    find: (item, { parent, variant }) =>
      /^lem sterofoam/i.test(item.name) && firstNumber(item.name) === firstNumber(variant || parent),
  },
  {
    id: 'pisau-kawat',
    parent: /alat pemotong gabus/i,
    section: 'Nama Barang',
    find: (item) => /pisau kawat/i.test(item.name),
  },
  {
    id: 'solder-pensil',
    parent: /ukir craft|sterofom cutter|foam cutter/i,
    section: 'Nama Barang',
    find: (item, { variant }) =>
      /model pensil/i.test(item.name) && firstNumber(item.name) === firstNumber(variant),
  },
];

function findAliasRule(parent) {
  return (
    ALIAS_RULES.find((rule) => rule.parent.test(parent) && !rule.skip?.test(parent)) || null
  );
}

module.exports = { ALIAS_RULES, findAliasRule };
