// Orkestrasi fitur "cek kilo": baca foto -> tarik transaksi Bilas -> cocokkan ->
// balas satu tabel. Meniru pola videoNoiseHandler (queue + progress reporter).

const { getKiloCommand, isSupportedImage } = require('./kiloTrigger');
const { readKiloPhoto } = require('./kiloPhotoReader');
const { compareKilo } = require('./kiloCompare');
const { BilasError } = require('./bilasClient');
const { createProgressReporter } = require('./progressReporter');

const maxInputMb = Math.min(Math.max(Number(process.env.KILO_MAX_MB) || 12, 1), 32);
const maxInputBytes = Math.round(maxInputMb * 1024 * 1024);

function formatMb(bytes) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(1);
}

// Angka kg ringkas: buang nol di belakang, koma sebagai desimal (gaya Indonesia).
function fmtKg(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return String(Number(Number(value).toFixed(2))).replace('.', ',');
}

function describeFailure(error) {
  switch (error && error.code) {
    case 'NO_CREDENTIALS':
      return String(error.message).includes('AWS')
        ? 'Kredensial AI (AWS Bedrock) belum diatur di server. Hubungi admin.'
        : 'Akun Bilas belum diatur di server. Hubungi admin.';
    case 'NO_MODEL':
      return 'Model AI belum dikonfigurasi (BEDROCK_MODEL_ID). Hubungi admin.';
    case 'LOGIN_FAILED':
      return 'Login ke Bilas gagal. Cek kembali BILAS_USERNAME/BILAS_PASSWORD.';
    case 'NETWORK':
      return 'Server Bilas tidak bisa dihubungi. Coba lagi sebentar lagi.';
    case 'REPORT_FAILED':
      return `Gagal menarik transaksi Bilas: ${error.message}`;
    case 'VISION_FAILED':
      return 'Gagal membaca foto lewat AI. Coba kirim ulang foto yang lebih jelas.';
    case 'NO_JSON':
    case 'BAD_JSON':
      return 'AI tidak bisa membaca daftar dari foto ini. Pastikan foto berisi daftar nama & kilo yang jelas.';
    case 'NO_OUTLET':
      return error.message;
    case 'QUEUE_FULL':
      return 'Sedang banyak antrean. Coba lagi sebentar lagi ya.';
    default:
      return `Gagal memproses: ${(error && error.message) || 'error tidak diketahui'}`;
  }
}

const STATE_ICON = {
  match: '✅',      // white check
  kilo_diff: '❌',  // cross
  not_in_bilas: '❌',
  uncertain: '⚠️', // warning
};

function buildReply({ outletName, rangeLabel, photoCount, bilasCount, comparison }) {
  const { rows, tolerance, counts } = comparison;
  const lines = [];

  lines.push(`*Cek kilo — ${outletName}*`);
  lines.push(rangeLabel);
  lines.push(`Foto: ${photoCount} baris • Bilas: ${bilasCount} transaksi • toleransi ±${fmtKg(tolerance)} kg`);
  lines.push('');

  lines.push('*Nama | Foto | Bilas | Ket | ✓ | Nota*');
  if (!rows.length) {
    lines.push('_(tidak ada baris terbaca dari foto)_');
  }
  rows.forEach((r, i) => {
    const icon = STATE_ICON[r.state] || '';
    const ket = r.keterangan || '-';
    const nota = r.noNota || '-';
    lines.push(
      `${i + 1}. ${r.nama} | ${fmtKg(r.photoKilo)} | ${fmtKg(r.bilasKilo)} | ${ket} | ${icon} | ${nota}`
    );
  });

  lines.push('');
  lines.push(
    `Cocok ${counts.match}, beda kilo ${counts.kiloDiff}, ` +
    `tak ada di Bilas ${counts.notInBilas}, ragu baca ${counts.uncertain}.`
  );

  return lines.join('\n');
}

