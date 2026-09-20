// Baca angka berlabel dari grup "rekap harian": "offline <angka>" (setoran
// masuk) dan "pengeluaran <angka>" (uang keluar).
//
// Aturan angka tanpa satuan (dipilih pemilik): angka KELIPATAN 1000 dibaca apa
// adanya, sisanya dikali 1000.
//
//   offline 105    -> Rp105.000      (bukan kelipatan 1000)
//   offline 1225   -> Rp1.225.000    (bukan kelipatan 1000)
//   offline 85000  -> Rp85.000       (kelipatan 1000, ditulis lengkap)
//   offline 150000 -> Rp150.000      (kelipatan 1000, ditulis lengkap)
//
// Dasarnya: orang menulis singkat ("105", "1225") atau lengkap ("85000"), dan
// yang lengkap selalu berakhiran 000. Ambang tetap seperti "di bawah 1000"
// tidak bisa membedakan keduanya - "1225" akan jadi Rp1.225.
//
// Yang tetap ambigu cuma angka bulat ribuan yang ditulis singkat: "offline
// 1000" dibaca Rp1.000, bukan Rp1 juta. Tulis "1jt" atau "1.000.000" untuk itu.
//
// Perkalian seribu itu HANYA untuk singkatan. Nominal yang sudah ditulis penuh
// dibaca apa adanya, dikenali dari dua tanda:
//
//   Rp1.184.500 -> Rp1.184.500   (pakai pemisah ribuan, bukan 1,18 miliar)
//   150500      -> Rp150.500     (enam digit; singkatan tidak pernah sepanjang
//                                 itu, artinya akan jadi Rp150,5 juta)
//
// Tanpa keduanya "kulakan yohan Rp1.184.500" - yang dibaca AI pengeluaran -
// masuk buku seribu kali lipat, karena 1.184.500 bukan kelipatan 1000.
const { businessYmd } = require('./businessDay');
const { isBotGeneratedMessage } = require('../shared/botOutput');

const RIBUAN_UNIT = 1000;

// Batas nominal yang dianggap sudah ditulis penuh walau tanpa pemisah ribuan.
const NOMINAL_PENUH_MIN = 100000;

// "1.184.500": ada titik, dan setiap titik diikuti tepat tiga angka.
const POLA_PEMISAH_RIBUAN = /^\d{1,3}(?:\.\d{3})+$/;

// Labelnya boleh diikuti titik dua/spasi, lalu angka dengan pemisah ribuan
// gaya Indonesia (titik) dan satuan opsional (rb/ribu/k/jt/juta). Ekornya
// ditulis sebagai regex literal supaya escape-nya tidak perlu digandakan di
// dalam string.
//
// Dua hal yang gampang salah di pola ini:
//   - Antara label dan angka hanya boleh spasi/tab, BUKAN \s yang ikut menelan
//     baris baru. Tanpa itu, balasan bot yang menulis "Pengeluaran:" lalu
//     daftar nominal di baris berikutnya terbaca sebagai satu catatan.
//   - Angkanya ditangkap RAKUS sampai kelompok ribuan terakhir. Versi malas
//     berhenti di pemisah pertama, jadi "offline 1.225.000" cuma terbaca "1".
//   - Metode bayar boleh menyela antara label dan angkanya ("offline tunai
//     56"), tapi hanya kata dari daftar tertutup di bawah. Menerima kata apa
//     pun akan membuat kalimat seperti "offline belum ada 3 setoran" ikut
//     terbaca sebagai nominal.
const AMOUNT_TAIL =
  /[ \t]*[:=]?[ \t]*(?:(?:tunai|cash|qris|qr|transfer|tf|debit|gopay|ovo|dana|shopeepay)\b[ \t]*[:=]?[ \t]*)?(?:rp\.?[ \t]*)?(\d[\d.]*\d|\d)(?:,(\d+))?[ \t]*(rb|ribu|k|jt|juta)?(?=\b|$)/;

function createAmountPattern(labelSource) {
  return new RegExp(String.raw`\b${labelSource}\b` + AMOUNT_TAIL.source, 'gi');
}

