require('dotenv').config();

const fs = require('fs');
const wppconnect = require('@wppconnect-team/wppconnect');
const { findReply, normalizeKeyword, replies } = require('./replies/keywordReplies');
const { findLocationReply } = require('./replies/locationReplies');
const { findPaymentReply } = require('./replies/paymentReplies');
const { getRecapMentionPeriod } = require('./shared/recapMentionReply');
const { buildRecapFromMessages } = require('./sheets/recapParser');
const { getRecapOutput, updateRecapSheet } = require('./sheets/googleSheets');
const { createWelcomeListOptions, createWelcomeMessage, menuItems } = require('./replies/welcomeMessage');
const { createWelcomeStore } = require('./replies/welcomeStore');
const { createJobQueue } = require('./video/videoJobQueue');
const { handleNoiseCommand } = require('./video/videoNoiseHandler');
const { handleKiloCommand } = require('./kilo/kiloHandler');
const { handleOngkirCommand } = require('./ongkir/ongkirHandler');
const { handleNotaCommand } = require('./nota/notaHandler');
const { handleKeuanganCommand } = require('./keuangan/keuanganHandler');
const { createBilasClient } = require('./kilo/bilasClient');
const { config: recapSummaryConfig, sendRecapSummary } = require('./shared/recapSummary');
const { watchBotMessages } = require('./shared/botOutput');
const { handleSqueezeCommand } = require('./squeeze/squeezeHandler');
const { startSqueezeSchedule } = require('./squeeze/squeezeSchedule');

