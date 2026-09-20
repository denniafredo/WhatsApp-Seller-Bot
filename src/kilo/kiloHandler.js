// Orkestrasi fitur "cek kilo": baca foto -> tarik transaksi Bilas -> cocokkan ->
// balas satu tabel. Meniru pola videoNoiseHandler (queue + progress reporter).

const { getKiloCommand, isSupportedImage } = require('./kiloTrigger');
const { readKiloPhoto } = require('./kiloPhotoReader');
const { compareKilo } = require('./kiloCompare');
const { writeKiloSummary } = require('./kiloSheet');
const { BilasError } = require('./bilasClient');
const { createProgressReporter } = require('../shared/progressReporter');

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

// Waktu pengecekan, ditulis di baris info sheet supaya jelas hasil ini kapan dibuat.
function formatCheckedAt(timeZone) {
  return new Date().toLocaleString('id-ID', {
    timeZone: timeZone || 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
  match: '✅',        // sama persis
  match_toleransi: '✅', // masih dalam toleransi, tapi selisihnya tetap ditulis
  kilo_diff: '❌',    // beda kilo
  not_in_bilas: '❌', // tidak ketemu di Bilas
  no_kilo: 'ℹ️',  // baris satuan, foto tidak menulis kg
  uncertain: '⚠️', // ragu baca
};

// Selisih kilo foto vs aplikasi, mis. "+0,5" / "-1,2". Inilah tanda "mana yang
// beda" yang diminta: bukan cuma silang, tapi berapa jauh melesetnya.
function fmtSelisih(value) {
  if (value == null || Number.isNaN(Number(value)) || Number(value) === 0) return '';
  const sign = Number(value) > 0 ? '+' : '-';
  return ` ${sign}${fmtKg(Math.abs(Number(value)))}`;
}

// Nama yang ditampilkan: pakai ejaan aplikasi, tapi tetap tunjukkan bacaan foto
// bila berbeda supaya karyawan tahu tulisannya yang perlu diperbaiki.
function fmtNama(row) {
  const parts = [row.nama];
  if (row.nameFixed && row.namaFoto && row.namaFoto !== row.nama) {
    parts.push(`(foto: ${row.namaFoto})`);
  }
  if (row.weakName) {
    parts.push('❓'); // cocok lewat kilo, nama jauh beda: cek manual
  }
  return parts.join(' ');
}

function buildReply({ outletName, rangeLabel, photoCount, bilasCount, comparison, sheet, sheetError }) {
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
    // Kilo dari aplikasi ditebalkan: itu angka acuan yang dipercaya.
    const bilasKg = r.bilasKilo == null ? '-' : `*${fmtKg(r.bilasKilo)}*`;
    // Selisih ditulis untuk SEMUA baris yang angkanya tidak sama persis,
    // termasuk yang masih dalam toleransi: hitungan mengikuti angka aplikasi.
    const tanda = r.state === 'kilo_diff' || r.state === 'match_toleransi'
      ? `${icon}${fmtSelisih(r.selisih)}`
      : icon;
    lines.push(
      `${i + 1}. ${fmtNama(r)} | ${fmtKg(r.photoKilo)} | ${bilasKg} | ${ket} | ${tanda} | ${nota}`
    );
  });

  lines.push('');
  const ringkas = [
    `Sama persis ${counts.match}`,
    `beda tipis (msh toleransi) ${counts.matchToleransi}`,
    `beda kilo ${counts.kiloDiff}`,
  ];
  if (counts.noKilo) ringkas.push(`satuan/tanpa kg ${counts.noKilo}`);
  ringkas.push(`tak ada di Bilas ${counts.notInBilas}`);
  ringkas.push(`ragu baca ${counts.uncertain}`);
  lines.push(`${ringkas.join(', ')}.`);

  if (counts.nameFixed) {
    lines.push(`_${counts.nameFixed} nama dibetulkan dari ejaan aplikasi._`);
  }
  if (counts.weakName) {
    lines.push('_❓ = cocok lewat kilo, nama beda jauh — mohon dicek manual._');
  }

  if (sheet) {
    lines.push('');
    lines.push(`📄 Tabel lengkap (nota bisa diklik ke Bilas):`);
    lines.push(sheet.url);
  } else if (sheetError) {
    lines.push('');
    lines.push(`_Gagal menulis ke Google Sheet: ${sheetError.message}_`);
  }

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

  // Transaksi ditarik DULU: daftar nama pelanggannya dipakai sebagai acuan ejaan
  // saat membaca foto, jadi tulisan tangan yang ambigu punya kandidat nyata
  // ketimbang ditebak bebas oleh AI.
  await reporter.update(`Menarik transaksi ${outlet.nama}...`);
  const bilasRows = await bilas.getTransactions({
    outletId: outlet.id,
    startDate: command.startDate,
    endDate: command.endDate,
  });

  await reporter.update('Membaca fotomu...');
  const buffer = await client.decryptFile(mediaMessage);
  const mediaType = mediaMessage.mimetype || 'image/jpeg';
  const photoRows = await readKiloPhoto({
    imageBase64: buffer.toString('base64'),
    mediaType,
    knownNames: bilasRows.map((row) => row.nama),
  });

  const comparison = compareKilo(photoRows, bilasRows);
  const sheetContext = {
    outletName: outlet.nama,
    rangeLabel: command.rangeLabel,
    photoCount: photoRows.length,
    bilasCount: bilasRows.length,
    comparison,
  };

  // Sheet gagal tidak boleh menelan hasilnya: balasan teks tetap dikirim,
  // linknya saja yang diganti keterangan errornya.
  await reporter.update('Menulis ke Google Sheet...');
  let sheet = null;
  let sheetError = null;
  try {
    sheet = await writeKiloSummary({ ...sheetContext, checkedAt: formatCheckedAt(deps.timeZone) });
  } catch (error) {
    sheetError = error;
    console.error('Gagal menulis Summary Kiloan:', error);
  }

  await client.sendText(message.from, buildReply({ ...sheetContext, sheet, sheetError }));
  return {
    photoCount: photoRows.length,
    bilasCount: bilasRows.length,
    counts: comparison.counts,
    sheetUrl: sheet?.url || null,
  };
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
    .push(() => runKiloJob(client, message, mediaMessage, command, { bilas, timeZone }, reporter))
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
