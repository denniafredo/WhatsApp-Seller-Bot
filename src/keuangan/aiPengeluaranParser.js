// Pengeluaran bebas-format dari grup rekap: "beli lakban shopee 25000",
// "bensin 50", "ice pack 30rb". Claude (lewat AWS Bedrock, klien yang sama
// dengan kiloPhotoReader) yang memutuskan sebuah pesan pengeluaran atau bukan,
// dan keterangan yang ditulis orang itulah yang masuk kolom B di sheet.
//
// Batas tugasnya sengaja sempit:
//
//   1. HANYA pesan yang TIDAK cocok pola lama yang dilempar ke AI. "offline
//      105" dan "pengeluaran 9rb" tetap dibaca offlineParser yang deterministik,
//      jadi angka yang selama ini pasti benar tidak ikut bergantung pada model.
//   2. AI TIDAK menghitung rupiah. Ia hanya menyalin angka apa adanya dari
//      pesan; konversinya tetap lewat toRupiah() di offlineParser, supaya
//      aturan rumah ("kelipatan 1000 apa adanya, sisanya dikali 1000") cuma
//      punya satu tempat.
//   3. Angka yang dikembalikan model dicocokkan ulang ke teks aslinya. Yang
//      tidak ada di pesan dibuang - model tidak boleh mengarang nominal di
//      jalur uang, sekalipun dengan alasan yang masuk akal.
//   4. Gagal apa pun (kredensial, jaringan, JSON rusak) TIDAK menggagalkan auto
//      rekap. Tahapnya dilewati dan alasannya dilaporkan, karena saat tahap ini
//      berjalan dana Shopee sudah terlanjur ditarik.

const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
const { businessYmd } = require('./businessDay');
const {
  createAmountPattern,
  getAuthorLabel,
  getMessageTimestampMs,
  toRupiah,
} = require('./offlineParser');
const { parseSummaryText } = require('./pengeluaranParser');
const { config: summaryConfig } = require('../shared/recapSummary');
const { isBotGeneratedMessage } = require('../shared/botOutput');

// Pola yang sudah ditangani deterministik. Dibuat baru di sini (bukan dipakai
// bersama) karena pola global menyimpan lastIndex - berbagi instance membuat
// tes berikutnya melewatkan kecocokan.
function buildHandledPatterns() {
  return [createAmountPattern('off?line'), createAmountPattern('pengeluaran')];
}

// Ringkasan rekap ("kulakan yohan: Rp1.184.500") sudah dibaca pengeluaranParser
// jadi baris kulakan/kas. Kalau grup ringkasan dan grup rekap ternyata grup yang
// sama - dan ringkasannya diketik orang, bukan dikirim bot - menilainya di sini
// membuat angka yang sama masuk dua kali.
//
// Yang dilewati hanya pesan yang UTUH ringkasan, persis sebagaimana
// pengeluaranParser mengenalinya, supaya tidak ada catatan belanja yang hilang
// gara-gara kebetulan memuat kata "kulakan".
function isRecapSummary(text) {
  return (
    parseSummaryText(text, { total: summaryConfig.totalLabel, cash: summaryConfig.cashLabel }) !==
    null
  );
}

