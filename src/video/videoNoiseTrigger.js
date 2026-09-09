const { normalizeWhatsAppId } = require('../shared/recapMentionReply');

const supportedTypes = new Set(['video']);

// A trigger word can pin the engine, so the sender picks the engine by wording
// instead of the operator editing VIDEO_DENOISE_ENGINE. Phrases with a null
// engine fall back to whatever that env var says.
const triggerRules = [
  { phrase: 'noise', engine: 'voicecleaner' },
  { phrase: 'denoise', engine: 'voicecleaner' },
  { phrase: 'kurangi noise', engine: 'voicecleaner' },
  { phrase: 'hilangkan noise', engine: 'voicecleaner' },
  { phrase: 'lokal', engine: 'deepfilternet' },
  { phrase: 'bersihkan suara', engine: null },
  { phrase: 'bersihin suara', engine: null },
];

const triggerPhrases = triggerRules.map((rule) => rule.phrase);

// Media messages can carry a base64 thumbnail in `body`, so cap the length
// before normalizing instead of running regexes over tens of kilobytes.
const maxCommandLength = 500;

function normalizeCommand(value) {
  return String(value || '')
    .slice(0, maxCommandLength)
    .replace(/@\d+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesTrigger(text) {
  return triggerPhrases.some((phrase) => text.includes(phrase));
}

// Longest phrase first, so "kurangi noise" is not shadowed by the bare "noise"
// rule when both would match.
function findTriggerRule(text) {
  return [...triggerRules]
    .sort((left, right) => right.phrase.length - left.phrase.length)
    .find((rule) => text.includes(rule.phrase)) || null;
}

function isSupportedMedia(message) {
  return supportedTypes.has(message?.type);
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

// A private chat has no mention UI, so mentions are only enforced when they are
// actually present. That keeps this usable as-is if groups are enabled later.
function isMentionSatisfied(message, botIds) {
  const mentionedIds = getMentionedIds(message);
  if (!mentionedIds.length) {
    return true;
  }

  const normalizedBotIds = (botIds || []).map(normalizeWhatsAppId).filter(Boolean);

  return mentionedIds.some((mentionedId) => normalizedBotIds.includes(mentionedId));
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

// `caption` is the documented field for image and video messages, while `body`
// is only guaranteed for plain chat, so pick per message type rather than by
// truthiness. Falling back to a long `body` is unsafe: it can hold a base64
// thumbnail, and the base64 alphabet can spell a trigger word by chance.
const maxFallbackBodyLength = 200;

function getCommandText(message) {
  if (!isSupportedMedia(message)) {
    return normalizeCommand(message?.body || message?.caption);
  }

  const caption = normalizeCommand(message?.caption);
  if (caption) {
    return caption;
  }

  const body = String(message?.body || '');

  return body.length <= maxFallbackBodyLength ? normalizeCommand(body) : '';
}

function getNoiseCommand(message, botIds) {
  const text = getCommandText(message);
  const rule = text ? findTriggerRule(text) : null;

  if (!rule) {
    return null;
  }

  if (!isMentionSatisfied(message, botIds)) {
    return null;
  }

  if (isSupportedMedia(message)) {
    return { source: 'caption', quotedMsgId: null, engine: rule.engine };
  }

  const quotedMsgId = getQuotedMessageId(message);

  return quotedMsgId ? { source: 'quoted', quotedMsgId, engine: rule.engine } : null;
}

module.exports = {
  findTriggerRule,
  getCommandText,
  getNoiseCommand,
  triggerRules,
  getQuotedMessageId,
  hasMentions,
  isSupportedMedia,
  matchesTrigger,
  normalizeCommand,
  supportedTypes,
  triggerPhrases,
};
