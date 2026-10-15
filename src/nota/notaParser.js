// Teks perintah -> isi nota. Murni deterministik: tidak ada AI di jalur ini,
// karena angka yang keluar dipakai sebagai nota resmi ke pelanggan.
//
// Baris item dipisah dengan "|":
//
//   1 | Box 37 lakban | 50000
//
// Pemisah eksplisit dipilih supaya nama item boleh memuat angka ("Box 37",
// "PE foam 5mm") tanpa parser harus menebak angka mana yang harga. Baris yang
// memuat "|" SELALU dianggap niat menulis item - kalau bentuknya salah,
// kesalahannya dilaporkan, bukan dilewati diam-diam, supaya tidak ada item
// yang hilang dari nota tanpa ada yang tahu.
//
// Nominalnya lewat toRupiah() yang sama dengan rekap keuangan, jadi aturan
// rumah ("50" = 50.000, "30rb" = 30.000, "50.000" apa adanya) cuma punya satu
// tempat di repo ini.

const { parseIndonesianNumber, toRupiah } = require('../keuangan/offlineParser');

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const limits = {
  // Nota A5 masih rapi sampai puluhan baris; di atas ini hampir pasti salah tempel.
  items: 40,
  itemName: 70,
  customerName: 40,
  quantity: 9999,
};

function ymdInTimeZone(date, timeZone) {
  // en-CA memberi format YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function labelYmd(ymd) {
  const [year, month, day] = ymd.split('-');
  return `${Number(day)} ${MONTHS_ID[Number(month) - 1]} ${year}`;
}

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  // Hari ke-0 bulan berikutnya = hari terakhir bulan ini.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// Terima tiga bentuk yang biasa diketik orang, semuanya angka - nama bulan
// tidak diterima supaya tidak ada tebak-tebakan ejaan.
//
//   2026-09-22   22-09-2026   22/9/2026
function parseTanggal(raw) {
  const value = String(raw || '').trim();

  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso.map(Number);
    return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }

  const local = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (local) {
    const [, day, month, year] = local.map(Number);
    return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }

  return null;
}

function parseQuantity(raw) {
  const value = String(raw || '').trim();
  if (!/^\d{1,4}$/.test(value)) {
    return null;
  }
  const quantity = Number(value);
  return quantity >= 1 && quantity <= limits.quantity ? quantity : null;
}

// Batas "sudah ditulis penuh" untuk kolom harga nota.
//
// Di sinilah nota SENGAJA beda dari rekap keuangan. Aturan rekap menganggap
// angka yang bukan kelipatan 1000 sebagai singkatan ("85" = 85rb), jadi "8500"
// jadi 8.500.000 - benar untuk catatan belanja, tapi menghancurkan nota: harga
// satuan seperti ice gel Rp8.500 atau lakban Rp12.500 adalah harga wajar yang
// ditulis apa adanya.
//
// Batasnya diturunkan ke 1000: di atas itu harga dipakai apa adanya, di bawah
// itu tetap dikali 1000 ("50" = 50.000) karena tidak ada barang di sini yang
// dijual di bawah seribu rupiah. Pembacaan angkanya sendiri tetap memakai
// parseIndonesianNumber/toRupiah milik rekap - yang berbeda cuma ambangnya.
const HARGA_PENUH_MIN = 1000;

/**
 * @returns { amount, scale } atau null. `scale` dibawa terus supaya handler
 *   bisa memperingatkan nominal yang dikali 1000 secara implisit.
 */
