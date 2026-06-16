require('dotenv').config();

const fs = require('fs');
const wppconnect = require('@wppconnect-team/wppconnect');
const { findReply, normalizeKeyword, replies } = require('./keywordReplies');
const { findLocationReply } = require('./locationReplies');
const { findPaymentReply } = require('./paymentReplies');
const { createWelcomeListOptions, createWelcomeMessage, menuItems } = require('./welcomeMessage');
const { createWelcomeStore } = require('./welcomeStore');

const sessionName = process.env.WPP_SESSION || 'business-bot';
const businessPhoneNumber = process.env.BUSINESS_PHONE || '';
const welcomeMenuMode = process.env.WELCOME_MENU_MODE || 'list';
const textMenuFallback = process.env.TEXT_MENU_FALLBACK === 'true';
const chromePath = process.env.CHROME_PATH || undefined;
const puppeteerHeadless = process.env.PUPPETEER_HEADLESS !== 'false';
const welcomeMessage = createWelcomeMessage(businessPhoneNumber);
const welcomeListOptions = createWelcomeListOptions();
const welcomeStore = createWelcomeStore();

wppconnect
  .create({
    session: sessionName,
    logQR: true,
    autoClose: 0,
    tokenStore: 'file',
    folderNameToken: './tokens',
    puppeteerOptions: {
      headless: puppeteerHeadless,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  })
  .then(start)
  .catch((error) => {
    console.error('Failed to start WhatsApp bot:', error);
    process.exitCode = 1;
  });

function start(client) {
  const botStartedAtMs = Date.now();

  client.onMessage(async (message) => {
    if (message.fromMe) {
      return;
    }

    if (isGroupMessage(message)) {
      return;
    }

    if (isStatusBroadcastMessage(message)) {
      return;
    }

    if (isBlockedChatMessage(message)) {
      console.log(`Skipped blocked chat ${message.from}.`);
      return;
    }

    if (isHistoricalMessage(message, botStartedAtMs)) {
      console.log(`Skipped old message from ${message.from}.`);
      return;
    }

    const incomingText = getIncomingText(message);

    if (!incomingText) {
      return;
    }

    if (isJobInquiry(incomingText)) {
      console.log(`Skipped job inquiry from ${message.from}: "${incomingText}".`);
      return;
    }

    console.log(`Received message from ${message.from}: "${incomingText}".`);

    const shouldSendWelcome = !welcomeStore.has(message.from);
    if (shouldSendWelcome) {
      try {
        await sendWelcomeMenu(client, message.from);
        welcomeStore.add(message.from);
        console.log(`Sent welcome menu to ${message.from}.`);

      } catch (error) {
        console.error(`Failed to send welcome menu to ${message.from}:`, error);
      }
    }

    const paymentReply = findPaymentReply(incomingText);
    if (paymentReply) {
      await sendPaymentReply(client, message.from, paymentReply);
      console.log(`Sent payment reply for "${paymentReply.keyword}" to ${message.from}.`);

      return;
    }

    const locationReply = findLocationReply(incomingText);
    if (locationReply) {
      await client.sendText(message.from, locationReply);
      console.log(`Sent location reply to ${message.from}.`);
      return;
    }

    const reply = findReply(incomingText);
    if (!reply) {
      return;
    }

    if (!fs.existsSync(reply.imagePath)) {
      console.error(`Image file not found for "${reply.keyword}": ${reply.imagePath}`);
      await client.sendText(
        message.from,
        'Maaf, gambar price list belum tersedia. Admin akan segera update.'
      );
      return;
    }

    try {
      await client.sendImage(message.from, reply.imagePath, reply.fileName, reply.caption);
      console.log(`Sent "${reply.keyword}" image to ${message.from}.`);
    } catch (error) {
      console.error(`Failed to send "${reply.keyword}" image to ${message.from}:`, error);
    }
  });
}

async function sendPaymentReply(client, chatId, paymentReply) {
  if (paymentReply.type === 'text') {
    await client.sendText(chatId, paymentReply.text);
    return;
  }

  if (!fs.existsSync(paymentReply.imagePath)) {
    console.error(`Image file not found for "${paymentReply.keyword}": ${paymentReply.imagePath}`);
    await client.sendText(chatId, 'Maaf, gambar QRIS belum tersedia. Admin akan segera update.');
    return;
  }

  await client.sendImage(
    chatId,
    paymentReply.imagePath,
    paymentReply.fileName,
    paymentReply.caption
  );
}

async function sendWelcomeMenu(client, chatId) {
  if (welcomeMenuMode === 'text') {
    await client.sendText(chatId, welcomeMessage);
    return;
  }

  if (typeof client.sendListMessage !== 'function') {
    throw new Error('client.sendListMessage is not available in this WPPConnect version.');
  }

  if (typeof client.sendListMessage === 'function') {
    try {
      await client.sendListMessage(chatId, welcomeListOptions);
      return;
    } catch (error) {
      console.error(`Failed to send list menu to ${chatId}:`, error);

      if (!textMenuFallback) {
        throw error;
      }

      console.error(`Sending text fallback to ${chatId} because TEXT_MENU_FALLBACK=true.`);
    }
  }

  await client.sendText(chatId, welcomeMessage);
}

function getIncomingText(message) {
  const candidates = [
    message.body,
    message.selectedRowId,
    message.listResponse?.singleSelectReply?.selectedRowId,
    message.listResponse?.title,
    message.listResponse?.description,
    message.selectedButtonId,
  ];

  const listKeyword = candidates.find((candidate) => findReply(candidate));
  if (listKeyword) {
    return listKeyword;
  }

  const normalizedBody = normalizeKeyword(message.body);
  const matchedMenuItem = menuItems.find((item) => normalizeKeyword(item.listTitle) === normalizedBody);

  return matchedMenuItem ? matchedMenuItem.keyword : message.body;
}

function isGroupMessage(message) {
  if (message.isGroupMsg || message.isGroup) {
    return true;
  }

  const chatIds = [
    message.from,
    message.to,
    message.chatId,
    message.id?.remote,
    message.chat?.id?._serialized,
  ];

  return chatIds.some((chatId) => String(chatId || '').endsWith('@g.us'));
}

function isStatusBroadcastMessage(message) {
  const chatIds = [
    message.from,
    message.to,
    message.chatId,
    message.id?.remote,
    message.chat?.id?._serialized,
  ];

  return chatIds.some((chatId) => String(chatId || '') === 'status@broadcast');
}

function isBlockedChatMessage(message) {
  const blockedChatIds = [
    '270381629870324@lid',
  ];
  const chatIds = [
    message.from,
    message.to,
    message.chatId,
    message.id?.remote,
    message.chat?.id?._serialized,
  ];

  return chatIds.some((chatId) => blockedChatIds.includes(String(chatId || '')));
}

function isJobInquiry(messageBody) {
  const text = normalizeKeyword(messageBody);
  const strongKeywords = [
    'loker',
    'lowongan',
    'lamaran',
    'melamar',
    'hiring',
    'rekrutmen',
    'recruitment',
    'vacancy',
    'karir',
  ];

  if (strongKeywords.some((keyword) => text.includes(keyword))) {
    return true;
  }

  return (
    text.includes('cari kerja') ||
    text.includes('nyari kerja') ||
    text.includes('butuh kerja') ||
    text.includes('ada kerjaan')
  );
}

function isHistoricalMessage(message, botStartedAtMs) {
  if (message.isNewMsg === false) {
    return true;
  }

  const messageTimestampMs = getMessageTimestampMs(message);
  if (!messageTimestampMs) {
    return false;
  }

  return messageTimestampMs < botStartedAtMs - 5000;
}

function getMessageTimestampMs(message) {
  const timestamp = [
    message.timestamp,
    message.t,
    message.id?.timestamp,
  ].find((value) => value !== undefined && value !== null);

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return null;
  }

  return numericTimestamp < 1000000000000
    ? numericTimestamp * 1000
    : numericTimestamp;
}
