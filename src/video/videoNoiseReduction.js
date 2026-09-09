const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || deriveFfprobePath(ffmpegPath);
const defaultEngine = String(process.env.VIDEO_DENOISE_ENGINE || 'arnndn').toLowerCase();
const defaultModelPath =
  process.env.VIDEO_DENOISE_MODEL || path.join(__dirname, '..', '..', 'assets', 'sh.rnnn');
// mix caps how much can ever be removed: the untouched share of the signal is
// kept verbatim, so mix=0.85 leaves 20*log10(0.15) = -16.5 dB of noise standing
// no matter how good the model is. Measured on a synthetic drive-by: mix=0.85
// removed 16.1 dB where mix=1 removed 39.9 dB, at identical speech loss.
const defaultMix = readNumber(process.env.VIDEO_DENOISE_MIX, 1, 0, 1);
const defaultNoiseReduction = readNumber(process.env.VIDEO_DENOISE_NR, 12, 0.01, 97);
const loudnormEnabled = process.env.VIDEO_DENOISE_LOUDNORM !== 'false';
// An afftdn pass after arnndn removes more noise (39.9 dB -> 51.9 dB) but dulls
// the voice by a measured 1.3 dB of spectral tilt, which is audible as a heavy,
// muffled sound. Off by default: listeners noticed the dullness more than the
// extra cleaning.
const polishEnabled = process.env.VIDEO_DENOISE_POLISH === 'true';
// arnndn leaves the result slightly darker than the source. A high shelf puts
// the brightness back; +3 dB measured +2.2 dB of tilt at no cleaning cost.
const trebleGainDb = readNumber(process.env.VIDEO_DENOISE_TREBLE, 0, 0, 12);
const defaultTimeoutMs = readNumber(process.env.VIDEO_JOB_TIMEOUT_MS, 300000, 5000, 3600000);
const maxAudioBitRateKbps = readNumber(process.env.VIDEO_DENOISE_AUDIO_KBPS, 128, 32, 320);
const minAudioBitRateKbps = 48;
const probeTimeoutMs = 30000;
const deepFilterPath = process.env.DEEPFILTER_PATH || defaultDeepFilterPath();
// deep-filter's own default is 100 dB, meaning no limit. Lowering it blends some
// of the noisy signal back in, which sounds more natural on heavy suppression.
const attenLimitDb = readNumber(process.env.VIDEO_DENOISE_ATTEN_DB, 100, 0, 100);
const deepFilterPostFilter = process.env.VIDEO_DENOISE_DFN_POSTFILTER === 'true';
// deep-filter's own default is 0.02. Raising it removed steadily more noise in
// measurement (34.6 dB at 0.02 -> 45.8 dB at 0.5) with no spectral penalty, but
// the metric is blind to the artefacts a strong post-filter is known for, so the
// default stays where deep-filter puts it. Tune by ear with npm run uji:noise.
const deepFilterPostFilterBeta = readNumber(process.env.VIDEO_DENOISE_DFN_PF_BETA, 0.02, 0.001, 1);
// voicecleaner.ai runs on a daily credit allowance, so it stops working partway
// through a busy day. Falling back to a local engine keeps senders getting a
// cleaned video instead of an error. Set to an empty value to disable.
const voiceCleanerFallbackEngine = String(
  process.env.VOICECLEANER_FALLBACK_ENGINE === undefined
    ? 'deepfilternet'
    : process.env.VOICECLEANER_FALLBACK_ENGINE
).toLowerCase();

function defaultDeepFilterPath() {
  const binaryName = process.platform === 'win32' ? 'deep-filter.exe' : 'deep-filter';

  return path.join(__dirname, '..', '..', 'bin', binaryName);
}

class NoiseReductionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NoiseReductionError';
    this.code = code;
  }
}

function deriveFfprobePath(ffmpegBinaryPath) {
  const directory = path.dirname(ffmpegBinaryPath);
  const fileName = path.basename(ffmpegBinaryPath).replace(/ffmpeg/i, 'ffprobe');

  return directory === '.' ? fileName : path.join(directory, fileName);
}

function readNumber(rawValue, fallback, min, max) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

// ffmpeg treats ":" inside a filter option as an option separator, so the drive
// letter of a Windows path such as C:\dir\sh.rnnn has to be quoted and escaped.
function escapeFilterValue(value) {
  const posixPath = String(value).replace(/\\/g, '/');

  return `'${posixPath.replace(/([:'])/g, '\\$1')}'`;
}

