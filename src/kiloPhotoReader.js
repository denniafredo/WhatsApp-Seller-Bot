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

const PROMPT = [
  'Foto ini adalah catatan tulisan tangan karyawan laundry berisi daftar:',
  'nama pelanggan, berat cucian dalam kilogram (kg), dan keterangan opsional.',
  '',
  'Baca SETIAP baris. Kembalikan HANYA sebuah array JSON, tanpa teks lain,',
  'tanpa blok kode markdown. Tiap elemen:',
  '{"nama": string, "kilo": number, "keterangan": string, "yakin": boolean}',
  '',
  'Aturan:',
  '- "kilo": angka kg sebagai desimal titik. Koma jadi titik (2,8 -> 2.8).',
  '  Kalau berat tidak tertulis, pakai null.',
  '- "keterangan": catatan tambahan pada baris itu (mis. express, reguler,',
  '  cuci saja). Kosongkan dengan "" bila tidak ada.',
  '- "yakin": false bila tulisan pada baris itu sulit/ragu dibaca, true bila jelas.',
  '- Abaikan baris judul, total, atau tanda tangan yang bukan data pelanggan.',
  '- Jangan mengarang baris yang tidak ada di foto.',
].join('\n');

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
 * @returns [{ nama, kilo, keterangan, yakin }]
 */
async function readKiloPhoto({ imageBase64, mediaType = 'image/jpeg' }, options = {}) {
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
            { type: 'text', text: PROMPT },
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
    .map((row) => ({
      nama: String(row.nama || '').trim(),
      kilo: coerceKilo(row.kilo),
      keterangan: String(row.keterangan || '').trim(),
      yakin: row.yakin !== false,
    }))
    .filter((row) => row.nama || row.kilo != null);
}

module.exports = { readKiloPhoto, KiloReadError };