const config = {
  // Dimatikan lewat .env kalau sewaktu-waktu ingin kembali ke template saja.
  enabled: process.env.KEUANGAN_AI_PENGELUARAN !== 'false',
  model: process.env.KEUANGAN_AI_MODEL || process.env.BEDROCK_MODEL_ID || '',
  // Batas atas jumlah pesan yang dikirim sekali jalan. Grup yang ramai tidak
  // boleh membuat satu permintaan membengkak tanpa batas.
  maxCandidates: Math.min(Math.max(Number(process.env.KEUANGAN_AI_MAX_PESAN) || 60, 1), 200),
  // Pesan panjang hampir pasti obrolan, bukan catatan belanja.
  maxTextLength: 300,
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
  'Kamu membaca pesan WhatsApp dari grup rekap harian sebuah toko/laundry.',
  'Tugasmu: tentukan pesan mana yang mencatat PENGELUARAN (uang yang sudah',
  'keluar untuk belanja atau biaya operasional), lalu ambil keterangannya.',
  '',
  'Kembalikan HANYA array JSON, tanpa teks lain, tanpa blok kode markdown.',
  'Satu elemen untuk SETIAP nomor pesan yang diberikan:',
  '{"no": number, "pengeluaran": boolean, "keterangan": string, "nominal": string, "yakin": boolean}',
  '',
  'Aturan:',
  '- "nominal": SALIN angkanya persis seperti tertulis di pesan, termasuk',
  '  satuan yang menempel bila ada ("25000", "50", "9rb", "1.5jt").',
  '  JANGAN dihitung, dibulatkan, atau dikali seribu. Kalau pesannya tidak',
  '  memuat angka, isi "" dan set pengeluaran=false.',
  '- "keterangan": apa yang dibeli/dibayar, disalin dari kata-kata penulisnya',
  '  tanpa angkanya (mis. "beli lakban shopee", "bensin", "ice pack").',
  '  Jangan diterjemahkan, jangan ditambahi kata yang tidak ditulis.',
  '- "pengeluaran": true HANYA bila pesan itu melaporkan uang yang sudah',
  '  dikeluarkan untuk keperluan toko.',
  '  Set false untuk:',
  '  * pemasukan/setoran/omzet/transfer masuk',
  '  * rencana atau ajakan ("besok beli lakban 25000", "tolong beliin bensin")',
  '  * pertanyaan ("lakban 25000 ya?")',
  '  * angka yang bukan uang: berat/kilo, jam, tanggal, nomor telepon,',
  '    jumlah barang, nomor resi',
  '  * total, rekap, laporan, atau salinan pesan bot',
  '  * obrolan biasa',
  '- "yakin": false bila pesannya ambigu dan kamu menebak, true bila jelas.',
  '- Jangan menambah elemen untuk nomor yang tidak ada.',
].join('\n');

function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Pesan yang perlu dinilai AI: ada angkanya, bukan pesan bot, dan belum
 * tertangani pola "offline"/"pengeluaran".
 */
function selectCandidates(messages, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const targetDate = options.targetDate || null;
  const untilMs = Number.isFinite(options.untilMs) ? options.untilMs : null;

  const candidates = [];
  let skippedNoTimestamp = 0;

  (messages || []).forEach((message) => {
    // Balasan bot memuat seluruh ringkasan hari itu; menilainya dengan AI akan
    // memasukkan angka yang sama untuk kedua kalinya. Catatan yang diketik
    // orang lewat akun bot bukan balasan bot, jadi tetap dinilai.
    if (isBotGeneratedMessage(message)) {
      return;
    }

    const rawText = String(message?.body || message?.caption || message?.content || '');
    const text = normalizeText(rawText);

    if (!text || text.length > config.maxTextLength || !/\d/.test(text)) {
      return;
    }

    // Ringkasan dicek pada teks ASLI: normalizeText menggabung baris jadi satu,
    // dan ringkasan dua baris tidak akan dikenali lagi setelah digabung.
    const handled = buildHandledPatterns().some((pattern) => pattern.test(text));
    if (handled || isRecapSummary(rawText)) {
      return;
    }

    const timestampMs = getMessageTimestampMs(message);

    if (untilMs !== null && timestampMs !== null && timestampMs > untilMs) {
      return;
    }

    let date = null;
    if (timestampMs === null) {
      if (targetDate) {
        skippedNoTimestamp += 1;
        return;
      }
    } else {
      date = businessYmd(timestampMs, timeZone);
      if (targetDate && date !== targetDate) {
        return;
      }
    }

    candidates.push({ text, author: getAuthorLabel(message), timestampMs, date });
  });

  candidates.sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

  // Kalau grupnya terlalu ramai, yang dipakai adalah yang TERBARU - pesan lama
  // di hari yang sama lebih mungkin sudah tertulis di rekap sebelumnya.
  const trimmed = candidates.slice(-config.maxCandidates);

  return {
    candidates: trimmed,
    skippedNoTimestamp,
    droppedOverLimit: candidates.length - trimmed.length,
  };
}

// Angka yang disebut model harus benar-benar ada di pesannya. Pemisah ribuan
// dibuang di kedua sisi supaya "1.225" cocok dengan "1225".
function amountAppearsInText(nominalText, sourceText) {
  const digits = String(nominalText || '').replace(/\D/g, '');
  if (!digits) {
    return false;
  }
  return String(sourceText || '').replace(/\D/g, '').includes(digits);
}