// Escaping behaves differently depending on how deeply the filter is nested, so
// prefer a colon-free path relative to the ffmpeg working directory and only
// fall back to escaping when no relative path can be formed (another drive).
function toFilterPath(targetPath) {
  const absolutePath = path.resolve(targetPath);
  const relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');

  if (relativePath && !relativePath.includes(':')) {
    return relativePath;
  }

  return escapeFilterValue(absolutePath);
}

const engines = {
  afftdn: () => [
    'highpass=f=200',
    `afftdn=nr=${defaultNoiseReduction}:nf=-25`,
    'anlmdn=s=0.0001:p=0.002',
  ],
  arnndn: ({ modelPath, mix }) => {
    if (!fs.existsSync(modelPath)) {
      throw new NoiseReductionError(
        'MODEL_MISSING',
        `Model arnndn tidak ditemukan di ${modelPath}.`
      );
    }

    const filters = [`arnndn=m=${toFilterPath(modelPath)}:mix=${mix}`];

    if (polishEnabled) {
      filters.push(`afftdn=nr=${defaultNoiseReduction}:nf=-25`);
    }

    return filters;
  },
};

// deepfilternet is a separate binary rather than an ffmpeg filter, so it is not
// in `engines` and reduceNoise routes it through its own three-step pipeline.
const externalEngines = new Set(['deepfilternet', 'voicecleaner']);

