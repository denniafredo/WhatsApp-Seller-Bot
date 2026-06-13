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
    statusFind: (statusSession, session) => {
      console.log(`[${session}] status: ${statusSession}`);
    },
  })
  .then(start)
  .catch((error) => {
    console.error('Failed to start WhatsApp bot:', error);
    process.exitCode = 1;
  });

function start(client) {
  console.log('WhatsApp bot is running.');
  console.log(
    businessPhoneNumber
      ? 'Welcome menu links are enabled.'
      : 'Welcome menu links are disabled. Set BUSINESS_PHONE to enable prefilled WhatsApp links.'
  );
  console.log(`Welcome menu mode: ${welcomeMenuMode}`);
  console.log(`Text menu fallback: ${textMenuFallback ? 'enabled' : 'disabled'}`);
  console.log('Active keywords:');
  replies.forEach((reply) => console.log(`- ${reply.keyword}`));

  client.onMessage(async (message) => {
    if (message.fromMe) {
      return;
    }

    const incomingText = getIncomingText(message);

    if (!incomingText) {
      return;
    }

    const shouldSendWelcome = !welcomeStore.has(message.from);

    if (shouldSendWelcome) {
      try {
        await sendWelcomeMenu(client, message.from);
        welcomeStore.add(message.from);
        console.log(`Sent welcome menu to ${message.from}`);
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
      console.log(`Sent address text to ${message.from}`);
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
      console.log(`Sent "${reply.keyword}" image to ${message.from}`);
    } catch (error) {
      console.error(`Failed to send "${reply.keyword}" image to ${message.from}:`, error);
    }
  });
}

async function sendPaymentReply(client, chatId, paymentReply) {
  if (paymentReply.type === 'text') {
    await client.sendText(chatId, paymentReply.text);
    console.log(`Sent "${paymentReply.keyword}" payment text to ${chatId}`);
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
  console.log(`Sent "${paymentReply.keyword}" payment image to ${chatId}`);
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
