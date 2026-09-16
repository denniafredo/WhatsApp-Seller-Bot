// Deteksi perintah "auto rekap": rekap pemasukan harian (Shopee + setoran
// offline dari grup) ke Google Sheet keuangan.
//
// Di grup wajib mention bot, sama seperti cek kilo — perintah ini memindahkan
// uang (tarik dana Shopee), jadi tidak boleh terpicu obrolan biasa yang
// kebetulan menyebut "auto rekap".

const { normalizeWhatsAppId } = require('../shared/recapMentionReply');
const { businessYmd, isValidYmd, labelYmd, shiftYmd } = require('./businessDay');

const TRIGGER = 'auto rekap';
const maxCommandLength = 1000;

function stripMentions(text) {
  return text.replace(/@\d+/g, ' ');
}

function getRawCommandText(message) {
  return String(message?.body || message?.caption || '').slice(0, maxCommandLength);
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
  const normalizedBotIds = (botIds || []).map(normalizeWhatsAppId).filter(Boolean);
  return mentioned.some((id) => normalizedBotIds.includes(id));
}

// "auto rekap" = hari ini; "auto rekap kemarin"; "auto rekap tgl:2026-09-14".
function parseTargetDate(text, businessToday) {
  const explicit = text.match(/tgl\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (explicit && isValidYmd(explicit[1])) {
    return explicit[1];
  }

  if (/\bkemarin\b/i.test(text)) {
    return shiftYmd(businessToday, -1);
  }

  return businessToday;
}

// Tarik dana hanya relevan untuk saldo saat ini; merekap tanggal lampau tidak
// boleh ikut menarik uang, karena nominalnya sudah bukan saldo hari itu.
// Pembandingnya HARI KERJA, bukan hari kalender: menjalankan rekap jam 00:30
// masih mengerjakan hari sebelumnya, dan saldo Shopee yang ada saat itu memang
// hasil hari itu yang belum ditarik - jadi penarikannya tetap benar.
function parseSkipShopee(text, targetDate, businessToday) {
  if (/\btanpa\s*shopee\b/i.test(text)) {
    return true;
  }
  return targetDate !== businessToday;
}

/**
 * @returns null bila bukan perintah "auto rekap", atau objek perintah:
 *   { targetDate, dateLabel, skipShopee, isToday }
 */
function getKeuanganCommand(message, botIds, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const isGroup = Boolean(options.isGroup);

  const rawText = getRawCommandText(message);
  if (!hasTrigger(rawText)) {
    return null;
  }

  if (isGroup && !botIsMentioned(message, botIds)) {
    return null;
  }

  const cleanText = stripMentions(rawText);
  const businessToday = businessYmd(Date.now(), timeZone);
  const targetDate = parseTargetDate(cleanText, businessToday);

  return {
    targetDate,
    dateLabel: labelYmd(targetDate),
    businessToday,
    isToday: targetDate === businessToday,
    skipShopee: parseSkipShopee(cleanText, targetDate, businessToday),
  };
}

module.exports = {
  TRIGGER,
  getKeuanganCommand,
  hasTrigger,
  botIsMentioned,
};