// Keterangan cadangan kalau model mengembalikannya kosong: teks pesan tanpa
// angka dan tanpa satuan yang menempel.
function fallbackKeterangan(text) {
  return normalizeText(
    String(text || '').replace(/(?:rp\.?\s*)?\d[\d.,]*\s*(rb|ribu|k|jt|juta)?/gi, ' ')
  );
}

function buildUserMessage(candidates) {
  return candidates
    .map((item, index) => `${index + 1}. [${item.author}] ${item.text}`)
    .join('\n');
}

/**
 * Nilai pesan sisa dengan Claude, lalu kembalikan pengeluaran yang terbaca.
 *
 * Tidak pernah melempar error: kegagalan dilaporkan lewat { skipped, reason }
 * supaya auto rekap tetap jalan sampai selesai.
 *
 * @returns { entries, skipped, reason, candidates, rejected, skippedNoTimestamp }
 *          entries: [{ amount, keterangan, raw, author, timestampMs, date, yakin }]
 */
async function collectAiExpenses(messages, options = {}) {
  const empty = {
    entries: [],
    candidates: 0,
    rejected: [],
    skippedNoTimestamp: 0,
    droppedOverLimit: 0,
    skipped: true,
    reason: '',
  };

  if (!config.enabled) {
    return { ...empty, reason: 'dimatikan lewat KEUANGAN_AI_PENGELUARAN=false' };
  }

  const model = options.model || config.model;
  if (!model) {
    return { ...empty, reason: 'BEDROCK_MODEL_ID belum diatur' };
  }

  const client = getClient(options);
  if (!client) {
    return { ...empty, reason: 'kredensial AWS Bedrock belum diatur' };
  }

  const picked = selectCandidates(messages, options);

  if (!picked.candidates.length) {
    return {
      ...empty,
      skipped: false,
      skippedNoTimestamp: picked.skippedNoTimestamp,
      droppedOverLimit: picked.droppedOverLimit,
    };
  }

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(picked.candidates) }],
    });
  } catch (error) {
    return { ...empty, reason: `Claude tidak bisa dihubungi: ${error.message}` };
  }

  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const parsed = extractJsonArray(text);

  if (!Array.isArray(parsed)) {
    return { ...empty, reason: 'jawaban AI tidak berbentuk JSON yang bisa dibaca' };
  }

  const entries = [];
  const rejected = [];

  parsed.forEach((row) => {
    const index = Number(row?.no) - 1;
    const source = picked.candidates[index];

    if (!source || row?.pengeluaran !== true) {
      return;
    }

    const nominalText = String(row.nominal || '').trim();

    if (!amountAppearsInText(nominalText, source.text)) {
      // Angkanya tidak ada di pesan aslinya: entah salah salin, entah dikarang.
      rejected.push({ text: source.text, reason: `nominal "${nominalText}" tidak ada di pesannya` });
      return;
    }

    // Satuan dipisah dari angkanya, lalu dikonversi dengan aturan yang sama
    // dengan "offline 105" - bukan aturan baru milik AI.
    const match = /^(?:rp\.?\s*)?([\d.,]+)\s*(rb|ribu|k|jt|juta)?$/i.exec(nominalText);
    const parsedAmount = match ? toRupiah(match[1], match[2]) : null;

    if (!parsedAmount || parsedAmount.amount <= 0) {
      rejected.push({ text: source.text, reason: `nominal "${nominalText}" tidak terbaca` });
      return;
    }

    const keterangan =
      normalizeText(row.keterangan).slice(0, 60) || fallbackKeterangan(source.text).slice(0, 60);

    if (!keterangan) {
      rejected.push({ text: source.text, reason: 'keterangannya kosong' });
      return;
    }

    entries.push({
      amount: parsedAmount.amount,
      scale: parsedAmount.scale,
      keterangan,
      raw: source.text,
      author: source.author,
      timestampMs: source.timestampMs,
      date: source.date,
      yakin: row.yakin !== false,
    });
  });

  entries.sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

  return {
    entries,
    candidates: picked.candidates.length,
    rejected,
    skippedNoTimestamp: picked.skippedNoTimestamp,
    droppedOverLimit: picked.droppedOverLimit,
    skipped: false,
    reason: '',
  };
}

module.exports = {
  PROMPT,
  amountAppearsInText,
  collectAiExpenses,
  config,
  fallbackKeterangan,
  selectCandidates,
};
