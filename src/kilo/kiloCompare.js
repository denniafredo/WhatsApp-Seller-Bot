// Logika cocokkan baris foto (tulisan tangan) dengan transaksi Bilas.
// Fungsi murni tanpa I/O, jadi bisa diuji tanpa WhatsApp maupun API.

const DEFAULT_TOLERANCE_KG = Number(process.env.KILO_TOLERANCE) || 0.3;

// Buang gelar/panggilan umum supaya "Bu Ani" cocok dengan "Ani".
const HONORIFICS = new Set([
  'bu', 'ibu', 'pak', 'bpk', 'bapak', 'mba', 'mbak', 'mas', 'kak', 'ka',
  'sdr', 'sdri', 'tn', 'ny', 'nona', 'the', 'kost', 'kos',
]);

// Angka yang sering terbaca sebagai huruf pada tulisan tangan (2->z, 0->o, ...).
// Hanya dipakai untuk mengukur kemiripan, tidak pernah untuk menampilkan nama.
const DIGIT_LOOKALIKE = {
  0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'b', 7: 't', 8: 'b', 9: 'g',
};

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

// Bentuk rapat tanpa spasi + digit dilipat ke huruf miripnya, untuk charSimilarity.
function foldName(value) {
  return normalizeName(value)
    .replace(/\s+/g, '')
    .replace(/[0-9]/g, (digit) => DIGIT_LOOKALIKE[digit] || digit);
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

// Skor 0..1 pada seluruh nama (bukan per kata). Ini yang memisahkan
// "Dian marlma" -> "Dian Merlina" (0,73) dari "Dian Fani" (0,50), yang lewat
// nameScore sama-sama bernilai 0,5 dan tadinya dipilih asal urutan.
function charSimilarity(photoName, bilasName) {
  const a = foldName(photoName);
  const b = foldName(bilasName);
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

function kiloMatches(photoKilo, bilasKilo, tolerance) {
  if (photoKilo == null || Number.isNaN(Number(photoKilo))) return false;
  return Math.abs(Number(photoKilo) - Number(bilasKilo)) <= tolerance + 1e-9;
}

// Skor kilo 0..1; null bila foto tidak menuliskan kilo sama sekali (item satuan),
// supaya baris itu dinilai murni dari nama.
function kiloScore(photoKilo, bilasKilo, tolerance) {
  if (photoKilo == null || Number.isNaN(Number(photoKilo))) return null;
  const diff = Math.abs(Number(photoKilo) - Number(bilasKilo));
  if (diff <= tolerance + 1e-9) return 1;
  // Turun landai: beda 1 kg masih ~0,8; beda >=5 kg dianggap bukan orang yang sama.
  return Math.max(0, 1 - (diff - tolerance) / 5);
}

// Nilai satu pasangan (baris foto, transaksi Bilas).
function scorePair(photoRow, bilasRow, tolerance) {
  const token = nameScore(photoRow.nama, bilasRow.nama);
  const char = charSimilarity(photoRow.nama, bilasRow.nama);
  const kg = kiloScore(photoRow.kilo, bilasRow.kilo, tolerance);
  const nameOnly = 0.65 * token + 0.35 * char;
  const score = kg == null ? nameOnly : 0.75 * nameOnly + 0.25 * kg;
  return { token, char, kg, kgHit: kg === 1, score };
}

// Pasangan layak dipertimbangkan bila namanya memang mirip, atau namanya
// setengah mirip TAPI kilonya pas — jalan penyelamat untuk nama yang rusak
// parah dibaca AI (mis. "2alk kenid" -> "Zaky Kendal", kilo 5,26 sama persis).
function isEligible(pair) {
  if (pair.token >= 0.5) return true;
  if (pair.char >= 0.6) return true;
  if (pair.kgHit && (pair.token >= 0.34 || pair.char >= 0.45)) return true;
  return false;
}

// Penugasan global: semua pasangan layak diurut dari skor tertinggi, lalu
// diambil selama baris foto & transaksi belum terpakai. Pendekatan lama
// (per baris, urut foto) membuat baris pertama menyabet transaksi milik
// baris lain hanya karena diproses duluan.
function assignPairs(photoRows, bilasRows, tolerance) {
  const candidates = [];
  photoRows.forEach((photoRow, photoIndex) => {
    if (!normalizeName(photoRow.nama)) return;
    bilasRows.forEach((bilasRow, bilasIndex) => {
      const pair = scorePair(photoRow, bilasRow, tolerance);
      if (isEligible(pair)) {
        candidates.push({ photoIndex, bilasIndex, ...pair });
      }
    });
  });

  candidates.sort((a, b) => b.score - a.score || b.token - a.token || b.char - a.char);

  const byPhoto = new Map();
  const usedBilas = new Set();
  for (const candidate of candidates) {
    if (byPhoto.has(candidate.photoIndex) || usedBilas.has(candidate.bilasIndex)) continue;
    byPhoto.set(candidate.photoIndex, candidate);
    usedBilas.add(candidate.bilasIndex);
  }

  return { byPhoto, usedBilas };
}

/**
 * @param photoRows  [{ nama, namaFoto, kilo, keterangan, yakin }]
 * @param bilasRows  [{ noNota, nama, kilo, satuan, status, tanggal }]
 * @returns {{ rows, notInPhoto, tolerance, counts }}
 */
function compareKilo(photoRows, bilasRows, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : DEFAULT_TOLERANCE_KG;
  const photos = photoRows || [];
  const bilas = bilasRows || [];
  const { byPhoto, usedBilas } = assignPairs(photos, bilas, tolerance);
  const rows = [];

  photos.forEach((photoRow, photoIndex) => {
    const namaFoto = photoRow.namaFoto || photoRow.nama || '';
    const base = {
      nama: photoRow.nama || '(tidak terbaca)',
      namaFoto,
      photoKilo: photoRow.kilo,
      bilasKilo: null,
      keterangan: photoRow.keterangan || '',
      status: null,
      noNota: null,
      selisih: null,
    };

    const match = byPhoto.get(photoIndex);
    if (!match) {
      // Nama kosong atau AI sendiri ragu membacanya tidak dituduh "tak ada di
      // Bilas"; ditandai ragu baca supaya dicek manual, bukan kebocoran.
      const unreadable = !normalizeName(photoRow.nama) || photoRow.yakin === false;
      rows.push({ ...base, state: unreadable ? 'uncertain' : 'not_in_bilas' });
      return;
    }

    const bilasRow = bilas[match.bilasIndex];
    const noKilo = photoRow.kilo == null || Number.isNaN(Number(photoRow.kilo));
    const cocok = kiloMatches(photoRow.kilo, bilasRow.kilo, tolerance);
    const selisih = noKilo
      ? null
      : Number((Number(photoRow.kilo) - Number(bilasRow.kilo)).toFixed(2));
    rows.push({
      ...base,
      nama: bilasRow.nama || base.nama,
      bilasNama: bilasRow.nama,
      bilasId: bilasRow.id,
      tanggal: bilasRow.tanggal,
      bilasKilo: bilasRow.kilo,
      satuan: bilasRow.satuan,
      keterangan: photoRow.keterangan || '',
      status: bilasRow.status,
      noNota: bilasRow.noNota,
      nameScore: match.token,
      charScore: match.char,
      // Nama di foto beda ejaan dengan nama di aplikasi: tampilkan keduanya.
      nameFixed: normalizeName(namaFoto) !== normalizeName(bilasRow.nama),
      // Cocok terutama karena kilonya pas, bukan namanya: minta cek manual.
      weakName: match.token < 0.5 && match.char < 0.6,
      selisih,
      // Masih dalam toleransi tapi angkanya tidak sama persis tetap ditandai:
      // hitungan mengikuti angka aplikasi, jadi beda 0,01 pun perlu terlihat.
      state: noKilo
        ? 'no_kilo'
        : (cocok ? (selisih === 0 ? 'match' : 'match_toleransi') : 'kilo_diff'),
    });
  });

  const notInPhoto = bilas
    .filter((_, index) => !usedBilas.has(index))
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
    matchToleransi: rows.filter((r) => r.state === 'match_toleransi').length,
    kiloDiff: rows.filter((r) => r.state === 'kilo_diff').length,
    noKilo: rows.filter((r) => r.state === 'no_kilo').length,
    notInBilas: rows.filter((r) => r.state === 'not_in_bilas').length,
    uncertain: rows.filter((r) => r.state === 'uncertain').length,
    nameFixed: rows.filter((r) => r.nameFixed).length,
    weakName: rows.filter((r) => r.weakName).length,
    notInPhoto: notInPhoto.length,
  };

  return { rows, notInPhoto, tolerance, counts };
}

module.exports = {
  compareKilo,
  normalizeName,
  nameScore,
  charSimilarity,
  editDistance,
  kiloMatches,
  kiloScore,
  DEFAULT_TOLERANCE_KG,
};
