// Perintah manual: mention bot di grup lalu tulis "signal squeeze".
// Laporannya dibalas ke grup tempat perintah diketik.
//
// Sengaja hanya di grup, wajib mention, dan wajib dua kata: bot ini juga
// membalas pelanggan di chat pribadi, dan "signal" saja terlalu umum untuk
// dianggap perintah. Salah ketik yang lumrah ("sinyal", "sequeeze",
// "squeze") tetap diterima.

const { normalizeWhatsAppId } = require('../shared/recapMentionReply');
const { runSqueezeScreener } = require('./squeezeScreener');

function firstContentLine(text) {
  return (
    String(text || '')
      .replace(/@\d+/g, ' ')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''
  );
}

function botIsMentioned(message, botIds) {
  const mentioned = [
    ...(Array.isArray(message?.mentionedJidList) ? message.mentionedJidList : []),
    ...(Array.isArray(message?.mentionedIds) ? message.mentionedIds : []),
  ]
    .map(normalizeWhatsAppId)
    .filter(Boolean);
  const normalizedBotIds = (botIds || []).map(normalizeWhatsAppId).filter(Boolean);
  return mentioned.some((id) => normalizedBotIds.includes(id));
}

function isSqueezeCommand(message, botIds) {
  return /^(signal|sinyal)\s+s(e)?que?eze\b/i.test(firstContentLine(message?.body)) && botIsMentioned(message, botIds);
}

// Satu screening makan beberapa detik dan memanggil API Indodax ~70 kali;
// perintah yang diketik ulang selagi masih jalan cukup ditolak.
let running = false;

async function handleSqueezeCommand(client, message, { getBotIds, isGroup }) {
  if (!isGroup) {
    return false;
  }

  const botIds = await getBotIds();
  if (!isSqueezeCommand(message, botIds)) {
    return false;
  }

  if (running) {
    await client.sendText(message.from, 'Screening masih jalan, tunggu sebentar.');
    return true;
  }

  running = true;
  try {
    await client.sendText(message.from, 'Screening koin Indodax...');
    const report = await runSqueezeScreener();
    await client.sendText(message.from, report);
    console.log(`Sent squeeze signal on request to ${message.from}.`);
  } catch (error) {
    console.error(`Failed to run squeeze screener for ${message.from}:`, error);
    await client.sendText(message.from, `Screening gagal: ${error.message}`).catch(() => { });
  } finally {
    running = false;
  }

  return true;
}

module.exports = {
  handleSqueezeCommand,
  isSqueezeCommand,
};
