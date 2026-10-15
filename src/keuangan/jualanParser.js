// Buku penjualan tulisan tangan yang difoto dan dikirim ke grup rekap:
//
//   Kamis 17/9/26
//   NO | Barang                | Jml | Harga | Total    | T/Q
//   1  | Box 37 polos          |  1  |       |  45.000  |  T
//   2  | Box 37 lakban cok+AL  |  1  |       | 115.000  |  Q
//   3  | Ice Gel 1 lmbr        |  1  |       |  15.000  |  T
//
// T = Tunai, Q = QRIS. Fotonya dibaca Claude vision (klien Bedrock yang sama
// dengan kiloPhotoReader), lalu tiap baris buku jadi satu baris pemasukan di
// sheet: "Offline Tunai" atau "Offline Qris" menurut kolom T/Q-nya.
//
// Tiga hal yang membedakan pembacaan ini dari catatan teks di grup:
//
//   1. ANGKA DI BUKU SELALU RUPIAH PENUH. "45.000" berarti Rp45.000, titik.
//      Aturan singkatan milik pesan teks ("105" -> Rp105.000) TIDAK berlaku di
//      sini dan tidak boleh dipakai: satu salah baca "115.050" akan menjadi
//      Rp115 juta kalau angkanya dikali seribu.
//   2. Tiap judul tanggal di halaman dicocokkan dengan tanggal yang sedang
//      direkap. Satu halaman sering memuat sisa hari kemarin di atas dan hari
//      ini di bawah; hanya bagian hari ini yang boleh menambah pemasukan.
//   3. Foto yang bukan buku penjualan (mis. buku kilo laundry) dilewati - itu
//      keputusan yang ikut ditanyakan ke model, bukan ditebak dari caption.

const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
const { businessYmd } = require('./businessDay');
const { getMessageTimestampMs, parseIndonesianNumber } = require('./offlineParser');
const { isBotGeneratedMessage } = require('../shared/botOutput');

const config = {
  enabled: process.env.KEUANGAN_JUALAN_FOTO !== 'false',
  model: process.env.KEUANGAN_AI_MODEL || process.env.BEDROCK_MODEL_ID || '',
  // Tiap foto satu permintaan vision, jadi batasnya lebih ketat daripada teks.
  maxPhotos: Math.min(Math.max(Number(process.env.KEUANGAN_JUALAN_MAX_FOTO) || 5, 1), 20),
  // Pagar nominal per baris. Di bawah batas bawah hampir pasti salah baca
  // (harga barang tidak Rp15), di atas batas atas hampir pasti kelebihan digit.
  minAmount: Math.max(Number(process.env.KEUANGAN_JUALAN_MIN) || 500, 0),
  maxAmount: Math.max(Number(process.env.KEUANGAN_JUALAN_MAX) || 50000000, 0),
};

let cachedClient = null;

