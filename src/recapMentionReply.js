function normalizeWhatsAppId(value) {
  const rawId = value?._serialized || value?.user || value?.id || value;
  return String(rawId || '').replace(/\D/g, '');
}

function getMentionedIds(message) {
  const mentions = [
    ...(Array.isArray(message.mentionedJidList) ? message.mentionedJidList : []),
    ...(Array.isArray(message.mentionedIds) ? message.mentionedIds : []),
  ];

  return mentions.map(normalizeWhatsAppId).filter(Boolean);
}

function getRecapMentionPeriod(message, botIds) {
  const mentionedIds = getMentionedIds(message);
  const normalizedBotIds = botIds.map(normalizeWhatsAppId).filter(Boolean);
  const botWasMentioned = mentionedIds.some((mentionedId) =>
    normalizedBotIds.some((botId) => mentionedId === botId)
  );

  if (!botWasMentioned) {
    return null;
  }

  const command = String(message.body || '')
    .replace(/@\d+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (command === 'rekap' || command === 'rekap hari ini') {
    return 'today';
  }

  if (command === 'rekap kemarin') {
    return 'yesterday';
  }

  return null;
}

function isRecapTodayMention(message, botIds) {
  return Boolean(getRecapMentionPeriod(message, botIds));
}

module.exports = {
  getRecapMentionPeriod,
  isRecapTodayMention,
  normalizeWhatsAppId,
};