const OFFLINE_PATTERN = createAmountPattern('off?line');
const PENGELUARAN_PATTERN = createAmountPattern('pengeluaran');

function getMessageTimestampMs(message) {
  const timestamp = [message?.timestamp, message?.t, message?.id?.timestamp].find(
    (value) => value !== undefined && value !== null
  );

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return null;
  }

  return numericTimestamp < 1000000000000 ? numericTimestamp * 1000 : numericTimestamp;
}



// "150.000" -> 150000, "150,5" -> 150.5. Di Indonesia titik adalah pemisah
// ribuan, jadi hanya koma yang pasti desimal.
//
// Titik baru dihitung pemisah ribuan kalau SETIAP titik diikuti tepat tiga
// angka. Kalau tidak - "1.5jt" - titik terakhirnya yang jadi desimal; membuang
// titik di situ membuat "1.5jt" terbaca 15 juta.
//
// options.dotsAsThousands memaksa aturan lama (semua titik dibuang) untuk
// sumber yang nominalnya dijamin ditulis penuh, seperti buku jualan.
function parseIndonesianNumber(rawDigits, options = {}) {
  const cleaned = String(rawDigits).replace(/\s+/g, '');
  const commaIndex = cleaned.lastIndexOf(',');

  if (commaIndex !== -1) {
    const whole = cleaned.slice(0, commaIndex).replace(/\./g, '');
    const fraction = cleaned.slice(commaIndex + 1).replace(/\D/g, '');
    return Number(`${whole || '0'}.${fraction || '0'}`);
  }

  if (
    !cleaned.includes('.') ||
    options.dotsAsThousands === true ||
    POLA_PEMISAH_RIBUAN.test(cleaned)
  ) {
    const digitsOnly = cleaned.replace(/\./g, '');
    return digitsOnly ? Number(digitsOnly) : NaN;
  }

  const dotIndex = cleaned.lastIndexOf('.');
  const whole = cleaned.slice(0, dotIndex).replace(/\./g, '');
  const fraction = cleaned.slice(dotIndex + 1).replace(/\D/g, '');
  return Number(`${whole || '0'}.${fraction || '0'}`);
}

/**
 * Ubah angka mentah + satuan jadi rupiah.
 * @returns { amount, scale } atau null bila tidak bisa dibaca.
 */
function toRupiah(rawDigits, unit) {
  const cleaned = String(rawDigits).replace(/\s+/g, '');
  const base = parseIndonesianNumber(cleaned);
  if (!Number.isFinite(base) || base <= 0) {
    return null;
  }

  const normalizedUnit = String(unit || '').toLowerCase();

  if (normalizedUnit === 'jt' || normalizedUnit === 'juta') {
    return { amount: Math.round(base * 1000000), scale: 'juta' };
  }

  if (normalizedUnit === 'rb' || normalizedUnit === 'ribu' || normalizedUnit === 'k') {
    return { amount: Math.round(base * 1000), scale: 'ribu-eksplisit' };
  }

  // Satuan tidak ditulis. Nominalnya dianggap sudah lengkap bila dipisah titik
  // ribuan ("1.184.500"), enam digit ke atas ("150500"), atau kelipatan 1000
  // ("85000") - ketiganya tanda tulisan penuh, bukan singkatan.
  if (POLA_PEMISAH_RIBUAN.test(cleaned) || base >= NOMINAL_PENUH_MIN) {
    return { amount: Math.round(base), scale: 'apa-adanya' };
  }

  if (Number.isInteger(base) && base % RIBUAN_UNIT === 0) {
    return { amount: base, scale: 'apa-adanya' };
  }

  return { amount: Math.round(base * RIBUAN_UNIT), scale: 'ribu-implisit' };
}

// Nama penulis untuk ditampilkan di balasan.
//
// Pesan yang dikirim dari akun bot sendiri sering tidak punya `author`, dan
// `from`-nya adalah id GRUP - kalau dipakai apa adanya, balasannya akan
// menyebut id grup sebagai nama orang. Id grup dibuang, dan sisanya diberi
// label jelas supaya kelihatan catatan itu ditulis dari HP akun bot.
function getAuthorLabel(message) {
  const author = [
    message?.author,
    message?.sender?.id?._serialized,
    message?.sender?.id,
    message?.from,
  ]
    .map((value) => String(value?._serialized || value || ''))
    .find((value) => value && !value.endsWith('@g.us'));
  const name =
    message?.sender?.pushname ||
    message?.sender?.name ||
    message?.notifyName ||
    message?.pushname ||
    '';

  const phone = String(author || '').split('@')[0];
  if (name || phone) {
    return name || phone;
  }

  return message?.fromMe ? '(akun bot)' : '(tanpa nama)';
}