function parseHarga(raw) {
  const value = String(raw || '').trim();
  // "Rp" opsional: orang menulis "50000" sesering "Rp50.000".
  const match = value.match(/^(?:rp\.?\s*)?([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/i);
  if (!match) {
    return null;
  }

  const [, digits, unit] = match;

  // Satuan ditulis eksplisit ("30rb", "1jt"): tidak ada yang perlu ditebak.
  if (unit) {
    return toRupiah(digits, unit);
  }

  const base = parseIndonesianNumber(digits);
  if (!Number.isFinite(base) || base <= 0) {
    return null;
  }

  if (base >= HARGA_PENUH_MIN) {
    return { amount: Math.round(base), scale: 'apa-adanya' };
  }

  // Ditandai implisit (bukan 'ribu-eksplisit') supaya handler tetap
  // mengonfirmasi ulang nominalnya di balasan: ini satu-satunya angka di nota
  // yang tidak ditulis sebagaimana dibaca.
  const scaled = toRupiah(digits, 'rb');
  return scaled ? { amount: scaled.amount, scale: 'ribu-implisit' } : null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('id-ID');
}

function parseItemLine(line, lineNumber) {
  const parts = line.split('|');

  if (parts.length !== 3) {
    return {
      problem: `Baris ${lineNumber}: harus ada tepat 2 tanda "|" (jumlah | nama item | harga).`,
    };
  }

  const [rawQuantity, rawName, rawPrice] = parts.map((part) => part.trim());
  const quantity = parseQuantity(rawQuantity);
  const price = parseHarga(rawPrice);

  if (quantity === null) {
    return {
      problem: `Baris ${lineNumber}: jumlah "${rawQuantity}" bukan angka 1-${limits.quantity}.`,
    };
  }

  if (!rawName) {
    return { problem: `Baris ${lineNumber}: nama item kosong.` };
  }

  if (!price) {
    return { problem: `Baris ${lineNumber}: harga "${rawPrice}" tidak terbaca.` };
  }

  return {
    item: {
      quantity,
      name: rawName.slice(0, limits.itemName),
      price: price.amount,
      priceScale: price.scale,
      total: quantity * price.amount,
    },
  };
}

function matchField(line, names) {
  const match = line.match(new RegExp(`^(?:${names.join('|')})\\s*:\\s*(.*)$`, 'i'));
  return match ? match[1].trim() : null;
}

/**
 * @returns {{ nota: object|null, problems: string[] }}
 *   `nota` null berarti tidak ada satu pun item yang bisa dipakai.
 */
function parseNota(text, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const now = options.now instanceof Date ? options.now : new Date();

  const items = [];
  const problems = [];
  let customerName = '';
  let ymd = null;

  String(text || '')
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      const lineNumber = index + 1;

      if (!line) {
        return;
      }

      // Pipa diperiksa lebih dulu supaya item yang namanya memuat titik dua
      // ("1 | diskon: langganan | 5000") tidak terbaca sebagai field.
      if (line.includes('|')) {
        if (items.length >= limits.items) {
          problems.push(`Baris ${lineNumber}: melebihi batas ${limits.items} item, dilewati.`);
          return;
        }

        const parsed = parseItemLine(line, lineNumber);
        if (parsed.problem) {
          problems.push(parsed.problem);
          return;
        }
        items.push(parsed.item);
        return;
      }

      const nama = matchField(line, ['nama']);
      if (nama !== null) {
        customerName = nama.slice(0, limits.customerName);
        return;
      }

      const tanggal = matchField(line, ['tgl', 'tanggal']);
      if (tanggal !== null) {
        if (!tanggal) {
          return;
        }
        const parsed = parseTanggal(tanggal);
        if (!parsed) {
          problems.push(
            `Baris ${lineNumber}: tanggal "${tanggal}" tidak terbaca. Pakai 2026-09-22 atau 22/09/2026.`
          );
          return;
        }
        ymd = parsed;
      }

      // Baris lain (termasuk "nota" di baris pertama) sengaja dibiarkan:
      // orang sering menambahi catatan bebas di sekitar formatnya.
    });

  if (!items.length) {
    return { nota: null, problems };
  }

  const resolvedYmd = ymd || ymdInTimeZone(now, timeZone);

  return {
    nota: {
      customerName,
      ymd: resolvedYmd,
      dateLabel: labelYmd(resolvedYmd),
      dateWasGiven: Boolean(ymd),
      items,
      total: items.reduce((sum, item) => sum + item.total, 0),
    },
    problems,
  };
}

function formatHelp() {
  return [
    '*Nota* — formatnya:',
    '',
    'nota',
    'nama: Bu Sari',
    'tgl: 2026-09-22',
    '',
    '1 | Box 37 lakban | 50000',
    '2 | Ice pack | 30rb',
    '',
    'Tiap item satu baris: *jumlah | nama item | harga*.',
    'Baris *nama* dan *tgl* boleh dilewati — tanggal otomatis jadi hari ini.',
  ].join('\n');
}

module.exports = {
  parseNota,
  parseTanggal,
  parseHarga,
  parseQuantity,
  formatNumber,
  formatHelp,
  labelYmd,
  limits,
  HARGA_PENUH_MIN,
  MONTHS_ID,
};
