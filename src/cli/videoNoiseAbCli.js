require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { probeMedia, reduceNoiseWithDeepFilter } = require('../video/videoNoiseReduction');
const { findWindows, measureRms, measureTilt, runFfmpeg } = require('../video/audioMetrics');

const modelDir = path.join(__dirname, '..', '..', 'assets');

function toFilterModel(fileName) {
  return path
    .relative(process.cwd(), path.join(modelDir, fileName))
    .replace(/\\/g, '/');
}

function buildVariants() {
  const sh = toFilterModel('sh.rnnn');

  return [
    ['1-arnndn', { filter: `arnndn=m=${sh}:mix=1` }],
    ['2-arnndn-treble3', { filter: `arnndn=m=${sh}:mix=1,treble=g=3:f=3000` }],
    ['3-arnndn-polish', { filter: `arnndn=m=${sh}:mix=1,afftdn=nr=12:nf=-25` }],
    ['4-dfn-pf-002', { dfn: { attenDb: 100, postFilter: true, postFilterBeta: 0.02 } }],
    ['5-dfn-pf-010', { dfn: { attenDb: 100, postFilter: true, postFilterBeta: 0.10 } }],
    ['6-dfn-pf-020', { dfn: { attenDb: 100, postFilter: true, postFilterBeta: 0.20 } }],
  ];
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || path.join('data', 'uji.mp4'));

  if (!fs.existsSync(inputPath)) {
    console.error(`File tidak ditemukan: ${inputPath}`);
    console.error('');
    console.error('Cara pakai:');
    console.error('  npm run uji:noise                 (baca data/uji.mp4)');
    console.error('  npm run uji:noise -- path/ke/video.mp4');
    process.exitCode = 1;
    return;
  }

  const media = await probeMedia(inputPath);

  console.log(`input       : ${inputPath}`);
  console.log(`ukuran      : ${(fs.statSync(inputPath).size / 1048576).toFixed(2)} MB`);
  console.log(`durasi      : ${media.durationSeconds.toFixed(1)} s`);
  console.log(`audio       : ${media.audioChannels} channel, ${Math.round(media.audioBitRate / 1000)} kbps`);
  console.log(`video       : ${media.hasVideo ? 'ada (akan di-copy, tidak di-encode ulang)' : 'tidak ada'}`);

  if (!media.hasAudio) {
    console.error('File ini tidak punya track audio, tidak ada yang bisa diuji.');
    process.exitCode = 1;
    return;
  }

  const quiet = findWindows(inputPath, media.durationSeconds, 2);

  const baseTilt = quiet ? measureTilt(inputPath, quiet.loudStart, quiet.windowSeconds) : NaN;

  if (quiet) {
    console.log(`region sepi : ${quiet.start}-${quiet.start + 2} s (RMS ${quiet.rms.toFixed(1)} dB), untuk ukur noise`);
    console.log(`region keras: ${quiet.loudStart}-${quiet.loudStart + 2} s, untuk ukur kecerahan suara`);
  } else {
    console.log('region ukur : video terlalu pendek, angka noise dilewati');
  }

  const outputDir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const rows = [];

  console.log('');
  console.log('memproses...');

  for (const [label, spec] of buildVariants()) {
    const outputPath = path.join(outputDir, `${baseName}-${label}.mp4`);
    const startedAtMs = Date.now();

    if (spec.dfn) {
      try {
        await reduceNoiseWithDeepFilter({
          inputPath,
          outputPath,
          media,
          attenDb: spec.dfn.attenDb,
          postFilter: Boolean(spec.dfn.postFilter),
          postFilterBeta: spec.dfn.postFilterBeta,
        });
      } catch (error) {
        console.log(`  LEWAT ${label}: ${error.message}`);
        continue;
      }
    } else {
      const args = ['-y', '-i', inputPath];

      if (media.hasVideo) {
        args.push('-map', '0:v:0', '-c:v', 'copy');
      }

      args.push(
        '-map', '0:a:0',
        '-af', `aresample=48000,${spec.filter},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000`,
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
        outputPath
      );

      const { ok, output } = runFfmpeg(args);

      if (!ok) {
        console.log(`  GAGAL ${label}: ${output.trim().split(/\r?\n/).pop()}`);
        continue;
      }
    }

    const elapsedMs = Date.now() - startedAtMs;
    let noiseFloor = NaN;
    let tilt = NaN;

    // Measured on a second render that skips loudnorm, because its makeup gain
    // would otherwise hide how much noise was really removed. Every engine gets
    // the identical treatment so the rows stay comparable — which is why the
    // DeepFilterNet rows run their (slower) pipeline twice.
    if (quiet) {
      const measurePath = path.join(outputDir, `${baseName}-${label}-ukur.mp4`);
      let measured = false;

      if (spec.dfn) {
        try {
          await reduceNoiseWithDeepFilter({
            inputPath,
            outputPath: measurePath,
            media,
            attenDb: spec.dfn.attenDb,
            postFilter: Boolean(spec.dfn.postFilter),
            postFilterBeta: spec.dfn.postFilterBeta,
            applyPostFilters: false,
          });
          measured = true;
        } catch (error) {
          measured = false;
        }
      } else {
        const args = ['-y', '-i', inputPath];

        if (media.hasVideo) {
          args.push('-map', '0:v:0', '-c:v', 'copy');
        }

        args.push(
          '-map', '0:a:0',
          '-af', `aresample=48000,${spec.filter}`,
          '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
          measurePath
        );

        measured = runFfmpeg(args).ok;
      }

      if (measured) {
        noiseFloor = measureRms(measurePath, quiet.start, quiet.windowSeconds);
        tilt = measureTilt(measurePath, quiet.loudStart, quiet.windowSeconds);
      }

      fs.rmSync(measurePath, { force: true });
    }

    rows.push({
      label,
      elapsedMs,
      bytes: fs.statSync(outputPath).size,
      noiseFloor,
      improvement: Number.isFinite(noiseFloor) ? quiet.rms - noiseFloor : NaN,
      tiltShift: Number.isFinite(tilt) && Number.isFinite(baseTilt) ? tilt - baseTilt : NaN,
      outputPath,
    });

    console.log(`  selesai ${label}`);
  }

  rows.sort((left, right) => (right.improvement || 0) - (left.improvement || 0));

  console.log('');
  console.log('varian'.padEnd(20) + 'noise turun'.padStart(13) + 'jadi berat'.padStart(12) + 'ukuran'.padStart(10));
  console.log('-'.repeat(55));

  for (const row of rows) {
    const improvementText = Number.isFinite(row.improvement)
      ? `${row.improvement.toFixed(1)} dB`
      : 'n/a';
    const tiltText = Number.isFinite(row.tiltShift)
      ? `${row.tiltShift > 0 ? '+' : ''}${row.tiltShift.toFixed(1)} dB`
      : 'n/a';

    console.log(
      row.label.padEnd(20) +
      improvementText.padStart(13) +
      tiltText.padStart(12) +
      `${(row.bytes / 1048576).toFixed(2)} MB`.padStart(10)
    );
  }

  console.log('');
  console.log('noise turun = penurunan lantai noise di region paling sepi, diukur');
  console.log('              sebelum loudnorm supaya semua engine sebanding.');
  console.log('jadi berat  = pergeseran kemiringan spektrum. NEGATIF = suara jadi');
  console.log('              tumpul/berat. Nol atau positif = kecerahan terjaga.');
  console.log('');
  console.log('BATAS ANGKA INI — baca sebelum memutuskan:');
  console.log('  - Hanya mengukur bagian TANPA suara orang. Noise yang menimpa suara');
  console.log('    tidak terukur di sini, padahal itu yang paling mengganggu.');
  console.log('  - Turun sangat besar (di atas ~40 dB) biasanya berarti audio di-gate');
  console.log('    sampai senyap, bukan bersih.');
  console.log('  - Artefak berdenging atau suara hampa tidak muncul sebagai angka.');
  console.log('  Jadi angka ini untuk menyortir, telingamu yang memutuskan.');
  console.log('');
  console.log(`File hasil ada di ${outputDir}:`);
  for (const row of rows) {
    console.log(`  ${path.basename(row.outputPath)}`);
  }
}

main().catch((error) => {
  console.error(`Gagal: ${error.message}`);
  process.exitCode = 1;
});
