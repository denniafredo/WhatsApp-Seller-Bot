// Deteksi perintah "cek kilo" beserta parameternya (cabang, rentang tanggal),
// dan penentuan foto sumber (caption langsung atau reply ke foto).

const { normalizeWhatsAppId } = require('../shared/recapMentionReply');

const TRIGGER = 'cek kilo';
const supportedImageTypes = new Set(['image']);

// Media membawa thumbnail base64 di body; batasi panjang sebelum diproses.
const maxCommandLength = 1000;

function getRawCommandText(message) {
  if (supportedImageTypes.has(message?.type)) {
    return String(message?.caption || '').slice(0, maxCommandLength);
  }
  return String(message?.body || '').slice(0, maxCommandLength);
}

function stripMentions(text) {
  return text.replace(/@\d+/g, ' ');
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

function hasMentions(message) {
  return getMentionedIds(message).length > 0;
}

function botIsMentioned(message, botIds) {
  const mentioned = getMentionedIds(message);
  const normalizedBotIds = (botIds || []).map(normalizeWhatsAppId).filter(Boolean);
  return mentioned.some((id) => normalizedBotIds.includes(id));
}

function getQuotedMessageId(message) {
  const quotedId =
    message?.quotedMsgId ||
    message?.quotedMsg?.id ||
    message?.quotedMsgObj?.id ||
    message?.quotedStanzaID;
  const serialized = quotedId?._serialized || quotedId;
  return serialized && typeof serialized !== 'object' ? String(serialized) : null;
}

// ---- Tanggal -------------------------------------------------------------

function ymdInTimeZone(date, timeZone) {
  // en-CA memberi format YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftYmd(ymd, deltaDays) {
  // Pakai tengah hari UTC supaya pergeseran hari tidak terpengaruh zona waktu.
  const base = new Date(`${ymd}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function toSlash(ymd) {
  return ymd.replace(/-/g, '/');
}

const MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function labelYmd(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${Number(d)} ${MONTHS_ID[Number(m) - 1]} ${y}`;
}

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

// Kembalikan { startDate, endDate, rangeLabel } dalam format Bilas (YYYY/MM/DD).
function parseDateParams(text, timeZone, defaultDays) {
  const today = ymdInTimeZone(new Date(), timeZone);

  const rangeMatch = text.match(/tgl\s*:\s*(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})/i);
  if (rangeMatch && isValidYmd(rangeMatch[1]) && isValidYmd(rangeMatch[2])) {
    let [, start, end] = rangeMatch;
    if (start > end) [start, end] = [end, start];
    return { startDate: toSlash(start), endDate: toSlash(end), rangeLabel: `${labelYmd(start)} s/d ${labelYmd(end)}` };
  }

  const singleMatch = text.match(/tgl\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (singleMatch && isValidYmd(singleMatch[1])) {
    const day = singleMatch[1];
    return { startDate: toSlash(day), endDate: toSlash(day), rangeLabel: labelYmd(day) };
  }

  const daysMatch = text.match(/hari\s*:\s*(\d{1,3})/i);
  const days = daysMatch ? Math.max(1, Math.min(90, Number(daysMatch[1]))) : defaultDays;
  const start = shiftYmd(today, -(days - 1));
  return {
    startDate: toSlash(start),
    endDate: toSlash(today),
    rangeLabel: days === 1 ? labelYmd(today) : `${labelYmd(start)} s/d ${labelYmd(today)}`,
  };
}

function parseOutletAlias(text) {
  const match = text.match(/cabang\s*:\s*([a-z0-9]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * @returns null bila bukan perintah cek kilo, atau objek perintah:
 *   { source: 'caption'|'quoted', quotedMsgId, outletAlias, startDate, endDate, rangeLabel }
 */
function getKiloCommand(message, botIds, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const defaultDays = Number.isFinite(options.defaultDays) ? options.defaultDays : 3;
  const isGroup = Boolean(options.isGroup);

  const rawText = getRawCommandText(message);
  if (!hasTrigger(rawText)) {
    return null;
  }

  // Di grup, wajib mention bot supaya obrolan biasa yang menyebut "cek kilo"
  // tidak ikut terpicu. Di chat pribadi tidak ada UI mention.
  if (isGroup && !botIsMentioned(message, botIds)) {
    return null;
  }

  const cleanText = stripMentions(rawText);
  const outletAlias = parseOutletAlias(cleanText);
  const dates = parseDateParams(cleanText, timeZone, defaultDays);

  if (supportedImageTypes.has(message?.type)) {
    return { source: 'caption', quotedMsgId: null, outletAlias, ...dates };
  }

  const quotedMsgId = getQuotedMessageId(message);
  if (!quotedMsgId) {
    return { source: 'none', quotedMsgId: null, outletAlias, ...dates };
  }
  return { source: 'quoted', quotedMsgId, outletAlias, ...dates };
}

function isSupportedImage(message) {
  return supportedImageTypes.has(message?.type);
}

module.exports = {
  TRIGGER,
  getKiloCommand,
  hasTrigger,
  hasMentions,
  botIsMentioned,
  isSupportedImage,
  parseDateParams,
  parseOutletAlias,
  getQuotedMessageId,
};