function getClient(options = {}) {
  if (options.client) {
    return options.client;
  }
  if (cachedClient) {
    return cachedClient;
  }

  const region = process.env.AWS_REGION;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKey || !secretKey) {
    return null;
  }

  cachedClient = new AnthropicBedrock({
    awsRegion: region,
    awsAccessKey: accessKey,
    awsSecretKey: secretKey,
    ...(process.env.AWS_SESSION_TOKEN ? { awsSessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  });

  return cachedClient;
}

const PROMPT = [
  'Foto ini MUNGKIN halaman buku penjualan tulisan tangan sebuah toko.',
  'Bentuk bukunya: kolom NO, Barang, Jml, Harga, Total, dan kolom terakhir',
  'berisi T atau Q (T = Tunai, Q = QRIS). Di kepala halaman biasanya ada',
  'tanggal, mis. "Kamis 17/9/26".',
  '',
  'Satu halaman bisa berisi LEBIH DARI SATU hari: tiap hari diawali judul',
  'tanggal sendiri di tengah halaman (mis. "Rabu 23/9/26" lalu di bawahnya',
  '"Kamis 24/9/26"). Pisahkan baris per judul tanggal itu.',
  '',
  'Kembalikan HANYA JSON, tanpa teks lain, tanpa blok kode markdown:',
  '{"buku_penjualan": boolean, "bagian": [',
  '  {"tanggal_tertulis": string, "baris": [',
  '    {"barang": string, "jumlah": number|null, "total": string,',
  '     "bayar": "T"|"Q"|"", "yakin": boolean}]}]}',
  '',
  'Aturan:',
  '- "buku_penjualan": false bila foto ini BUKAN buku penjualan barang',
  '  (mis. catatan kilo/laundry berisi nama pelanggan dan berat, struk,',
  '  tangkapan layar, atau foto lain). Bila false, "bagian" harus [].',
  '- "bagian": satu objek per judul tanggal, urut dari atas ke bawah.',
  '  Setiap baris masuk ke bagian judul tanggal TERDEKAT DI ATASNYA. Baris',
  '  di atas judul tanggal pertama (lanjutan dari halaman sebelumnya) masuk',
  '  bagian tersendiri dengan "tanggal_tertulis": "".',
  '- "tanggal_tertulis": judul tanggal bagian itu, disalin apa adanya',
  '  ("Kamis 17/9/26", "Rabu 23/9", "Rabu"). Kosongkan "" bila tidak ada.',
  '- "total": angka di kolom Total, DISALIN PERSIS seperti tertulis',
  '  ("45.000", "115.000"). Jangan dihitung, dijumlahkan, atau dibulatkan.',
  '  Jangan memakai kolom Harga bila kolom Total terisi.',
  '- "bayar": huruf di kolom terakhir. "T", "Q", atau "" bila kosong/ragu.',
  '- "yakin": false bila tulisan pada baris itu sulit dibaca.',
  '- Beberapa nama barang yang DIKURUNG/DIGABUNG dengan satu angka Total',
  '  (kurung kurawal, garis penghubung, atau satu total sejajar di tengah)',
  '  adalah SATU baris: gabung namanya dengan " + " dan pakai total itu',
  '  sekali. Jangan membuat baris tambahan bertotal kosong untuk nama',
  '  lainnya - baris begitu akan dilaporkan sebagai gagal baca padahal',
  '  uangnya sudah terhitung.',
  '- Baca SETIAP baris yang ada isinya. Lewati baris kosong.',
  '- JANGAN mengarang baris, angka, atau huruf T/Q yang tidak terlihat.',
].join('\n');

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}

/**
 * Baca satu foto buku penjualan.
 * @returns { bukuPenjualan, tanggalTertulis, baris: [{ barang, total, bayar, yakin }] }
 */
async function readJualanPhoto({ imageBase64, mediaType = 'image/jpeg' }, options = {}) {
  const client = getClient(options);
  if (!client) {
    throw new Error('kredensial AWS Bedrock belum diatur');
  }

  const model = options.model || config.model;
  if (!model) {
    throw new Error('BEDROCK_MODEL_ID belum diatur');
  }

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });

  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const parsed = extractJsonObject(text);

  if (!parsed) {
    throw new Error('jawaban AI tidak berbentuk JSON yang bisa dibaca');
  }

  return {
    bukuPenjualan: parsed.buku_penjualan === true,
    bagian: normalizeSections(parsed),
  };
}

// Jawaban lama (satu tanggal + satu daftar baris) tetap diterima sebagai satu
// bagian, supaya model yang mengabaikan bentuk "bagian" tidak membuang foto.
function normalizeSections(parsed) {
  const sections = Array.isArray(parsed?.bagian)
    ? parsed.bagian
    : [{ tanggal_tertulis: parsed?.tanggal_tertulis, baris: parsed?.baris }];

  return sections
    .map((section) => ({
      tanggalTertulis: String(section?.tanggal_tertulis || '').trim(),
      baris: Array.isArray(section?.baris) ? section.baris : [],
    }))
    .filter((section) => section.baris.length);
}

const DAY_NAMES_ID = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

