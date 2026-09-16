// Deteksi perintah "cek ongkir" dan pembacaan parameternya:
//
//   cek ongkir
//   dari: dashmall
//   ke: Tlogosari Raya I 65c
//
// "dari" boleh alias titik asal (dashmall/gudang) atau alamat bebas. "ke"
// boleh alamat teks atau link Google - link diterjemahkan jadi nama tempat
// oleh mapsLink.js, bukan di sini.

const { normalizeWhatsAppId } = require('../shared/recapMentionReply');

const TRIGGER = 'cek ongkir';
const maxCommandLength = 1000;

// Alias titik asal -> kata kunci yang diketik ke pencarian Maxim.
//
// Favorites di aplikasi Maxim TIDAK dipakai: mengetik nama favorit tidak
// memunculkannya (yang keluar POI umum), dan favorit hanya tampil saat kolom
// pencarian kosong. Kata kunci di bawah sudah diuji ketemu di hasil teratas.
const BUILTIN_ORIGINS = {
  dashmall: 'Dash Mall Sterofoam',
  gudang: 'Kukilo Mukti Raya 143',
};

// Bisa ditimpa/ditambah lewat .env: ONGKIR_ORIGIN_DASHMALL="Dash Mall Sterofoam"
function loadOrigins() {
  const origins = { ...BUILTIN_ORIGINS };

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^ONGKIR_ORIGIN_(.+)$/);
    if (match && String(value).trim()) {
      origins[match[1].toLowerCase()] = String(value).trim();
    }
  }

  return origins;
}

function normalizeAlias(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveOrigin(value) {
  const origins = loadOrigins();
  const alias = normalizeAlias(value);
  return origins[alias] || null;
}

function listOrigins() {
  return Object.keys(loadOrigins());
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

// Pilihan titik asal untuk menu, terurut tetap supaya nomornya tidak berubah
// di tengah percakapan.
function listOriginEntries() {
  return Object.entries(loadOrigins())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, query]) => ({ alias, query, label: titleCase(alias) }));
}

// Jawaban pilihan titik asal boleh berupa nomor menu, nama alias, atau hasil
// tap menu list (rowId-nya memang alias itu sendiri).
function matchOriginChoice(text) {
  const entries = listOriginEntries();
  const raw = String(text || '').trim();

  const byNumber = raw.match(/^(\d+)[.)]?$/);
  if (byNumber) {
    return entries[Number(byNumber[1]) - 1] || null;
  }

  const wanted = normalizeAlias(raw);
  if (!wanted) return null;

  return (
    entries.find((entry) => normalizeAlias(entry.alias) === wanted) ||
    entries.find((entry) => wanted.includes(normalizeAlias(entry.alias))) ||
    null
  );
}

// Teks apa adanya dari pesan lanjutan (tanpa syarat kata pemicu).
function getMessageText(message) {
  return stripMentions(getRawCommandText(message)).trim();
}

function isCancel(text) {
  return /^(batal|cancel|stop|selesai)$/i.test(String(text || '').trim());
}

function stripMentions(text) {
  return String(text || '').replace(/@\d+/g, ' ');
}

function getRawCommandText(message) {
  const body = message?.type === 'image' ? message?.caption : message?.body;
  return String(body || '').slice(0, maxCommandLength);
}

function hasTrigger(text) {
  return stripMentions(text).toLowerCase().includes(TRIGGER);
}

function getMentionedIds(message) {
  return [
    ...(Array.isArray(message?.mentionedJidList) ? message.mentionedJidList : []),
    ...(Array.isArray(message?.mentionedIds) ? message.mentionedIds : []),
  ]
    .map(normalizeWhatsAppId)
    .filter(Boolean);
}

function botIsMentioned(message, botIds) {
  const mentioned = getMentionedIds(message);
  const normalized = (botIds || []).map(normalizeWhatsAppId).filter(Boolean);
  return mentioned.some((id) => normalized.includes(id));
}

// Mengambil nilai setelah "dari:" / "ke:" sampai akhir baris. Label ditulis
// orang dengan spasi sebelum titik dua ("dari : gudang"), jadi ikut ditoleransi.
function parseField(text, labels) {
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${labels.join('|')})\\s*:\\s*(.+)`, 'i');
  const match = stripMentions(text).match(pattern);
  return match ? match[1].trim() : '';
}

function getOngkirCommand(message, botIds, { isGroup = false } = {}) {
  const rawText = getRawCommandText(message);

  if (!hasTrigger(rawText)) {
    return null;
  }

  // Di grup wajib mention bot supaya obrolan biasa tidak ikut terpicu.
  if (isGroup && !botIsMentioned(message, botIds)) {
    return null;
  }

  const fromField = parseField(rawText, ['dari', 'from', 'jemput', 'pickup']);
  const toField = parseField(rawText, ['ke', 'to', 'tujuan', 'kirim ke']);

  return {
    fromField,
    toField,
    originQuery: resolveOrigin(fromField),
    isOriginAlias: Boolean(resolveOrigin(fromField)),
  };
}

module.exports = {
  TRIGGER,
  getOngkirCommand,
  hasTrigger,
  botIsMentioned,
  resolveOrigin,
  listOrigins,
  listOriginEntries,
  matchOriginChoice,
  getMessageText,
  isCancel,
  parseField,
  BUILTIN_ORIGINS,
};
