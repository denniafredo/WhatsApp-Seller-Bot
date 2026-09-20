// Membedakan pesan yang DIBUAT bot dari pesan yang DIKETIK ORANG lewat akun
// bot.
//
// Akun bot dipakai manusia juga: catatan seperti "offline 73" atau foto buku
// penjualan sering dikirim langsung dari HP yang login sebagai bot. Semua
// pesan itu sampai ke parser dengan fromMe=true, sama seperti balasan bot
// sendiri. Dulu parser keuangan membuang fromMe apa adanya, jadi setiap
// catatan yang ditulis dari akun bot hilang dari rekap tanpa jejak.
//
// Yang boleh dibuang cuma keluaran bot: balasannya memuat seluruh ringkasan
// hari itu, jadi membacanya lagi akan menggandakan angka yang sama.
//
// Pengenalannya dua lapis:
//   1. Daftar id pesan yang dikirim proses ini (paling pasti).
//   2. Tanda-tanda teks template bot, untuk pesan dari sebelum proses ini
//      hidup - history ditarik ulang setiap rekap, jadi balasan bot kemarin
//      tetap ikut terbaca.

// Cukup untuk beberapa hari lalu lintas grup; yang lebih tua sudah di luar
// jangkauan rekap dan tetap tertangkap lapis kedua.
const MAX_REMEMBERED = 1000;

const rememberedIds = new Set();

function serializeId(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value._serialized || value.id || '');
}

/**
 * Catat id pesan yang baru saja dikirim bot.
 * @param sent hasil client.sendText/sendImage/... (atau id-nya langsung)
 */
function rememberBotMessage(sent) {
  const id = serializeId(sent?.id || sent?.messageId || sent);
  if (!id) {
    return null;
  }

  // Set menjaga urutan sisip, jadi yang paling lama ada di depan.
  if (rememberedIds.size >= MAX_REMEMBERED) {
    const oldest = rememberedIds.values().next().value;
    rememberedIds.delete(oldest);
  }

  rememberedIds.add(id);
  return id;
}

function isRememberedBotMessage(message) {
  const id = serializeId(message?.id);
  return Boolean(id) && rememberedIds.has(id);
}

// Dipakai tes; produksi tidak pernah perlu mengosongkan daftarnya.
function forgetBotMessages() {
  rememberedIds.clear();
}

// Semua yang pernah dikirim bot ke grup rekap. Yang dicari bukan sekadar "mirip
// bot", tapi pembuka template yang tidak mungkin diketik orang sebagai catatan
// belanja.
const BOT_TEXT_PATTERNS = [
  // Balasan auto rekap ("*Auto rekap — 20 Sep 2026*"), pesan progresnya
  // ("Auto rekap ... diproses"), dan kegagalannya ("Auto rekap gagal: ...").
  // Ini yang paling penting: balasannya memuat baris "Offline: ..." dan
  // "Pengeluaran:" yang akan terbaca ulang sebagai setoran baru.
  /^\s*\*?\s*auto rekap\b/i,
  /^\s*recaping\b/i,
  /^\s*rekap\b[^\n]*\b(berhasil|gagal|masuk|range|belum)\b/i,
  /^\s*pesanan tanggal\b/i,
  // Ringkasan hasil rekap: "Total = *Rp...*" diikuti Jumlah/KAS.
  /^\s*total\s*=/i,
  /^\s*\*?\s*cek (kilo|ongkir)\b/i,
  // Pesan progres selalu satu baris dan diakhiri "..." ("Menulis ke
  // spreadsheet keuangan...", "Menarik transaksi Dashmall..."). Catatan
  // belanja yang diketik orang tidak pernah berbentuk begitu.
  /^[^\n]{1,160}\.\.\.\s*$/,
];

function isBotGeneratedText(text) {
  const value = String(text || '').trim();
  if (!value) {
    return false;
  }
  return BOT_TEXT_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Pesan ini keluaran bot (bukan ketikan orang dari akun bot)?
 *
 * Pesan dari akun lain selalu false - pemanggilnya tidak perlu memeriksa
 * fromMe lagi.
 */
function isBotGeneratedMessage(message) {
  if (!message?.fromMe) {
    return false;
  }

  if (isRememberedBotMessage(message)) {
    return true;
  }

  return isBotGeneratedText(message?.body || message?.caption || message?.content || '');
}

// Nama method wppconnect yang menghasilkan pesan baru di chat. editMessage
// tidak perlu: id pesan progres sudah tercatat waktu dikirim.
const SEND_METHODS = [
  'sendText',
  'reply',
  'sendImage',
  'sendImageFromBase64',
  'sendFile',
  'sendFileFromBase64',
  'sendVideoAsGif',
  'sendPtt',
  'sendVoice',
  'sendListMenu',
  'sendLocation',
];

/**
 * Bungkus method pengirim milik client supaya setiap pesan yang dikirim bot
 * tercatat idnya. Dipanggil sekali saat start, sebelum listener dipasang.
 */
function watchBotMessages(client) {
  if (!client || client.__botOutputWatched) {
    return client;
  }

  SEND_METHODS.forEach((name) => {
    const original = client[name];
    if (typeof original !== 'function') {
      return;
    }

    client[name] = async (...args) => {
      const sent = await original.apply(client, args);
      // Kegagalan mencatat tidak boleh menggagalkan pengiriman: efek terburuk
      // dari id yang lolos cuma pesan bot yang dinilai lewat pola teks.
      try {
        rememberBotMessage(sent);
      } catch (error) {
        console.error(`Gagal mencatat id pesan bot (${name}):`, error.message);
      }
      return sent;
    };
  });

  client.__botOutputWatched = true;
  return client;
}

module.exports = {
  BOT_TEXT_PATTERNS,
  forgetBotMessages,
  isBotGeneratedMessage,
  isBotGeneratedText,
  isRememberedBotMessage,
  rememberBotMessage,
  watchBotMessages,
};
