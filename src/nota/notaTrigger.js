// Deteksi perintah "nota" dan pemisahan teks perintahnya dari mention.
//
//   @bot nota marvel
//   nama: Bu Sari
//   tgl: 2026-09-22
//
//   1 | Box 37 lakban | 50000
//   2 | Ice pack      | 30rb
//
// Kata "nota" wajib jadi awal baris pertama, bukan sekadar ada di suatu tempat:
// "nota"-nya sendiri kata yang lumrah dipakai mengobrol ("notanya mana?"),
// sedangkan perintah ini selalu diketik sebagai blok format.
//
// Kata sesudahnya adalah nama toko ("nota marvel"); kalau tidak ditulis,
// dipakai toko default. Yang memutuskan kata itu dikenal atau tidak adalah
// notaBrands.js - di sini hanya dipisahkan dari perintahnya.

const { normalizeWhatsAppId } = require('../shared/recapMentionReply');

const TRIGGER = 'nota';

// Cukup untuk nota puluhan baris; lebih panjang dari itu hampir pasti salah
// tempel, bukan nota.
const maxCommandLength = 4000;

function getRawCommandText(message) {
  return String(message?.body || '').slice(0, maxCommandLength);
}

function stripMentions(text) {
  return text.replace(/@\d+/g, ' ');
}

// Baris pertama yang berisi sesuatu - mention bot sering berdiri sendiri di
// baris atas, dan WhatsApp juga menyisipkan baris kosong saat orang menempel
// format dari catatan.
function firstContentLine(text) {
  return (
    stripMentions(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''
  );
}

function hasTrigger(text) {
  return /^nota\b/i.test(firstContentLine(text));
}

// Kata pertama sesudah "nota" di baris perintah. Kosong berarti tidak ditulis.
function parseBrandAlias(text) {
  const match = firstContentLine(text).match(/^nota\b\s*([a-z0-9]+)/i);
  return match ? match[1].toLowerCase() : '';
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

/**
 * @returns null bila bukan perintah nota, atau { text, alias } - teks perintah
 *   tanpa mention (siap dibaca notaParser) dan nama toko yang diketik.
 */
function getNotaCommand(message, botIds, options = {}) {
  const isGroup = Boolean(options.isGroup);
  const rawText = getRawCommandText(message);

  if (!hasTrigger(rawText)) {
    return null;
  }

  // Di grup wajib mention bot; di chat pribadi tidak ada UI mention.
  if (isGroup && !botIsMentioned(message, botIds)) {
    return null;
  }

  const text = stripMentions(rawText);

  return { text, alias: parseBrandAlias(text) };
}

module.exports = {
  TRIGGER,
  getNotaCommand,
  hasTrigger,
  parseBrandAlias,
  botIsMentioned,
  firstContentLine,
};