// Shared tail applied whatever removed the noise, so brightness and loudness
// behave the same for every engine.
function buildPostFilters() {
  const filters = [];

  if (trebleGainDb > 0) {
    filters.push(`treble=g=${trebleGainDb}:f=3000`);
  }

  if (loudnormEnabled) {
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  // loudnorm resamples to 192 kHz internally, so force the rate back down.
  filters.push('aresample=48000');

  return filters;
}

function buildAudioFilter({ engine, modelPath, mix }) {
  const buildEngineFilters = engines[engine];
  if (!buildEngineFilters) {
    throw new NoiseReductionError(
      'UNKNOWN_ENGINE',
      `Engine denoise "${engine}" tidak dikenal. Pilihan: ${[...Object.keys(engines), ...externalEngines].join(', ')}.`
    );
  }

  const filters = [
    'aresample=48000',
    ...buildEngineFilters({ modelPath, mix }),
    ...buildPostFilters(),
  ];

  return filters.join(',');
}

function lastStderrLine(stderr) {
  const lines = String(stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[lines.length - 1] || 'tanpa keterangan';
}

function runProcess(binaryPath, args, timeoutMs, failureCode = 'FFMPEG_FAILED') {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn(binaryPath, args, { windowsHide: true });
    } catch (error) {
      reject(new NoiseReductionError('SPAWN_FAILED', `Gagal menjalankan ${binaryPath}: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new NoiseReductionError(
          'SPAWN_FAILED',
          `Gagal menjalankan ${binaryPath}: ${error.message}`
        )
      );
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(
          new NoiseReductionError(
            'TIMEOUT',
            `${path.basename(binaryPath)} dihentikan setelah ${timeoutMs} ms.`
          )
        );
        return;
      }

      if (code !== 0) {
        reject(
          new NoiseReductionError(
            failureCode,
            `${path.basename(binaryPath)} keluar dengan kode ${code}: ${lastStderrLine(stderr)}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function probeMedia(inputPath) {
  const { stdout } = await runProcess(
    ffprobePath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      inputPath,
    ],
    probeTimeoutMs,
    'PROBE_FAILED'
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch (error) {
    throw new NoiseReductionError('PROBE_FAILED', `Output ffprobe tidak bisa dibaca: ${error.message}`);
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');

  return {
    hasVideo: streams.some((stream) => stream.codec_type === 'video'),
    hasAudio: Boolean(audioStream),
    durationSeconds: Number(parsed.format?.duration) || 0,
    audioBitRate: Number(audioStream?.bit_rate) || 0,
    audioChannels: Number(audioStream?.channels) || 0,
  };
}

// Re-encoding at a higher bitrate than the source only inflates the file without
// recovering detail, and an inflated file can cross the WhatsApp send limit.
function pickAudioBitRate(sourceBitRate) {
  if (!sourceBitRate) {
    return maxAudioBitRateKbps;
  }

  const sourceKbps = Math.round(sourceBitRate / 1000);

  return Math.min(Math.max(sourceKbps, minAudioBitRateKbps), maxAudioBitRateKbps);
}

// voicecleaner.ai has no API, so the audio makes a round trip through a browser
// session: extract, upload, download, mux back. Same three-step shape as the
// deep-filter path, but the middle step is a hosted service behind a login and
// a daily credit allowance rather than a local binary.
async function reduceNoiseWithVoiceCleaner({
  inputPath,
  outputPath,
  media,
  timeoutMs = defaultTimeoutMs,
  applyPostFilters = true,
  onProgress = () => { },
}) {
  const { cleanAudio } = require('./voiceCleanerClient');
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wa-vc-'));
  const extractedPath = path.join(workDir, 'audio.wav');
  const downloadDir = path.join(workDir, 'download');
  const startedAtMs = Date.now();

  try {
    await runProcess(
      ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-map', '0:a:0',
        '-ar', '48000',
        '-c:a', 'pcm_s16le',
        extractedPath,
      ],
      timeoutMs
    );

    const cleanedPath = await cleanAudio({ inputPath: extractedPath, downloadDir, onProgress });
    const audioBitRateKbps = pickAudioBitRate(media.audioBitRate);
    const postFilters = applyPostFilters ? buildPostFilters() : [];
    const muxArgs = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-i', cleanedPath,
    ];

    if (media.hasVideo) {
      muxArgs.push('-map', '0:v:0', '-c:v', 'copy');
    }

    muxArgs.push('-map', '1:a:0');

    if (postFilters.length) {
      muxArgs.push('-af', postFilters.join(','));
    }

    muxArgs.push('-c:a', 'aac', '-b:a', `${audioBitRateKbps}k`, '-ar', '48000');

    if (media.hasVideo) {
      muxArgs.push('-movflags', '+faststart');
    }

    muxArgs.push('-shortest', outputPath);

    await onProgress('Menggabungkan kembali ke video...');
    await runProcess(ffmpegPath, muxArgs, timeoutMs);

    return {
      engine: 'voicecleaner',
      audioFilter: `voicecleaner.ai${postFilters.length ? ` | ${postFilters.join(',')}` : ''}`,
      audioBitRateKbps,
      hasVideo: media.hasVideo,
      durationSeconds: media.durationSeconds,
      elapsedMs: Date.now() - startedAtMs,
    };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch((error) => {
      console.error(`Failed to clean up ${workDir}:`, error);
    });
  }
}

// deep-filter takes an audio file and writes the enhanced result into an output
// directory under the SAME base name, so it needs a scratch directory of its own
// and cannot be expressed as a single ffmpeg pass like the filter engines.
async function reduceNoiseWithDeepFilter({
  inputPath,
  outputPath,
  media,
  timeoutMs = defaultTimeoutMs,
  attenDb = attenLimitDb,
  postFilter = deepFilterPostFilter,
  postFilterBeta = deepFilterPostFilterBeta,
  applyPostFilters = true,
  onProgress = () => { },
}) {
  if (!fs.existsSync(deepFilterPath)) {
    throw new NoiseReductionError(
      'DEEPFILTER_MISSING',
      `Binary deep-filter tidak ada di ${deepFilterPath}.`
    );
  }

  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wa-dfn-'));
  const extractedPath = path.join(workDir, 'audio.wav');
  const enhancedDir = path.join(workDir, 'out');
  const startedAtMs = Date.now();

  try {
    await fs.promises.mkdir(enhancedDir);

    await onProgress('Menyiapkan audio...');
    await runProcess(
      ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath,
        '-map', '0:a:0',
        '-ar', '48000',
        '-c:a', 'pcm_s16le',
        extractedPath,
      ],
      timeoutMs
    );

    // -D compensates the STFT and model lookahead delay. Measured without it the
    // audio lands 30 ms late, which would drift against the video.
    const deepFilterArgs = ['-D', '-a', String(attenDb)];

    if (postFilter) {
      deepFilterArgs.push('--pf', '--pf-beta', String(postFilterBeta));
    }

    await onProgress('Membersihkan noise...');
    await runProcess(
      deepFilterPath,
      deepFilterArgs.concat(['-o', enhancedDir, extractedPath]),
      timeoutMs,
      'DEEPFILTER_FAILED'
    );

    const enhancedPath = path.join(enhancedDir, path.basename(extractedPath));

    if (!fs.existsSync(enhancedPath)) {
      throw new NoiseReductionError(
        'DEEPFILTER_FAILED',
        'deep-filter tidak menghasilkan file audio.'
      );
    }

    const audioBitRateKbps = pickAudioBitRate(media.audioBitRate);
    const postFilters = applyPostFilters ? buildPostFilters() : [];
    const muxArgs = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-i', enhancedPath,
    ];

    if (media.hasVideo) {
      muxArgs.push('-map', '0:v:0', '-c:v', 'copy');
    }

    muxArgs.push('-map', '1:a:0');

    if (postFilters.length) {
      muxArgs.push('-af', postFilters.join(','));
    }

    muxArgs.push('-c:a', 'aac', '-b:a', `${audioBitRateKbps}k`, '-ar', '48000');

    if (media.hasVideo) {
      muxArgs.push('-movflags', '+faststart');
    }

    muxArgs.push('-shortest', outputPath);

    await onProgress('Menggabungkan kembali ke video...');
    await runProcess(ffmpegPath, muxArgs, timeoutMs);

    return {
      engine: 'deepfilternet',
      audioFilter: `deep-filter -D -a ${attenDb}${postFilter ? ` --pf --pf-beta ${postFilterBeta}` : ''}` +
        (postFilters.length ? ` | ${postFilters.join(',')}` : ''),
      audioBitRateKbps,
      hasVideo: media.hasVideo,
      durationSeconds: media.durationSeconds,
      elapsedMs: Date.now() - startedAtMs,
    };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch((error) => {
      console.error(`Failed to clean up ${workDir}:`, error);
    });
  }
}

async function reduceNoise({
  inputPath,
  outputPath,
  engine = defaultEngine,
  modelPath = defaultModelPath,
  mix = defaultMix,
  timeoutMs = defaultTimeoutMs,
  onProgress = () => { },
}) {
  const media = await probeMedia(inputPath);

  if (!media.hasAudio) {
    throw new NoiseReductionError('NO_AUDIO', 'File ini tidak punya track audio.');
  }

  if (engine === 'voicecleaner') {
    try {
      return await reduceNoiseWithVoiceCleaner({ inputPath, outputPath, media, timeoutMs, onProgress });
    } catch (error) {
      if (!voiceCleanerFallbackEngine || voiceCleanerFallbackEngine === 'voicecleaner') {
        throw error;
      }

      console.error(
        `voicecleaner gagal (${error.code || 'tanpa kode'}), fallback ke ${voiceCleanerFallbackEngine}:`,
        error.message
      );

      await onProgress('Beralih ke pemrosesan lokal...');

      const fallback = await reduceNoise({
        inputPath,
        outputPath,
        engine: voiceCleanerFallbackEngine,
        modelPath,
        mix,
        timeoutMs,
        onProgress,
      });

      return { ...fallback, fallbackFrom: 'voicecleaner', fallbackReason: error.code || 'UNKNOWN' };
    }
  }

  if (externalEngines.has(engine)) {
    return reduceNoiseWithDeepFilter({ inputPath, outputPath, media, timeoutMs, onProgress });
  }

  const audioFilter = buildAudioFilter({ engine, modelPath, mix });
  const audioBitRateKbps = pickAudioBitRate(media.audioBitRate);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];

  if (media.hasVideo) {
    args.push('-map', '0:v:0', '-c:v', 'copy');
  }

  args.push(
    '-map',
    '0:a:0',
    '-af',
    audioFilter,
    '-c:a',
    'aac',
    '-b:a',
    `${audioBitRateKbps}k`,
    '-ar',
    '48000'
  );

  if (media.hasVideo) {
    args.push('-movflags', '+faststart');
  }

  args.push(outputPath);

  const startedAtMs = Date.now();
  await onProgress('Membersihkan noise...');
  await runProcess(ffmpegPath, args, timeoutMs);

  return {
    engine,
    audioFilter,
    audioBitRateKbps,
    hasVideo: media.hasVideo,
    durationSeconds: media.durationSeconds,
    elapsedMs: Date.now() - startedAtMs,
  };
}

module.exports = {
  NoiseReductionError,
  buildAudioFilter,
  defaultEngine,
  escapeFilterValue,
  probeMedia,
  reduceNoise,
  reduceNoiseWithDeepFilter,
  reduceNoiseWithVoiceCleaner,
  toFilterPath,
};