// "Kamis 17/9/26" -> "2026-09-17". Tahun boleh tidak ditulis ("Rabu 23/9");
// tahunnya diambil dari tanggal rekap (referenceYmd). Bentuk lain dikembalikan
// null.
function parseWrittenDate(rawText, referenceYmd) {
  const text = String(rawText || '');
  const full = /(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})/.exec(text);
  const short = full ? null : /(?:^|\D)(\d{1,2})\s*[/-]\s*(\d{1,2})(?!\s*[/-]?\d)/.exec(text);
  const match = full || short;

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  if (!day || !month || month > 12 || day > 31) {
    return null;
  }

  let year;
  if (full) {
    const yearPart = Number(match[3]);
    year = yearPart < 100 ? 2000 + yearPart : yearPart;
  } else {
    const refYear = Number(String(referenceYmd || '').slice(0, 4));
    if (!refYear) {
      return null;
    }
    // Rekap awal Januari yang membaca "31/12" milik tahun sebelumnya.
    const refMonth = Number(String(referenceYmd).slice(5, 7));
    year = month > refMonth + 6 ? refYear - 1 : refYear;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// "Rabu" -> 3 (Minggu = 0). Dipakai bila judulnya hanya nama hari.
function parseWrittenWeekday(rawText) {
  const text = String(rawText || '').toLowerCase().replace(/jum'?at/g, 'jumat');
  const index = DAY_NAMES_ID.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
  return index >= 0 ? index : null;
}

/**
 * Apakah judul tanggal sebuah bagian cocok dengan tanggal yang direkap.
 * true/false bila bisa diputuskan, null bila judulnya tidak terbaca sama sekali
 * - lebih baik tidak memeriksa daripada menolak foto yang benar karena format
 * tanggalnya tak terduga.
 */
function matchesTargetDate(rawText, targetDate) {
  const writtenDate = parseWrittenDate(rawText, targetDate);
  if (writtenDate) {
    return writtenDate === targetDate;
  }

  const weekday = parseWrittenWeekday(rawText);
  if (weekday !== null) {
    return new Date(`${targetDate}T12:00:00Z`).getUTCDay() === weekday;
  }

  return null;
}

// Angka di buku ditulis penuh ("45.000" = Rp45.000). Titik hanya pemisah
// ribuan. Tidak ada perkalian seribu di jalur ini - lihat catatan di kepala
// file soal kenapa aturan singkatan pesan teks berbahaya di sini.
function parseBookAmount(rawText) {
  const amount = parseIndonesianNumber(rawText, { dotsAsThousands: true });

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount);
}

function isImageMessage(message) {
  if (message?.type === 'image') {
    return true;
  }
  return String(message?.mimetype || '').startsWith('image/');
}

/**
 * Foto-foto milik tanggal target yang layak diperiksa.
 */
function selectPhotos(messages, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const targetDate = options.targetDate || null;
  const untilMs = Number.isFinite(options.untilMs) ? options.untilMs : null;

  const photos = [];

  (messages || []).forEach((message) => {
    // Foto yang DIKIRIM bot (mis. file rekap dari Google Sheet) dilewati, tapi
    // foto buku yang dikirim orang dari HP akun bot tetap dibaca - keduanya
    // sama-sama fromMe.
    if (!isImageMessage(message) || isBotGeneratedMessage(message)) {
      return;
    }

    // Foto buku kilo dikirim dengan caption "cek kilo"; itu buku yang berbeda
    // dan tidak perlu menghabiskan satu permintaan vision untuk ditolak.
    const caption = String(message?.caption || message?.body || '').toLowerCase();
    if (caption.includes('cek kilo')) {
      return;
    }

    const timestampMs = getMessageTimestampMs(message);

    if (untilMs !== null && timestampMs !== null && timestampMs > untilMs) {
      return;
    }

    if (timestampMs === null) {
      if (targetDate) {
        return;
      }
    } else if (targetDate && businessYmd(timestampMs, timeZone) !== targetDate) {
      return;
    }

    photos.push(message);
  });

  photos.sort((left, right) => (getMessageTimestampMs(left) || 0) - (getMessageTimestampMs(right) || 0));

  // Yang dipakai yang TERBARU: halaman buku difoto ulang kalau ada tambahan,
  // dan foto terakhir hari itu yang paling lengkap.
  return photos.slice(-config.maxPhotos);
}

/**
 * Baca semua foto buku penjualan hari itu, lalu jumlahkan per metode bayar.
 *
 * Tidak pernah melempar: kegagalan dilaporkan lewat { skipped, reason }, karena
 * tahap ini berjalan setelah dana Shopee ditarik.
 *
 * @param decryptFile  fungsi async(message) -> Buffer (client.decryptFile)
 * @returns { tunai, qris, rows, photos, skipped, reason, rejected, mismatched }
 */
async function collectJualanIncome(messages, options = {}) {
  const empty = {
    tunai: 0,
    qris: 0,
    rows: [],
    photos: 0,
    // Jumlah foto yang DIPERIKSA, terpisah dari yang ternyata buku penjualan.
    // Tanpa angka ini, foto yang dinilai bukan buku penjualan hilang tanpa
    // jejak dari balasan - orang mengira fotonya tidak pernah terbaca.
    candidates: 0,
    notBook: 0,
    rejected: [],
    mismatched: [],
    skipped: true,
    reason: '',
  };

  if (!config.enabled) {
    return { ...empty, reason: 'dimatikan lewat KEUANGAN_JUALAN_FOTO=false' };
  }

  const decryptFile = options.decryptFile;
  if (typeof decryptFile !== 'function') {
    return { ...empty, reason: 'tidak ada cara mengunduh foto' };
  }

  const photos = selectPhotos(messages, options);

  if (!photos.length) {
    return { ...empty, skipped: false };
  }


  const rows = [];
  const rejected = [];
  const mismatched = [];
  let readCount = 0;
  let notBookCount = 0;

  for (const message of photos) {
    let page;

    try {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await decryptFile(message);
      // eslint-disable-next-line no-await-in-loop
      page = await readJualanPhoto(
        {
          imageBase64: buffer.toString('base64'),
          mediaType: message?.mimetype || 'image/jpeg',
        },
        options
      );
    } catch (error) {
      rejected.push({ barang: '(satu foto)', reason: `gagal dibaca: ${error.message}` });
      continue;
    }

    if (!page.bukuPenjualan) {
      // Dihitung, bukan didiamkan: satu permintaan vision sudah terpakai untuk
      // foto ini, dan orang harus tahu fotonya dilihat lalu ditolak.
      notBookCount += 1;
      continue;
    }

    readCount += 1;

    // Judul tanggal tiap bagian harus cocok dengan yang sedang direkap. Satu
    // halaman sering berisi sisa hari kemarin di atas dan hari ini di bawah;
    // hanya bagian hari ini yang dihitung.
    const verdicts = page.bagian.map((section) =>
      options.targetDate ? matchesTargetDate(section.tanggalTertulis, options.targetDate) : true
    );
    const hasDatedSection = verdicts.some((verdict) => verdict !== null);

    const sections = page.bagian.filter((section, index) => {
      const verdict = verdicts[index];
      if (verdict === false) {
        mismatched.push({ tanggal: section.tanggalTertulis, baris: section.baris.length });
        return false;
      }

      // Bagian tanpa judul di halaman yang juga memuat judul tanggal adalah
      // lanjutan halaman sebelumnya - bukan milik hari ini.
      if (verdict === null && hasDatedSection) {
        mismatched.push({ tanggal: section.tanggalTertulis || '(tanpa tanggal)', baris: section.baris.length });
        return false;
      }

      return true;
    });

    sections.flatMap((section) => section.baris).forEach((row) => {
      const barang = String(row?.barang || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const amount = parseBookAmount(row?.total);
      const bayar = String(row?.bayar || '').trim().toUpperCase();

      if (!amount) {
        rejected.push({ barang: barang || '(tanpa nama)', reason: `total "${row?.total}" tidak terbaca` });
        return;
      }

      if (amount < config.minAmount || amount > config.maxAmount) {
        rejected.push({
          barang: barang || '(tanpa nama)',
          reason: `nominal ${amount} di luar batas wajar`,
        });
        return;
      }

      if (bayar !== 'T' && bayar !== 'Q') {
        // Tanpa T/Q, uangnya tidak tahu masuk baris mana. Dilaporkan supaya
        // bisa dimasukkan manual, bukan ditebak.
        rejected.push({
          barang: barang || '(tanpa nama)',
          reason: `metode bayar tidak terbaca (${amount})`,
        });
        return;
      }

      rows.push({
        barang: barang || '(tanpa nama)',
        amount,
        bayar,
        yakin: row?.yakin !== false,
      });
    });
  }

  return {
    tunai: rows.filter((row) => row.bayar === 'T').reduce((sum, row) => sum + row.amount, 0),
    qris: rows.filter((row) => row.bayar === 'Q').reduce((sum, row) => sum + row.amount, 0),
    rows,
    photos: readCount,
    candidates: photos.length,
    notBook: notBookCount,
    rejected,
    mismatched,
    skipped: false,
    reason: '',
  };
}

module.exports = {
  PROMPT,
  collectJualanIncome,
  config,
  matchesTargetDate,
  parseBookAmount,
  parseWrittenDate,
  parseWrittenWeekday,
  readJualanPhoto,
  selectPhotos,
};
