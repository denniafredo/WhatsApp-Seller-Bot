// Baca pengeluaran harian dari ringkasan rekap yang dikirim bot ke grup:
//
//   kulakan yohan: Rp1.227.000
//   kas: Rp0
//
// Sumbernya sengaja pesan itu, bukan menghitung ulang dari sheet template:
// angka yang masuk buku keuangan jadi persis angka yang sudah dilihat dan
// disetujui orang di grup.
//
// Bedanya dengan setoran offline:
//   - Pesan bot sendiri (fromMe) justru YANG DICARI, bukan dibuang.
//   - Satu nilai per hari, bukan daftar. Rekap yang diulang menimpa yang lama,
//     jadi yang dipakai selalu ringkasan TERAKHIR pada tanggal itu.
//   - Nominalnya sudah rupiah penuh, jadi tidak ada aturan "di bawah 1000
//     dianggap ribuan" seperti di offlineParser.

const { businessYmd } = require('./businessDay');
const { getMessageTimestampMs, parseIndonesianNumber } = require('./offlineParser');
const { config: summaryConfig } = require('../shared/recapSummary');

function normalizeLabel(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Cocokkan satu baris "label: Rp1.227.000".
 * @returns nominal, atau null bila barisnya bukan label itu.
 */
function matchLabeledAmount(line, label) {
  const normalizedLine = normalizeLabel(line);
  const normalizedLabel = normalizeLabel(label);

  if (!normalizedLabel || !normalizedLine.startsWith(normalizedLabel)) {
    return null;
  }

  const rest = normalizedLine.slice(normalizedLabel.length);
  // Bintang WhatsApp (*Rp0*) ikut dibuang supaya label boleh ditebalkan nanti.
  const match = /^\s*[:=]?\s*\**\s*rp\.?\s*([\d.,]+)\s*\**\s*$/.exec(rest);
  if (!match) {
    return null;
  }

  const amount = parseIndonesianNumber(match[1]);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

/**
 * Baca satu pesan ringkasan.
 *
 * Baris kulakan wajib jadi baris PERTAMA. Tanpa jangkar itu, balasan auto
 * rekap sendiri - yang ikut mencetak "Kulakan Yohan: Rp..." di bagian
 * pengeluarannya - akan terbaca sebagai ringkasan baru pada run berikutnya.
 */
function parseSummaryText(text, labels) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  const kulakan = matchLabeledAmount(lines[0], labels.total);
  if (kulakan === null) {
    return null;
  }

  let kas = null;
  lines.slice(1).some((line) => {
    const value = matchLabeledAmount(line, labels.cash);
    if (value === null) {
      return false;
    }
    kas = value;
    return true;
  });

  return { kulakan, kas };
}

/**
 * Cari ringkasan rekap terakhir milik satu tanggal.
 *
 * @param messages daftar pesan grup (harus termasuk pesan bot sendiri)
 * @param options  { targetDate: 'YYYY-MM-DD', timeZone, untilMs, labels }
 * @returns { entry, found, skippedNoTimestamp }
 *          entry: { kulakan, kas, timestampMs, date, raw } atau null
 */
function collectRecapExpenses(messages, options = {}) {
  const timeZone = options.timeZone || 'Asia/Makassar';
  const targetDate = options.targetDate || null;
  const untilMs = Number.isFinite(options.untilMs) ? options.untilMs : null;
  const labels = {
    total: options.labels?.total || summaryConfig.totalLabel,
    cash: options.labels?.cash || summaryConfig.cashLabel,
  };

  const matches = [];
  let skippedNoTimestamp = 0;

  (messages || []).forEach((message) => {
    const text = String(message?.body || message?.caption || message?.content || '');
    if (!text) {
      return;
    }

    const parsed = parseSummaryText(text, labels);
    if (!parsed) {
      return;
    }

    const timestampMs = getMessageTimestampMs(message);

    if (untilMs !== null && timestampMs !== null && timestampMs > untilMs) {
      return;
    }

    let date = null;
    if (timestampMs === null) {
      if (targetDate) {
        skippedNoTimestamp += 1;
        return;
      }
    } else {
      // Hari KERJA, sama seperti offlineParser: rekap yang dikerjakan jam 00:30
      // masih milik hari sebelumnya.
      date = businessYmd(timestampMs, timeZone);
      if (targetDate && date !== targetDate) {
        return;
      }
    }

    matches.push({
      ...parsed,
      timestampMs,
      date,
      raw: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' | '),
    });
  });

  matches.sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

  return {
    entry: matches.length ? matches[matches.length - 1] : null,
    found: matches.length,
    skippedNoTimestamp,
  };
}

module.exports = {
  collectRecapExpenses,
  matchLabeledAmount,
  parseSummaryText,
};
