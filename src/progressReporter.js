// Satu pesan status yang diperbarui di tempat lewat client.editMessage, bukan
// pesan baru per tahap - alur voicecleaner punya 6 tahap dan itu akan membanjiri
// chat pelanggan.
//
// Semua kegagalan di sini ditelan: status hanya informasi tambahan, dan tidak
// boleh membatalkan pekerjaan yang sudah berhasil.
function createProgressReporter(client, chatId, options = {}) {
  const minIntervalMs = Number.isFinite(options.minIntervalMs) ? options.minIntervalMs : 1200;
  let messageId = null;
  let lastText = '';
  let lastAtMs = 0;
  let editable = true;
  // The job is queued before the opening message is awaited, so its first
  // progress call can arrive before there is a message to edit. Updates wait on
  // this instead of being dropped.
  let started = null;

  async function start(text) {
    started = (async () => {
      try {
        const sent = await client.sendText(chatId, text);
        messageId = sent?.id || sent?.messageId || null;
        lastText = text;
        lastAtMs = Date.now();
      } catch (error) {
        console.error(`Failed to send status to ${chatId}:`, error.message);
      }
    })();

    await started;

    return messageId;
  }

  async function update(text) {
    if (started) {
      await started;
    }

    if (!messageId || !editable || !text || text === lastText) {
      return;
    }

    const sinceLastMs = Date.now() - lastAtMs;
    if (sinceLastMs < minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs - sinceLastMs));
    }

    try {
      await client.editMessage(messageId, text);
      lastText = text;
      lastAtMs = Date.now();
    } catch (error) {
      // A failed edit usually means the message is past WhatsApp's edit window or
      // the account cannot edit; stop trying rather than retrying every stage.
      editable = false;
      console.error(`Status edit disabled for ${chatId}:`, error.message);
    }
  }

  return {
    start,
    update,
    get messageId() {
      return messageId;
    },
    get lastText() {
      return lastText;
    },
  };
}

module.exports = { createProgressReporter };
