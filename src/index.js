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
  client.onMessage(async (message) => {
    if (message.fromMe) {
      return;
    }

    const incomingText = getIncomingText(message);

    if (!incomingText) {
      return;
    }

    const shouldSendWelcome = welcomeStore.has(message.from);

    if (shouldSendWelcome) {
      try {
        await sendWelcomeMenu(client, message.from);
        welcomeStore.add(message.from);
      } catch (error) {
        console.error(`Failed to send welcome menu to ${message.from}:`, error);
      }
    }

    const paymentReply = findPaymentReply(incomingText);
    if (paymentReply) {
      await sendPaymentReply(client, message.from, paymentReply);
      return;
    }

    const locationReply = findLocationReply(incomingText);
    if (locationReply) {
      await client.sendText(message.from, locationReply);
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
