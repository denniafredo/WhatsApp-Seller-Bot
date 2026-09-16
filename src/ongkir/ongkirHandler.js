// Orkestrasi fitur "cek ongkir": baca perintah -> jalankan Maxim di emulator
// -> balas screenshot daftar tarif + ringkasan teks. Meniru pola kiloHandler
// (queue + progress reporter) supaya perilakunya seragam dengan fitur lain.
//
// Dua cara pakai, keduanya berakhir di pekerjaan yang sama:
//
//   sekali kirim   "cek ongkir / dari: dashmall / ke: <alamat>"
//   bertahap       "cek ongkir" -> bot tanya titik asal -> bot tanya tujuan
//
// Alur bertahap memakai sesi per pengirim (ongkirSession.js). Di grup, pesan
// lanjutan tidak perlu mention bot lagi - orang tidak mention saat menjawab
// pertanyaan - jadi sesi hanya menangkap balasan dari orang yang memulainya.

const {
  getOngkirCommand,
  listOriginEntries,
  matchOriginChoice,
  getMessageText,
  isCancel,
} = require('./ongkirTrigger');
const { createOngkirSessions, STEP_ORIGIN, STEP_DESTINATION } = require('./ongkirSession');
const { expandLinks } = require('./mapsLink');
const { checkOngkir } = require('./maximDriver');
const { createProgressReporter } = require('../shared/progressReporter');

const menuMode = String(process.env.ONGKIR_MENU_MODE || 'list').toLowerCase();
const maxPrompts = 3;

const sessions = createOngkirSessions();

