// Membaca foto buku tulisan tangan karyawan (nama pelanggan, kilo, keterangan)
// dengan Claude vision lewat AWS Bedrock, lalu mengembalikan JSON terstruktur.

const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');

class KiloReadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KiloReadError';
    this.code = code;
  }
}

const MAX_NAME_HINTS = 250;

let cachedClient = null;

function getClient(options = {}) {
  if (options.client) return options.client;
  if (cachedClient) return cachedClient;

  const region = process.env.AWS_REGION;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !accessKey || !secretKey) {
    throw new KiloReadError(
      'NO_CREDENTIALS',
      'Kredensial AWS Bedrock (AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) belum diatur.'
    );
  }

  cachedClient = new AnthropicBedrock({
    awsRegion: region,
    awsAccessKey: accessKey,
    awsSecretKey: secretKey,
    ...(process.env.AWS_SESSION_TOKEN ? { awsSessionToken: process.env.AWS_SESSION_TOKEN } : {}),
  });
  return cachedClient;
}

const BASE_PROMPT = [
  'Foto ini adalah catatan tulisan tangan karyawan laundry berisi daftar:',
  'nama pelanggan, berat cucian dalam kilogram (kg), dan keterangan opsional.',
  '',
  'Baca SETIAP baris. Kembalikan HANYA sebuah array JSON, tanpa teks lain,',
  'tanpa blok kode markdown. Tiap elemen:',
  '{"nama": string, "namaFoto": string, "kilo": number, "keterangan": string, "yakin": boolean}',
  '',
  'Aturan nama:',
  '- "namaFoto": apa adanya seperti tertulis di foto, jangan diperbaiki.',
  '- "nama": ejaan yang kamu yakini benar (lihat aturan daftar acuan di bawah',
  '  bila ada; kalau tidak ada, salin saja dari "namaFoto").',
  '- Huruf tulisan tangan sering tertukar: m/w/n/nn, a/o/u, k/h, y/g, i/l/1,',
  '  z/2, b/6. Baca nama huruf per huruf, jangan menebak dari kesan sekilas.',
  '',
  'Aturan angka:',
  '- "kilo": angka kg sebagai desimal titik. Koma jadi titik (2,8 -> 2.8).',
  '  Kalau berat tidak tertulis (mis. hanya "1 celana", "1 satuan"), pakai null.',
  '- Setiap baris punya angkanya SENDIRI. Jangan menyalin angka dari baris di',
  '  atas atau di bawahnya; telusuri garis barisnya dari nama ke kolom angka.',
  '- Digit yang mirip pada tulisan tangan: 8 vs 0 vs 6, 3 vs 5 vs 8, 1 vs 7,',
  '  4 vs 9. Perhatikan lebar angkanya (mis. 8,9 sering terlihat seperti 0,9).',
  '- Angka kg laundry rumahan biasanya 1-20 kg; curigai bacaanmu bila di luar itu.',
  '',
  'Aturan lain:',
  '- "keterangan": catatan tambahan pada baris itu (mis. jumlah potong, express,',
  '  reguler, sprei, setrika). Kosongkan dengan "" bila tidak ada.',
  '- "yakin": false bila nama ATAU angka pada baris itu ragu dibaca, true bila jelas.',
  '- Abaikan baris judul, total, atau tanda tangan yang bukan data pelanggan.',
  '- Jangan mengarang baris yang tidak ada di foto, dan jangan melewatkan baris.',
].join('\n');

// Daftar nama pelanggan dari aplikasi untuk periode yang sama. Ini penyaring
// terkuat: tulisan tangan yang ambigu ("2alk kenid") jadi punya kandidat nyata
// ("Zaky Kendal") ketimbang ditebak bebas oleh model.
function buildNameHint(knownNames) {
  const unique = [...new Set((knownNames || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!unique.length) return '';

  const listed = unique.slice(0, MAX_NAME_HINTS);
  const lines = [
    '',
    'DAFTAR NAMA PELANGGAN DI APLIKASI untuk periode ini:',
    ...listed.map((name) => `- ${name}`),
    '',
    'Pakai daftar itu sebagai acuan ejaan:',
    '- Bila bacaanmu jelas merujuk salah satu nama di daftar (beda 1-3 huruf,',
    '  huruf tertukar, atau nama disingkat), tulis ejaan dari daftar di "nama".',
    '- Bila tidak ada yang mirip, salin bacaan aslimu ke "nama". JANGAN memaksa',
    '  memilih nama dari daftar hanya karena mirip sedikit.',
    '- "namaFoto" tetap bacaan mentah dari foto, apa pun isinya.',
  ];
  if (unique.length > listed.length) {
    lines.push(`(Daftar dipotong ${listed.length} dari ${unique.length} nama.)`);
  }
  return lines.join('\n');
}

function buildPrompt(knownNames) {
  const hint = buildNameHint(knownNames);
  return hint ? `${BASE_PROMPT}\n${hint}` : BASE_PROMPT;
}

function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new KiloReadError('NO_JSON', 'Model tidak mengembalikan JSON yang bisa dibaca.');
  }
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (error) {
    throw new KiloReadError('BAD_JSON', `JSON dari model rusak: ${error.message}`);
  }
}

function coerceKilo(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const num = parseFloat(String(value).replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? num : null;
}

/**
 * @param imageBase64  base64 gambar (tanpa prefix data:)
 * @param mediaType    mis. "image/jpeg" | "image/png"
 * @param knownNames   nama pelanggan dari Bilas untuk periode yang sama (acuan ejaan)
 * @returns [{ nama, namaFoto, kilo, keterangan, yakin }]
 */
async function readKiloPhoto({ imageBase64, mediaType = 'image/jpeg', knownNames = [] }, options = {}) {
  const client = getClient(options);
  const model = options.model || process.env.BEDROCK_MODEL_ID;
  if (!model) {
    throw new KiloReadError('NO_MODEL', 'BEDROCK_MODEL_ID belum diatur di .env.');
  }

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: buildPrompt(knownNames) },
          ],
        },
      ],
    });
  } catch (error) {
    throw new KiloReadError('VISION_FAILED', `Gagal membaca foto: ${error.message}`);
  }

  const text = (response.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) {
    throw new KiloReadError('NO_JSON', 'Hasil pembacaan bukan daftar.');
  }

  return parsed
    .map((row) => {
      const namaFoto = String(row.namaFoto || row.nama || '').trim();
      return {
        nama: String(row.nama || namaFoto).trim(),
        namaFoto,
        kilo: coerceKilo(row.kilo),
        keterangan: String(row.keterangan || '').trim(),
        yakin: row.yakin !== false,
      };
    })
    .filter((row) => row.nama || row.kilo != null);
}

module.exports = { readKiloPhoto, buildPrompt, KiloReadError };
