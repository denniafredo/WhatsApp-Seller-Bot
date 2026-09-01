const fs = require('fs');
const os = require('os');
const path = require('path');

const { NoiseReductionError, reduceNoise } = require('./videoNoiseReduction');
const { getNoiseCommand, hasMentions, isSupportedMedia } = require('./videoNoiseTrigger');
const { createProgressReporter } = require('./progressReporter');

function readMegabytes(rawValue, fallback) {
  const value = Number(rawValue);

  return Math.min(Math.max(Number.isFinite(value) ? value : fallback, 1), 64);
}

const maxInputMb = readMegabytes(process.env.VIDEO_MAX_MB, 16);
const maxOutputMb = readMegabytes(process.env.VIDEO_MAX_OUTPUT_MB, maxInputMb);
const maxInputBytes = Math.round(maxInputMb * 1024 * 1024);
const maxOutputBytes = Math.round(maxOutputMb * 1024 * 1024);

function formatMegabytes(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(1);
}

function getMessageIdString(message) {
  const id = message?.id?._serialized || message?.id?.id || message?.id;

  return id && typeof id !== 'object' ? String(id) : undefined;
}

function describeFailure(error) {
  switch (error?.code) {
    case 'NO_AUDIO':
      return 'Video ini tidak punya track suara, jadi tidak ada noise yang bisa dikurangi.';
    case 'MODEL_MISSING':
      return 'Model AI untuk noise reduction belum ada di folder assets. Tolong hubungi admin.';
    case 'UNKNOWN_ENGINE':
      return 'Konfigurasi engine noise reduction salah. Tolong hubungi admin.';
    case 'SPAWN_FAILED':
      return 'ffmpeg tidak bisa dijalankan di server. Tolong hubungi admin.';
    case 'DEEPFILTER_MISSING':
      return 'Engine DeepFilterNet belum terpasang di server. Tolong hubungi admin.';
    case 'DEEPFILTER_FAILED':
      return 'Engine DeepFilterNet gagal memproses audionya. Tolong hubungi admin.';
    case 'VOICECLEANER_NO_CREDENTIALS':
      return 'Akun voicecleaner belum diatur di server. Tolong hubungi admin.';
    case 'VOICECLEANER_LOGIN_FAILED':
      return 'Login ke voicecleaner gagal. Tolong hubungi admin.';
    case 'VOICECLEANER_NO_CREDITS':
      return 'Kuota harian voicecleaner sudah habis. Coba lagi besok.';
    case 'VOICECLEANER_TIMEOUT':
      return 'voicecleaner tidak memberi hasil sampai batas waktu. Coba lagi nanti.';
    case 'VOICECLEANER_FAILED':
      return 'voicecleaner gagal memproses audionya. Tolong hubungi admin.';
    case 'PROBE_FAILED':
      return 'Videonya tidak bisa dibaca, mungkin belum selesai terunduh. Coba kirim ulang.';
    case 'TIMEOUT':
      return 'Videonya terlalu panjang jadi prosesnya dihentikan. Coba potong dulu lalu kirim lagi.';
    case 'OUTPUT_TOO_BIG':
      return error.message;
    case 'QUEUE_FULL':
      return 'Antrean video sedang penuh. Coba lagi sebentar lagi ya.';
    default:
      return `Gagal memproses video: ${error?.message || 'error tidak diketahui'}`;
  }
}

async function runNoiseJob(client, message, mediaMessage, engine, reporter) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wa-noise-'));
  const inputPath = path.join(workDir, 'input.mp4');
  const outputPath = path.join(workDir, 'output.mp4');

  try {
    await reporter.update('Mengunduh videomu...');
    const buffer = await client.decryptFile(mediaMessage);
    await fs.promises.writeFile(inputPath, buffer);

    // engine is undefined when the trigger word does not pin one, which lets
    // reduceNoise fall back to VIDEO_DENOISE_ENGINE.
    const result = await reduceNoise({
      inputPath,
      outputPath,
      ...(engine ? { engine } : {}),
      onProgress: (text) => reporter.update(text),
    });
    const outputBytes = (await fs.promises.stat(outputPath)).size;

    if (outputBytes > maxOutputBytes) {
      throw new NoiseReductionError(
        'OUTPUT_TOO_BIG',
        `Hasilnya ${formatMegabytes(outputBytes)} MB, melewati batas kirim ${maxOutputMb} MB.`
      );
    }

    await reporter.update('Selesai, mengirim videonya...');
    await client.sendFile(message.from, outputPath, {
      type: 'video',
      mimetype: 'video/mp4',
      filename: `noise-reduction-${Date.now()}.mp4`,
      caption: `Noise sudah dikurangi (${result.engine}, ${Math.round(result.durationSeconds)}s, proses ${(result.elapsedMs / 1000).toFixed(1)}s).`,
      quotedMsg: getMessageIdString(message),
    });

    return { ...result, outputBytes };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch((error) => {
      console.error(`Failed to clean up ${workDir}:`, error);
    });
  }
}

async function handleNoiseCommand(client, message, { queue, getBotIds }) {
  const botIds = hasMentions(message) ? await getBotIds() : [];
  const command = getNoiseCommand(message, botIds);

  if (!command) {
    return false;
  }

  let mediaMessage = message;

  if (command.source === 'quoted') {
    mediaMessage = await client.getMessageById(command.quotedMsgId).catch((error) => {
      console.error(`Failed to load quoted message ${command.quotedMsgId}:`, error);
      return null;
    });
  }

  // Staying silent keeps ordinary conversation that happens to contain a trigger
  // word from being hijacked by this feature.
  if (!mediaMessage || !isSupportedMedia(mediaMessage)) {
    return false;
  }

  if (mediaMessage.isViewOnce) {
    await client.sendText(
      message.from,
      'Video sekali-lihat tidak diproses supaya isinya tidak ikut tersimpan.'
    );
    return true;
  }

  const sizeBytes = Number(mediaMessage.size) || 0;
  if (sizeBytes > maxInputBytes) {
    await client.sendText(
      message.from,
      `Videonya ${formatMegabytes(sizeBytes)} MB, batas maksimalnya ${maxInputMb} MB.`
    );
    return true;
  }

  if (queue.isFull) {
    await client.sendText(message.from, describeFailure({ code: 'QUEUE_FULL' }));
    return true;
  }

  // Queueing before the acknowledgement is awaited keeps the reported position
  // accurate: concurrent listeners would otherwise all read an empty queue.
  const aheadInQueue = queue.pending + queue.active;
  const reporter = createProgressReporter(client, message.from);
  const jobOutcome = queue
    .push(() => runNoiseJob(client, message, mediaMessage, command.engine, reporter))
    .then((result) => ({ result }), (error) => ({ error }));

  await reporter.start(
    aheadInQueue > 0
      ? `Videonya masuk antrean (${aheadInQueue} di depan), tunggu ya...`
      : 'Videonya sedang diproses, tunggu ya...'
  );

  const { result, error } = await jobOutcome;

  if (error) {
    console.error(`Noise reduction failed for ${message.from}:`, error);
    await client.sendText(message.from, describeFailure(error)).catch(() => { });
    return true;
  }

  console.log(
    `Noise reduction sent to ${message.from} (${result.engine}, ${result.audioBitRateKbps}k, ${result.elapsedMs} ms).`
  );

  return true;
}

module.exports = {
  describeFailure,
  handleNoiseCommand,
  maxInputMb,
  maxOutputMb,
};
