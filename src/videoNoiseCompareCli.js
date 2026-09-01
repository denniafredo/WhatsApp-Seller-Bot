require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { probeMedia } = require('./videoNoiseReduction');
const { findWindows, measureDynamicRange, measureTilt } = require('./audioMetrics');

function usage() {
  console.error('Cara pakai:');
  console.error('  npm run banding:noise -- asli.mp4 hasil-a.mp4 [hasil-b.mp4 ...]');
  console.error('');
  console.error('Argumen pertama adalah file ASLI yang belum diproses.');
  console.error('Sisanya file hasil dari engine atau layanan mana pun, termasuk');
  console.error('hasil unduhan dari layanan web yang kamu proses manual.');
}

async function describe(filePath) {
  const media = await probeMedia(filePath);

  return {
    filePath,
    name: path.basename(filePath),
    durationSeconds: media.durationSeconds,
    channels: media.audioChannels,
    bytes: fs.statSync(filePath).size,
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    usage();
    process.exitCode = 1;
    return;
  }

  const missing = args.filter((candidate) => !fs.existsSync(candidate));
  if (missing.length) {
    console.error(`File tidak ditemukan: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const originalPath = path.resolve(args[0]);
  const original = await describe(originalPath);
  const windows = findWindows(originalPath, original.durationSeconds);

  if (!windows) {
    console.error('File asli terlalu pendek untuk diukur (butuh minimal 2 detik).');
    process.exitCode = 1;
    return;
  }

  const baseTilt = measureTilt(originalPath, windows.loudStart, windows.windowSeconds);
  const baseMetrics = measureDynamicRange(originalPath, original.durationSeconds);
  const baseRange = baseMetrics.range;

  if (!Number.isFinite(baseRange)) {
    console.error('File asli terlalu pendek untuk diukur (butuh minimal 8 detik).');
    process.exitCode = 1;
    return;
  }

  console.log(`asli        : ${original.name}`);
  console.log(`durasi      : ${original.durationSeconds.toFixed(2)} s, ${original.channels} channel`);
  console.log(`jarak dinamis asli: ${baseRange.toFixed(1)} dB (dari ${baseMetrics.samples} jendela)`);
  console.log(`region keras      : ${windows.loudStart}-${windows.loudStart + windows.windowSeconds} s (untuk kecerahan)`);

  if (!baseMetrics.reliable) {
    console.log('');
    console.log(`PERINGATAN: cuma ${baseMetrics.samples} jendela 1 detik. Di bawah 20 jendela,`);
    console.log('persentil ke-10 jatuh ke nilai minimum, jadi satu jendela nyaris senyap');
    console.log('bisa mengarang angka "noise turun" yang besar. Pakai klip >= 20 detik');
    console.log('untuk angka yang bisa dipegang, dan sementara ini percayai kolom');
    console.log('"jadi berat" saja - kolom itu tidak terpengaruh jumlah jendela.');
  }

  console.log('');

  const rows = [];
  const warnings = [];

  for (const candidate of args.slice(1)) {
    const info = await describe(path.resolve(candidate));
    const driftSeconds = Math.abs(info.durationSeconds - original.durationSeconds);

    // A service that trims or pads the audio shifts every timestamp, which would
    // make a window-based comparison measure the wrong moment entirely.
    if (driftSeconds > 0.5) {
      warnings.push(
        `${info.name}: durasi beda ${driftSeconds.toFixed(2)} s dari asli, ` +
        'angka di bawah kemungkinan mengukur momen yang bergeser'
      );
    }

    const metrics = measureDynamicRange(info.filePath, info.durationSeconds);
    const tilt = measureTilt(info.filePath, windows.loudStart, windows.windowSeconds);

    if (metrics.nearSilent) {
      warnings.push(
        `${info.name}: lantai noise ${metrics.floorDb.toFixed(0)} dB, praktis senyap total. ` +
        'Angka "noise turun"-nya bukan bukti bersih, kemungkinan audio ikut di-gate'
      );
    }

    rows.push({
      name: info.name,
      noiseDrop: Number.isFinite(metrics.range) ? metrics.range - baseRange : NaN,
      floorDb: metrics.floorDb,
      tiltShift: Number.isFinite(tilt) && Number.isFinite(baseTilt) ? tilt - baseTilt : NaN,
      bytes: info.bytes,
      driftSeconds,
    });
  }

  rows.sort((left, right) => (right.noiseDrop || 0) - (left.noiseDrop || 0));

  const nameWidth = Math.max(24, ...rows.map((row) => row.name.length + 2));

  console.log('file'.padEnd(nameWidth) + 'noise turun'.padStart(13) + 'jadi berat'.padStart(12) + 'lantai'.padStart(11) + 'ukuran'.padStart(11));
  console.log('-'.repeat(nameWidth + 47));

  for (const row of rows) {
    const noiseText = Number.isFinite(row.noiseDrop) ? `${row.noiseDrop.toFixed(1)} dB` : 'n/a';
    const tiltText = Number.isFinite(row.tiltShift)
      ? `${row.tiltShift > 0 ? '+' : ''}${row.tiltShift.toFixed(1)} dB`
      : 'n/a';

    const floorText = Number.isFinite(row.floorDb) ? `${row.floorDb.toFixed(0)} dB` : 'n/a';

    console.log(
      row.name.padEnd(nameWidth) +
      noiseText.padStart(13) +
      tiltText.padStart(12) +
      floorText.padStart(11) +
      `${(row.bytes / 1048576).toFixed(2)} MB`.padStart(11)
    );
  }

  if (warnings.length) {
    console.log('');
    console.log('PERINGATAN KESELARASAN:');
    for (const warning of warnings) {
      console.log('  - ' + warning);
    }
  }

  console.log('');
  console.log('noise turun = pelebaran jarak dinamis vs file asli, yaitu seberapa jauh');
  console.log('              latar belakang turun di bawah suara. Makin besar makin bersih.');
  console.log('              Imun terhadap normalisasi loudness, jadi hasil dari layanan');
  console.log('              mana pun bisa dibandingkan adil.');
  console.log('jadi berat  = pergeseran kemiringan spektrum di region keras.');
  console.log('              NEGATIF = suara jadi tumpul. Nol/positif = kecerahan terjaga.');
  console.log('lantai      = level bagian paling sepi. Di bawah -70 dB itu senyap digital,');
  console.log('              tanda audio di-gate, bukan dibersihkan.');
  console.log('');
  console.log('Kedua angka diukur pada file jadi, termasuk normalisasi loudness apa pun');
  console.log('yang sudah dilakukan masing-masing engine atau layanan. Artefak berdenging');
  console.log('dan suara hampa tidak muncul di angka mana pun - tetap dengarkan filenya.');
  console.log('');
  console.log('JANGAN dibandingkan dengan angka dari "npm run uji:noise": yang itu diukur');
  console.log('sebelum loudnorm untuk menyetel engine, yang ini diukur pada file jadi untuk');
  console.log('membandingkan hasil akhir. Dua pertanyaan berbeda, skalanya beda.');
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exitCode = 1;
});