async function runKiloJob(client, message, mediaMessage, command, deps, reporter) {
  const { bilas } = deps;

  await reporter.update('Login ke Bilas...');
  await bilas.ensureSession();

  const outlet = bilas.resolveOutlet(command.outletAlias);
  if (!outlet) {
    const daftar = bilas.listOutlets().join(', ') || '(tidak ada)';
    throw new BilasError(
      'NO_OUTLET',
      command.outletAlias
        ? `Cabang "${command.outletAlias}" tidak ditemukan. Cabang tersedia: ${daftar}.`
        : `Cabang belum dipilih dan default tidak ada. Tambahkan cabang:<nama>. Tersedia: ${daftar}.`
    );
  }

  await reporter.update('Membaca fotomu...');
  const buffer = await client.decryptFile(mediaMessage);
  const mediaType = mediaMessage.mimetype || 'image/jpeg';
  const photoRows = await readKiloPhoto({
    imageBase64: buffer.toString('base64'),
    mediaType,
  });

  await reporter.update(`Menarik transaksi ${outlet.nama}...`);
  const bilasRows = await bilas.getTransactions({
    outletId: outlet.id,
    startDate: command.startDate,
    endDate: command.endDate,
  });

  const comparison = compareKilo(photoRows, bilasRows);
  const reply = buildReply({
    outletName: outlet.nama,
    rangeLabel: command.rangeLabel,
    photoCount: photoRows.length,
    bilasCount: bilasRows.length,
    comparison,
  });

  await client.sendText(message.from, reply);
  return { photoCount: photoRows.length, bilasCount: bilasRows.length, counts: comparison.counts };
}

async function handleKiloCommand(client, message, { queue, getBotIds, bilas, isGroup, timeZone }) {
  const botIds = isGroup ? await getBotIds() : [];
  const command = getKiloCommand(message, botIds, { isGroup, timeZone });

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

  // Perintah cek kilo tanpa foto: beri tahu sekali, jangan diam.
  if (!mediaMessage || !isSupportedImage(mediaMessage)) {
    await client.sendText(
      message.from,
      'Kirim *foto* catatan (nama & kilo) dengan caption "cek kilo", atau reply foto lalu tulis "cek kilo".'
    );
    return true;
  }

  if (mediaMessage.isViewOnce) {
    await client.sendText(message.from, 'Foto sekali-lihat tidak diproses. Kirim sebagai foto biasa ya.');
    return true;
  }

  const sizeBytes = Number(mediaMessage.size) || 0;
  if (sizeBytes > maxInputBytes) {
    await client.sendText(message.from, `Fotonya ${formatMb(sizeBytes)} MB, batas maksimal ${maxInputMb} MB.`);
    return true;
  }

  if (queue.isFull) {
    await client.sendText(message.from, describeFailure({ code: 'QUEUE_FULL' }));
    return true;
  }

  console.log(
    `Cek kilo dari ${message.from}: cabang="${command.outletAlias || '(default)'}" ${command.startDate}..${command.endDate}`
  );

  const aheadInQueue = queue.pending + queue.active;
  const reporter = createProgressReporter(client, message.from);
  const jobOutcome = queue
    .push(() => runKiloJob(client, message, mediaMessage, command, { bilas }, reporter))
    .then((result) => ({ result }), (error) => ({ error }));

  await reporter.start(
    aheadInQueue > 0
      ? `Cek kilo masuk antrean (${aheadInQueue} di depan), tunggu ya...`
      : 'Cek kilo diproses, tunggu ya...'
  );

  const { result, error } = await jobOutcome;

  if (error) {
    console.error(`Cek kilo gagal untuk ${message.from}:`, error);
    await client.sendText(message.from, describeFailure(error)).catch(() => {});
    return true;
  }

  console.log(
    `Cek kilo selesai untuk ${message.from}: foto ${result.photoCount}, bilas ${result.bilasCount}, cocok ${result.counts.match}.`
  );
  return true;
}

module.exports = { handleKiloCommand, buildReply, describeFailure, maxInputMb };