function formatRupiah(value) {
  return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

function originMenuText() {
  const entries = listOriginEntries();
  return [
    '*Cek ongkir* — kirim dari mana?',
    '',
    ...entries.map((entry, index) => `${index + 1}. ${entry.label}`),
    '',
    'Balas nomornya atau nama tempatnya. Ketik *batal* untuk berhenti.',
  ].join('\n');
}

function originListOptions() {
  const entries = listOriginEntries();
  return {
    buttonText: 'Pilih titik jemput',
    description: originMenuText(),
    sections: [
      {
        title: 'Titik jemput',
        // rowId sengaja dibuat sama dengan alias: balasan tap menu masuk
        // sebagai teks biasa, jadi matchOriginChoice langsung mengenalinya.
        rows: entries.map((entry) => ({
          rowId: entry.alias,
          title: entry.label,
          description: entry.query,
        })),
      },
    ],
  };
}

// Menu list WhatsApp tidak tampil di grup - pesannya terkirim tanpa error tapi
// tidak muncul apa-apa di HP anggota grup. Jadi grup selalu dapat daftar teks.
async function sendOriginMenu(client, chatId, isGroup) {
  const useList = !isGroup && menuMode !== 'text' && typeof client.sendListMessage === 'function';

  if (useList) {
    try {
      await client.sendListMessage(chatId, originListOptions());
      console.log(`Cek ongkir: menu list dikirim ke ${chatId}.`);
      return;
    } catch (error) {
      console.error(`Failed to send ongkir list menu to ${chatId}:`, error.message);
    }
  }

  await client.sendText(chatId, originMenuText());
  console.log(`Cek ongkir: menu teks dikirim ke ${chatId}.`);
}

function describeFailure(error) {
  switch (error && error.code) {
    case 'NO_EMULATOR':
      return `Emulator tidak ditemukan di server. ${error.message}`;
    case 'BOOT_TIMEOUT':
      return error.message;
    case 'NO_ADB':
      return 'Emulator jalan tapi adb-nya tidak bisa dihubungi. Restart MuMuPlayer ya.';
    case 'NO_APP':
      return 'Aplikasi Maxim belum terpasang di emulator. Hubungi admin.';
    case 'NO_CATEGORY':
    case 'UI_CHANGED':
      return `Tampilan aplikasi Maxim berubah, bot perlu disesuaikan. (${error.message})`;
    case 'UI_TIMEOUT':
      return `Aplikasi Maxim tidak merespons: ${error.message}`;
    case 'POINT_FAILED':
      return `${error.message} Coba tulis alamatnya lebih lengkap.`;
    case 'NO_ADDRESS':
      return error.message;
    case 'LINK_FAILED':
    case 'LINK_NO_PLACE':
      return error.message;
    case 'NO_TARIFF':
      return 'Daftar tarif terbuka tapi harganya tidak terbaca. Coba lagi sebentar lagi.';
    case 'QUEUE_FULL':
      return 'Sedang banyak antrean cek ongkir. Coba lagi sebentar lagi ya.';
    default:
      return `Gagal cek ongkir: ${(error && error.message) || 'error tidak diketahui'}`;
  }
}

function buildCaption({ pickup, destination, tariffs }) {
  const lines = [
    '*Cek ongkir — Maxim*',
    `Dari: ${pickup}`,
    `Ke: ${destination}`,
    '',
  ];

  tariffs.forEach((tariff) => {
    lines.push(`• ${tariff.name}: *${formatRupiah(tariff.price)}*`);
  });

  lines.push('');
  lines.push('_Harga dari aplikasi Maxim saat ini, bisa berubah sewaktu-waktu._');

  return lines.join('\n');
}

async function runOngkirJob(client, message, queries, reporter) {
  const result = await checkOngkir({
    ...queries,
    onProgress: (text) => reporter.update(text),
  });

  await reporter.update('Selesai, mengirim hasilnya...');
  await client.sendFileFromBase64(
    message.from,
    `data:image/png;base64,${result.screenshot.toString('base64')}`,
    `ongkir-${Date.now()}.png`,
    buildCaption(result)
  );

  return result;
}

// `*Fallback` dipakai driver kalau pencarian dengan teks lengkap tidak
// menemukan apa pun: alamat hasil link saja, tanpa kata-kata di sekitarnya.
function placesOnly(expanded) {
  return expanded.resolved.map((entry) => entry.placeFull || entry.place).join(', ');
}

async function resolveQueries({ originQuery, fromField, toField }) {
  const pickup = originQuery
    ? { text: originQuery, resolved: [] }
    : await expandLinks(fromField);

  const destination = await expandLinks(toField);

  return {
    pickupQuery: pickup.text,
    pickupFallback: placesOnly(pickup),
    destinationQuery: destination.text,
    destinationFallback: placesOnly(destination),
  };
}

// Menjalankan pekerjaan sampai selesai dan membalas hasilnya. Dipakai oleh
// kedua alur (sekali kirim maupun bertahap).
async function startJob(client, message, input, queue) {
  if (queue.isFull) {
    await client.sendText(message.from, describeFailure({ code: 'QUEUE_FULL' }));
    return true;
  }

  let queries;
  try {
    queries = await resolveQueries(input);
  } catch (error) {
    console.error(`Cek ongkir gagal menyiapkan alamat untuk ${message.from}:`, error);
    await client.sendText(message.from, describeFailure(error)).catch(() => {});
    return true;
  }

  console.log(
    `Cek ongkir dari ${message.from}: "${queries.pickupQuery}" -> "${queries.destinationQuery}"`
  );

  const aheadInQueue = queue.pending + queue.active;
  const reporter = createProgressReporter(client, message.from);
  const jobOutcome = queue
    .push(() => runOngkirJob(client, message, queries, reporter))
    .then((result) => ({ result }), (error) => ({ error }));

  await reporter.start(
    aheadInQueue > 0
      ? `Cek ongkir masuk antrean (${aheadInQueue} di depan), tunggu ya...`
      : 'Cek ongkir diproses, tunggu ya...'
  );

  const { result, error } = await jobOutcome;

  if (error) {
    console.error(`Cek ongkir gagal untuk ${message.from}:`, error);
    await client.sendText(message.from, describeFailure(error)).catch(() => {});
    return true;
  }

  console.log(`Cek ongkir selesai untuk ${message.from}: ${result.tariffs.length} tarif terbaca.`);
  return true;
}

// ---- Alur bertahap -------------------------------------------------------

async function handleOriginReply(client, message, text, isGroup) {
  const choice = matchOriginChoice(text);

  if (!choice) {
    const prompts = sessions.countPrompt(message);
    if (prompts > maxPrompts) {
      sessions.clear(message);
      await client.sendText(
        message.from,
        'Aku belum paham titik jemputnya. Mulai lagi dengan *cek ongkir* ya.'
      );
      return true;
    }

    await client.sendText(
      message.from,
      `"${text}" bukan pilihan yang ada. Balas nomornya, atau ketik *batal*.`
    );
    await sendOriginMenu(client, message.from, isGroup);
    return true;
  }

  sessions.setOrigin(message, { alias: choice.alias, query: choice.query });
  await client.sendText(
    message.from,
    [
      `Titik jemput: *${choice.label}*.`,
      '',
      'Kirim ke mana? Balas alamatnya atau link Google Maps.',
    ].join('\n')
  );
  return true;
}

async function handleDestinationReply(client, message, text, session, queue) {
  sessions.clear(message);
  return startJob(
    client,
    message,
    { originQuery: session.originQuery, toField: text },
    queue
  );
}

// ---- Pintu masuk ---------------------------------------------------------

async function handleOngkirCommand(client, message, { queue, getBotIds, isGroup }) {
  const botIds = isGroup ? await getBotIds() : [];
  const command = getOngkirCommand(message, botIds, { isGroup });

  // Perintah baru selalu menang atas sesi yang sedang berjalan.
  if (command) {
    if (command.fromField && command.toField) {
      sessions.clear(message);
      return startJob(client, message, command, queue);
    }

    sessions.startOriginStep(message);
    console.log(`Cek ongkir: mulai sesi ${isGroup ? 'grup' : 'pribadi'} untuk ${message.from}.`);
    await sendOriginMenu(client, message.from, isGroup);
    return true;
  }

  const session = sessions.get(message);
  if (!session) {
    return false;
  }

  const text = getMessageText(message);

  if (isCancel(text)) {
    sessions.clear(message);
    await client.sendText(message.from, 'Oke, cek ongkir dibatalkan.');
    return true;
  }

  // Lokasi share WhatsApp hanya membawa koordinat, sedangkan pencarian Maxim
  // butuh teks - koordinat mentah membuatnya memilih POI terdekat yang salah.
  if (message?.type === 'location') {
    await client.sendText(
      message.from,
      'Share lokasi belum bisa dipakai. Kirim alamatnya sebagai teks atau link Google Maps ya.'
    );
    return true;
  }

  if (!text) {
    return true;
  }

  if (session.step === STEP_ORIGIN) {
    return handleOriginReply(client, message, text, isGroup);
  }

  if (session.step === STEP_DESTINATION) {
    return handleDestinationReply(client, message, text, session, queue);
  }

  return false;
}

module.exports = {
  handleOngkirCommand,
  buildCaption,
  describeFailure,
  formatRupiah,
  originMenuText,
  sessions,
};