const sessionName = process.env.WPP_SESSION || 'business-bot';
const businessPhoneNumber = process.env.BUSINESS_PHONE || '';
const welcomeMenuMode = process.env.WELCOME_MENU_MODE || 'list';
const textMenuFallback = process.env.TEXT_MENU_FALLBACK === 'true';
const chromePath = process.env.CHROME_PATH || undefined;
const puppeteerHeadless = process.env.PUPPETEER_HEADLESS !== 'false';
const configuredRecapFormat = String(
  process.env.RECAP_FORMAT || process.env.recap_format || 'pdf'
).toLowerCase();
const recapFormat = configuredRecapFormat === 'jpg' ? 'jpg' : 'pdf';
const recapTimeZone = process.env.RECAP_TIMEZONE || 'Asia/Makassar';
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
  // Dipasang paling awal: setiap pesan yang dikirim bot dicatat idnya, supaya
  // parser keuangan bisa membedakan balasan bot dari catatan yang diketik
  // orang lewat akun bot (keduanya sampai sebagai fromMe).
  watchBotMessages(client);

  const botStartedAtMs = Date.now();
  let loggedInWhatsAppIds;
  const groupMessageBuffers = new Map();
  // onMessage listeners run concurrently, so this bounds how many ffmpeg
  // processes (and decrypted video buffers) can exist at the same time.
  const videoJobQueue = createJobQueue({ concurrency: 1, maxPending: 5 });
  // Antrean terpisah supaya cek kilo (vision + API Bilas) tidak saling menghambat
  // dengan noise reduction video.
  const kiloJobQueue = createJobQueue({ concurrency: 1, maxPending: 5 });
  // Cek ongkir memakai satu emulator Android, jadi tidak boleh ada dua
  // permintaan yang mengendalikan aplikasi Maxim pada saat bersamaan.
  const ongkirJobQueue = createJobQueue({ concurrency: 1, maxPending: 5 });
  // Auto rekap menarik dana Shopee, jadi tidak boleh ada dua yang jalan
  // bersamaan dan antreannya sengaja pendek: permintaan yang menumpuk di sini
  // hampir selalu perintah yang diulang, bukan pekerjaan baru.
  const keuanganJobQueue = createJobQueue({ concurrency: 1, maxPending: 1 });
  const bilas = createBilasClient();

  // Laporan sinyal crypto harian ke grup SQUEEZE_SIGNAL_GROUP_NAME (default "cstv").
  startSqueezeSchedule(client);

  const getLoggedInWhatsAppIds = async () => {
    if (!loggedInWhatsAppIds) {
      const wid = await client.getWid();
      const pnLidEntry = await client.getPnLidEntry(wid).catch(() => ({}));
      loggedInWhatsAppIds = [
        wid,
        pnLidEntry.lid?._serialized,
        pnLidEntry.phoneNumber?._serialized,
        businessPhoneNumber,
      ].filter(Boolean);

      console.log(`Bot mention IDs: ${loggedInWhatsAppIds.join(', ')}`);
    }

    return loggedInWhatsAppIds;
  };

  client.onMessage(async (message) => {
    if (message.fromMe) {
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

    if (isGroupMessage(message)) {
      console.log(`Received group message from ${message.from}: "${message.body}".`);
      rememberGroupMessage(groupMessageBuffers, message);

      const kiloHandledGroup = await handleKiloCommand(client, message, {
        queue: kiloJobQueue,
        getBotIds: getLoggedInWhatsAppIds,
        bilas,
        isGroup: true,
        timeZone: recapTimeZone,
      }).catch((error) => {
        console.error(`Failed to handle cek kilo (group) from ${message.from}:`, error);
        return false;
      });

      if (kiloHandledGroup) {
        return;
      }

      const ongkirHandledGroup = await handleOngkirCommand(client, message, {
        queue: ongkirJobQueue,
        getBotIds: getLoggedInWhatsAppIds,
        isGroup: true,
      }).catch((error) => {
        console.error(`Failed to handle cek ongkir (group) from ${message.from}:`, error);
        return false;
      });

      if (ongkirHandledGroup) {
        return;
      }

      const notaHandledGroup = await handleNotaCommand(client, message, {
        getBotIds: getLoggedInWhatsAppIds,
        isGroup: true,
        timeZone: recapTimeZone,
      }).catch((error) => {
        console.error(`Failed to handle nota (group) from ${message.from}:`, error);
        return false;
      });

      if (notaHandledGroup) {
        return;
      }

      const keuanganHandledGroup = await handleKeuanganCommand(client, message, {
        queue: keuanganJobQueue,
        getBotIds: getLoggedInWhatsAppIds,
        isGroup: true,
        timeZone: recapTimeZone,
        getGroupBuffer: (chatId) => groupMessageBuffers.get(chatId),
      }).catch((error) => {
        console.error(`Failed to handle auto rekap (group) from ${message.from}:`, error);
        return false;
      });

      if (keuanganHandledGroup) {
        return;
      }

      const squeezeHandledGroup = await handleSqueezeCommand(client, message, {
        getBotIds: getLoggedInWhatsAppIds,
        isGroup: true,
      }).catch((error) => {
        console.error(`Failed to handle squeeze signal (group) from ${message.from}:`, error);
        return false;
      });

      if (squeezeHandledGroup) {
        return;
      }

      try {
        const botIds = await getLoggedInWhatsAppIds();
        const recapPeriod = getRecapMentionPeriod(message, botIds);
        if (recapPeriod) {
          await client.sendText(message.from, 'Recaping...');

          const historyMessages = await client
            .getMessages(message.from, { count: 300 })
            .catch((error) => {
              console.error(`Failed to load group history ${message.from}, using live buffer:`, error);
              return [];
            });
          const bufferedMessages = groupMessageBuffers.get(message.from) || [];
          const messagesById = new Map();
          [...historyMessages, ...bufferedMessages].forEach((groupMessage) => {
            messagesById.set(getMessageIdentity(groupMessage), groupMessage);
          });
          const messages = [...messagesById.values()];
          const commandTimestamp = getMessageTimestampMs(message) || Date.now();
          const targetDate = getRecapDateLabel(recapPeriod, commandTimestamp, recapTimeZone);
          const recapMessages = messages
            .filter((groupMessage) => {
              const timestamp = getMessageTimestampMs(groupMessage);
              return getMessageIdentity(groupMessage) !== getMessageIdentity(message) &&
                (!timestamp || timestamp <= commandTimestamp);
            })
            .sort((left, right) =>
              (getMessageTimestampMs(left) || 0) - (getMessageTimestampMs(right) || 0)
            );
          let recap = buildRecapFromMessages(recapMessages, targetDate);
          let usedLatestFallback = false;

          if (!recap && recapPeriod === 'today') {
            recap = buildRecapFromMessages(recapMessages);
            usedLatestFallback = Boolean(recap);
          }

          if (!recap) {
            await client.sendText(
              message.from,
              `Pesanan tanggal ${targetDate} belum ditemukan di 300 pesan terakhir.`
            );
            return;
          }

          await updateRecapSheet(recap);
          const output = await getRecapOutput(recapFormat);
          const warning = recap.unknownProducts.length
            ? ` Produk belum dikenali: ${recap.unknownProducts.join(', ')}.`
            : '';
          await client.sendText(
            message.from,
            `Rekap ${recap.date} berhasil dimasukkan (${recap.quantities.length} item).${usedLatestFallback ? ` Pesanan ${targetDate} belum ada, jadi dipakai pesanan terakhir.` : ''
            }${warning}`
          );
          await client.sendFileFromBase64(
            message.from,
            output.fileBase64,
            `rekap-${recap.date.replace(/\s+/g, '-')}.${output.fileExtension}`,
            `Rekap ${recap.date} — range A1:E62`
          );
          await client.sendText(
            message.from,
            [
              `Total = *${output.totalAmount}*`,
              `Jumlah = ${output.totalQuantity}`,
              '-----------------------------',
              `KAS = *${output.cashAmount}*`,
              `Jumlah = ${output.cashQuantity}`,
            ].join('\n')
          );

          // Ringkasan ke grup lain sengaja dipisah dari try/catch rekap: rekapnya
          // sudah masuk sheet dan sudah dibalas, jadi kegagalan mengirim
          // ringkasan tidak boleh terbaca seperti "rekap gagal".
          const summary = await sendRecapSummary(client, message, output).catch((error) => {
            console.error(`Failed to send recap summary to "${recapSummaryConfig.groupName}":`, error);
            return { sent: false, error };
          });

          if (summary.error) {
            await client
              .sendText(
                message.from,
                `Rekap masuk, tapi ringkasan ke grup "${recapSummaryConfig.groupName}" gagal: ${summary.error.message}`
              )
              .catch(() => { });
          } else if (summary.sent) {
            console.log(`Sent recap summary for ${recap.date} to ${summary.groupId}.`);
          } else {
            console.log(`Skipped recap summary for ${recap.date}: ${summary.reason}.`);
          }

          console.log(`Updated recap sheet for ${recap.date} from ${message.from}.`);
        }
      } catch (error) {
        console.error(`Failed to handle group mention from ${message.from}:`, error);
        await client.sendText(message.from, `Rekap gagal: ${error.message}`).catch(() => { });
      }

      return;
    }

    // Runs before getIncomingText because a video carries its command in
    // `caption` rather than `body`, and an empty body would return early below.
    // Also keeps a noise request from triggering the welcome menu.
    const noiseHandled = await handleNoiseCommand(client, message, {
      queue: videoJobQueue,
      getBotIds: getLoggedInWhatsAppIds,
    }).catch((error) => {
      console.error(`Failed to handle noise command from ${message.from}:`, error);
      return false;
    });

    if (noiseHandled) {
      return;
    }

    // Foto catatan kilo membawa perintahnya di caption; taruh sebelum
    // getIncomingText agar tidak memicu menu sambutan.
    const kiloHandled = await handleKiloCommand(client, message, {
      queue: kiloJobQueue,
      getBotIds: getLoggedInWhatsAppIds,
      bilas,
      isGroup: false,
      timeZone: recapTimeZone,
    }).catch((error) => {
      console.error(`Failed to handle cek kilo from ${message.from}:`, error);
      return false;
    });

    if (kiloHandled) {
      return;
    }

    // Perintah teks biasa, tapi harus di atas getIncomingText supaya tidak
    // memicu menu sambutan untuk pelanggan baru.
    const ongkirHandled = await handleOngkirCommand(client, message, {
      queue: ongkirJobQueue,
      getBotIds: getLoggedInWhatsAppIds,
      isGroup: false,
    }).catch((error) => {
      console.error(`Failed to handle cek ongkir from ${message.from}:`, error);
      return false;
    });

    if (ongkirHandled) {
      return;
    }

    // Di atas getIncomingText supaya perintah nota tidak ikut memicu menu
    // sambutan untuk pelanggan baru.
    const notaHandled = await handleNotaCommand(client, message, {
      getBotIds: getLoggedInWhatsAppIds,
      isGroup: false,
      timeZone: recapTimeZone,
    }).catch((error) => {
      console.error(`Failed to handle nota from ${message.from}:`, error);
      return false;
    });

    if (notaHandled) {
      return;
    }

    // Perintah teks biasa; harus di atas getIncomingText supaya tidak memicu
    // menu sambutan.
    const keuanganHandled = await handleKeuanganCommand(client, message, {
      queue: keuanganJobQueue,
      getBotIds: getLoggedInWhatsAppIds,
      isGroup: false,
      timeZone: recapTimeZone,
      getGroupBuffer: (chatId) => groupMessageBuffers.get(chatId),
    }).catch((error) => {
      console.error(`Failed to handle auto rekap from ${message.from}:`, error);
      return false;
    });

    if (keuanganHandled) {
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
    console.log(`shouldSendWelcome: ${shouldSendWelcome} for ${message.from}.`);

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

function getMessageIdentity(message) {
  const id = message.id?._serialized || message.id?.id || message.id;
  if (id && typeof id !== 'object') {
    return String(id);
  }

  return [
    getMessageTimestampMs(message) || 0,
    message.author || message.from || '',
    message.body || message.content || '',
  ].join('|');
}

function rememberGroupMessage(groupMessageBuffers, message) {
  const messages = groupMessageBuffers.get(message.from) || [];
  const identity = getMessageIdentity(message);
  const existingIndex = messages.findIndex((item) => getMessageIdentity(item) === identity);

  if (existingIndex >= 0) {
    messages[existingIndex] = message;
  } else {
    messages.push(message);
  }

  groupMessageBuffers.set(message.from, messages.slice(-300));
}

function getRecapDateLabel(period, referenceTimestampMs, timeZone) {
  const offsetMs = period === 'yesterday' ? 24 * 60 * 60 * 1000 : 0;
  const targetDate = new Date(referenceTimestampMs - offsetMs);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(targetDate);
  const day = parts.find((part) => part.type === 'day')?.value;
  const monthNumber = Number(parts.find((part) => part.type === 'month')?.value);
  return `${day} ${monthNames[monthNumber - 1]}`;
}
