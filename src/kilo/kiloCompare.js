// Logika cocokkan baris foto (tulisan tangan) dengan transaksi Bilas.
// Fungsi murni tanpa I/O, jadi bisa diuji tanpa WhatsApp maupun API.

const DEFAULT_TOLERANCE_KG = Number(process.env.KILO_TOLERANCE) || 0.3;

// Buang gelar/panggilan umum supaya "Bu Ani" cocok dengan "Ani".
const HONORIFICS = new Set([
  'bu', 'ibu', 'pak', 'bpk', 'bapak', 'mba', 'mbak', 'mas', 'kak', 'ka',
  'sdr', 'sdri', 'tn', 'ny', 'nona', 'the', 'kost', 'kos',
]);

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !HONORIFICS.has(word))
    .join(' ')
    .trim();
}

function tokenize(value) {
  return normalizeName(value).split(' ').filter(Boolean);
}

// Levenshtein untuk toleransi salah baca / typo pada satu kata.
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function wordSimilar(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  const dist = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  // Satu huruf beda pada kata pendek, atau <=20% pada kata panjang.
  return dist <= (maxLen <= 5 ? 1 : Math.ceil(maxLen * 0.2));
}

// Skor 0..1: seberapa banyak token foto yang punya pasangan di nama Bilas.
function nameScore(photoName, bilasName) {
  const a = tokenize(photoName);
  const b = tokenize(bilasName);
  if (!a.length || !b.length) return 0;

  let hits = 0;
  const used = new Array(b.length).fill(false);
  for (const wordA of a) {
    const idx = b.findIndex((wordB, i) => !used[i] && wordSimilar(wordA, wordB));
    if (idx >= 0) {
      used[idx] = true;
      hits += 1;
    }
  }
  return hits / a.length;
}

// Cari transaksi Bilas terbaik untuk satu baris foto. Ambang 0.5 supaya "Ani"
// bisa cocok ke "Ani Suryani" (1/1) tapi tidak asal tempel.
function bestMatch(photoRow, bilasRows, usedIndexes) {
  let best = null;
  bilasRows.forEach((row, index) => {
    if (usedIndexes.has(index)) return;
    const score = nameScore(photoRow.nama, row.nama);
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { index, row, score };
    }
  });
  return best;
}

function kiloMatches(photoKilo, bilasKilo, tolerance) {
  if (photoKilo == null || Number.isNaN(Number(photoKilo))) return false;
  return Math.abs(Number(photoKilo) - Number(bilasKilo)) <= tolerance + 1e-9;
}

/**
 * @param photoRows  [{ nama, kilo, keterangan, yakin }]
 * @param bilasRows  [{ noNota, nama, kilo, status, tanggal }]
 * @returns {{ rows, notInPhoto, tolerance, counts }}
 */
function compareKilo(photoRows, bilasRows, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : DEFAULT_TOLERANCE_KG;
  const usedIndexes = new Set();
  const rows = [];

  for (const photoRow of photoRows || []) {
    // Nama kosong sama sekali: tidak ada yang bisa dicocokkan.
    if (!normalizeName(photoRow.nama)) {
      rows.push({
        nama: photoRow.nama || '(tidak terbaca)',
        photoKilo: photoRow.kilo,
        bilasKilo: null,
        keterangan: photoRow.keterangan || '',
        status: null,
        noNota: null,
        state: 'uncertain',
      });
      continue;
    }

    const match = bestMatch(photoRow, bilasRows, usedIndexes);
    if (!match) {
      // Baris yang AI sendiri ragu membacanya tidak dituduh "tak ada di Bilas";
      // ditandai ragu baca supaya dicek manual, bukan dianggap kebocoran.
      rows.push({
        nama: photoRow.nama,
        photoKilo: photoRow.kilo,
        bilasKilo: null,
        keterangan: photoRow.keterangan || '',
        status: null,
        noNota: null,
        state: photoRow.yakin === false ? 'uncertain' : 'not_in_bilas',
      });
      continue;
    }

    usedIndexes.add(match.index);
    const cocok = kiloMatches(photoRow.kilo, match.row.kilo, tolerance);
    rows.push({
      nama: photoRow.nama,
      bilasNama: match.row.nama,
      photoKilo: photoRow.kilo,
      bilasKilo: match.row.kilo,
      keterangan: photoRow.keterangan || '',
      status: match.row.status,
      noNota: match.row.noNota,
      nameScore: match.score,
      state: cocok ? 'match' : 'kilo_diff',
    });
  }

  const notInPhoto = bilasRows
    .filter((_, index) => !usedIndexes.has(index))
    .map((row) => ({
      nama: row.nama,
      bilasKilo: row.kilo,
      status: row.status,
      noNota: row.noNota,
      tanggal: row.tanggal,
      state: 'not_in_photo',
    }));

  const counts = {
    match: rows.filter((r) => r.state === 'match').length,
    kiloDiff: rows.filter((r) => r.state === 'kilo_diff').length,
    notInBilas: rows.filter((r) => r.state === 'not_in_bilas').length,
    uncertain: rows.filter((r) => r.state === 'uncertain').length,
    notInPhoto: notInPhoto.length,
  };

  return { rows, notInPhoto, tolerance, counts };
}

module.exports = {
  compareKilo,
  normalizeName,
  nameScore,
  editDistance,
  kiloMatches,
  DEFAULT_TOLERANCE_KG,
};
