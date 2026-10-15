// Kirim laporan sinyal MA Squeeze harian ke grup (default "cstv").
//
// Candle daily Indodax tutup 00:00 UTC (07:00 WIB), jadi jadwal default
// 07:10 WIB: datanya sudah final dan sinyalnya masih pagi.
//
// Tidak memakai cron: tiap menit dicek "sudah lewat jam kirim dan hari ini
// belum terkirim?". Tanggal terakhir terkirim disimpan di data/, jadi bot
// yang direstart nodemon tidak mengirim dua kali, dan bot yang baru hidup
// setelah jam kirim tetap mengirim laporan hari itu.

const fs = require('fs');
const path = require('path');
const { resolveGroupId } = require('../shared/groupResolver');
const { runSqueezeScreener } = require('./squeezeScreener');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'squeeze-signal-state.json');

const config = {
  enabled: process.env.SQUEEZE_SIGNAL_ENABLED !== 'false',
  groupName: process.env.SQUEEZE_SIGNAL_GROUP_NAME || 'cstv',
  groupId: process.env.SQUEEZE_SIGNAL_GROUP_ID || '',
  time: process.env.SQUEEZE_SIGNAL_TIME || '07:10',
  timeZone: process.env.SQUEEZE_SIGNAL_TIMEZONE || 'Asia/Jakarta',
};

const CHECK_INTERVAL_MS = 60 * 1000;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_DAY = 4;

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read squeeze signal state:', error);
    }
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Tanggal (YYYY-MM-DD) dan jam (HH:MM) sekarang di zona waktu jadwal.
function nowInZone(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return { day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}` };
}

function resolveSignalGroupId(client) {
  return resolveGroupId(client, {
    groupId: config.groupId,
    groupName: config.groupName,
    envHint: 'Set SQUEEZE_SIGNAL_GROUP_NAME atau SQUEEZE_SIGNAL_GROUP_ID di .env.',
  });
}

async function sendDailySignal(client) {
  const groupId = await resolveSignalGroupId(client);
  const report = await runSqueezeScreener();
  await client.sendText(groupId, report);
  return groupId;
}

function startSqueezeSchedule(client) {
  if (!config.enabled) {
    console.log('Squeeze signal harian dimatikan (SQUEEZE_SIGNAL_ENABLED=false).');
    return () => { };
  }

  if (!/^\d{2}:\d{2}$/.test(config.time)) {
    console.error(`SQUEEZE_SIGNAL_TIME "${config.time}" tidak valid, harus HH:MM. Jadwal sinyal tidak jalan.`);
    return () => { };
  }

  let running = false;
  let attempts = { day: '', count: 0, lastMs: 0 };

  const tick = async () => {
    const { day, hhmm } = nowInZone(config.timeZone);
    if (running || hhmm < config.time || loadState().lastSentDay === day) {
      return;
    }

    if (attempts.day !== day) {
      attempts = { day, count: 0, lastMs: 0 };
    }
    if (attempts.count >= MAX_ATTEMPTS_PER_DAY || Date.now() - attempts.lastMs < RETRY_DELAY_MS) {
      return;
    }

    running = true;
    attempts.count += 1;
    attempts.lastMs = Date.now();

    try {
      const groupId = await sendDailySignal(client);
      saveState({ lastSentDay: day, lastSentAt: new Date().toISOString(), groupId });
      console.log(`Sent daily squeeze signal for ${day} to ${groupId}.`);
    } catch (error) {
      console.error(`Daily squeeze signal attempt ${attempts.count}/${MAX_ATTEMPTS_PER_DAY} failed:`, error);
    } finally {
      running = false;
    }
  };

  console.log(
    `Squeeze signal harian: ${config.time} ${config.timeZone} ke grup "${config.groupId || config.groupName}".`
  );

  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

module.exports = {
  config,
  nowInZone,
  startSqueezeSchedule,
};