/**
 * Kumpulkan semua "<label> <angka>" dari daftar pesan grup.
 *
 * @param messages daftar pesan (hasil client.getMessages + buffer live)
 * @param options  { pattern, targetDate: 'YYYY-MM-DD', timeZone, untilMs }
 * @returns { entries, total, skippedNoTimestamp }
 *          entries: [{ amount, raw, scale, author, timestampMs, date }]
 */
function collectLabeledAmounts(messages, options = {}) {
  const pattern = options.pattern || OFFLINE_PATTERN;
  const timeZone = options.timeZone || 'Asia/Makassar';
  const targetDate = options.targetDate || null;
  const untilMs = Number.isFinite(options.untilMs) ? options.untilMs : null;

  const entries = [];
  let skippedNoTimestamp = 0;

  (messages || []).forEach((message) => {
    // Yang dibuang cuma balasan bot: ringkasannya memuat kata "offline" juga,
    // jadi membacanya lagi menggandakan total tiap kali perintah diulang.
    // Catatan yang diketik ORANG lewat akun bot (fromMe juga) tetap dihitung -
    // setoran memang sering ditulis dari HP yang login sebagai bot.
    if (isBotGeneratedMessage(message)) {
      return;
    }

    const text = String(message?.body || message?.caption || message?.content || '');
    if (!text) {
      return;
    }

    const timestampMs = getMessageTimestampMs(message);

    if (untilMs !== null && timestampMs !== null && timestampMs > untilMs) {
      return;
    }

    let date = null;
    if (timestampMs === null) {
      // Tanpa timestamp tidak ada cara memastikan pesan ini milik tanggal yang
      // diminta, jadi dilewati dan dilaporkan daripada salah masuk hitungan.
      if (targetDate) {
        skippedNoTimestamp += 1;
        return;
      }
    } else {
      // Hari KERJA, sama seperti penentuan tanggal target. Kalau di sini pakai
      // hari kalender, pesan jam 00:10 akan dibuang dari blok hari sebelumnya
      // padahal perintahnya memang sedang mengerjakan hari itu.
      date = businessYmd(timestampMs, timeZone);
      if (targetDate && date !== targetDate) {
        return;
      }
    }

    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      // match[1]=bagian bulat, match[2]=desimal setelah koma, match[3]=satuan.
      const parsed = toRupiah(match[2] ? `${match[1]},${match[2]}` : match[1], match[3]);
      if (parsed) {
        entries.push({
          amount: parsed.amount,
          scale: parsed.scale,
          raw: match[0].trim().replace(/\s+/g, ' '),
          author: getAuthorLabel(message),
          timestampMs,
          date,
        });
      }
      match = pattern.exec(text);
    }
  });

  entries.sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

  return {
    entries,
    total: entries.reduce((sum, entry) => sum + entry.amount, 0),
    skippedNoTimestamp,
  };
}

function collectOfflineIncome(messages, options = {}) {
  return collectLabeledAmounts(messages, { ...options, pattern: OFFLINE_PATTERN });
}

// "pengeluaran <angka>" yang diketik orang di grup. Kulakan dan kas TIDAK ikut
// ke sini - keduanya dibaca dari ringkasan rekap di pengeluaranParser.
function collectManualExpenses(messages, options = {}) {
  return collectLabeledAmounts(messages, { ...options, pattern: PENGELUARAN_PATTERN });
}

module.exports = {
  RIBUAN_UNIT,
  collectLabeledAmounts,
  getAuthorLabel,
  collectManualExpenses,
  collectOfflineIncome,
  createAmountPattern,
  getMessageTimestampMs,
  parseIndonesianNumber,
  toRupiah,
};
