const { spawnSync } = require('child_process');

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-nostats'].concat(args), {
    encoding: 'utf8',
  });

  return {
    ok: result.status === 0,
    output: String(result.stdout || '') + String(result.stderr || ''),
  };
}

function measureRms(filePath, startSeconds, durationSeconds, bandFilter) {
  const audioFilters = bandFilter ? [bandFilter, 'astats'] : ['astats'];
  const { output } = runFfmpeg([
    '-ss', String(startSeconds),
    '-t', String(durationSeconds),
    '-i', filePath,
    '-map', '0:a:0',
    '-af', audioFilters.join(','),
    '-f', 'null', '-',
  ]);

  const matches = output.match(/RMS level dB:\s*(-?[\d.]+|-?inf)/g) || [];
  const last = matches[matches.length - 1];
  if (!last) {
    return NaN;
  }

  const value = parseFloat(last.replace(/[^-\d.]/g, ''));

  return Number.isFinite(value) ? value : -120;
}

// The quietest window stands in for a stretch of pure noise, which is where
// denoising can actually be measured. Picking a "speech" window automatically is
// not reliable - in a clip where a passing car is the loudest thing, the loudest
// window is noise too - so it is only used for the spectral tilt, which is a
// ratio between two bands of the same window and survives that ambiguity.
function findWindows(filePath, totalSeconds, windowSeconds = 2) {
  const sampleCount = Math.min(Math.floor(totalSeconds / windowSeconds), 60);

  if (sampleCount < 1) {
    return null;
  }

  let quietest = { start: 0, rms: Infinity };
  let loudest = { start: 0, rms: -Infinity };

  for (let index = 0; index < sampleCount; index += 1) {
    const start = index * windowSeconds;
    const rms = measureRms(filePath, start, windowSeconds);

    if (!Number.isFinite(rms)) {
      continue;
    }

    if (rms < quietest.rms) {
      quietest = { start, rms };
    }

    if (rms > loudest.rms) {
      loudest = { start, rms };
    }
  }

  if (!Number.isFinite(quietest.rms)) {
    return null;
  }

  return { ...quietest, windowSeconds, loudStart: loudest.start };
}

// A dull, "heavy" voice is a spectral tilt problem: denoising takes more off the
// 3-8 kHz band than off the bass. Comparing tilt against the untouched file
// turns that perception into a number.
function measureTilt(filePath, startSeconds, durationSeconds) {
  const high = measureRms(filePath, startSeconds, durationSeconds, 'highpass=f=3000,lowpass=f=8000');
  const low = measureRms(filePath, startSeconds, durationSeconds, 'lowpass=f=1000');

  return Number.isFinite(high) && Number.isFinite(low) ? high - low : NaN;
}

// Comparing finished files from different sources rules out any absolute level:
// every engine and every web service normalizes loudness its own way, so a
// before/after RMS measures their makeup gain, not their denoising.
//
// The gap between a low and a high percentile of the same file's own window
// levels is immune to that by construction - both terms shift together under any
// gain change, so the difference cancels it out. A cleaner file has a quieter
// background under the same speech, which widens the gap.
// Below this many samples the 10th percentile lands on the minimum, so a single
// near-silent window decides the result and the percentile guard does nothing.
const minReliableSamples = 20;
// A window this quiet is not "clean background" - it is effectively digital
// silence, which is what an over-aggressive gate produces. AAC itself sits
// around -60 to -90 dB when fed silence, so the line goes just above that.
const nearSilenceDb = -60;

function measureDynamicRange(filePath, totalSeconds, windowSeconds = 1) {
  const sampleCount = Math.min(Math.floor(totalSeconds / windowSeconds), 120);

  if (sampleCount < 8) {
    return { range: NaN, samples: 0, reliable: false, nearSilent: false, floorDb: NaN };
  }

  const levels = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const rms = measureRms(filePath, index * windowSeconds, windowSeconds);

    if (Number.isFinite(rms)) {
      levels.push(rms);
    }
  }

  if (levels.length < 8) {
    return { range: NaN, samples: levels.length, reliable: false, nearSilent: false, floorDb: NaN };
  }

  levels.sort((left, right) => left - right);

  const percentile = (fraction) =>
    levels[Math.min(levels.length - 1, Math.floor(fraction * (levels.length - 1)))];

  const floorDb = percentile(0.1);

  return {
    range: percentile(0.9) - floorDb,
    samples: levels.length,
    reliable: levels.length >= minReliableSamples,
    nearSilent: floorDb <= nearSilenceDb,
    floorDb,
  };
}

module.exports = {
  findWindows,
  measureDynamicRange,
  measureRms,
  measureTilt,
  runFfmpeg,
};
