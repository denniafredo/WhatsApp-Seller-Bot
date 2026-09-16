// Hari kerja toko, bukan hari kalender.
//
// Rekap biasanya dikerjakan setelah tutup, kadang sudah lewat tengah malam.
// Kalau memakai tanggal kalender, menjalankan "auto rekap" jam 00:30 tanggal 16
// akan menulis ke blok tanggal 16 yang masih kosong, sementara seluruh setoran
// dan saldo yang dimaksud milik tanggal 15.
//
// Jadi jam 00:00 s/d KEUANGAN_DAY_CUTOFF_HOUR masih dihitung hari sebelumnya.
//
// Batas ini WAJIB dipakai di dua tempat sekaligus: saat menentukan tanggal
// target, dan saat memilah pesan grup mana yang termasuk hari itu. Kalau hanya
// salah satu, pesan jam 00:10 akan jatuh ke hari yang berbeda dari bloknya.

const DEFAULT_CUTOFF_HOUR = 4;

function getCutoffHour() {
  const raw = Number(process.env.KEUANGAN_DAY_CUTOFF_HOUR);
  if (!Number.isFinite(raw)) {
    return DEFAULT_CUTOFF_HOUR;
  }
  // 0 = matikan (ikut kalender apa adanya). Di atas 12 tidak masuk akal untuk
  // batas "masih malam sebelumnya".
  return Math.min(Math.max(Math.floor(raw), 0), 12);
}

// en-CA memberi format YYYY-MM-DD.
function ymdInTimeZone(dateMs, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dateMs));
}

function hourInTimeZone(dateMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    // hourCycle h23 supaya tengah malam jadi 00, bukan 24 - beberapa versi ICU
    // mengembalikan "24" dan itu membuat perbandingan batas jam salah.
    hourCycle: 'h23',
  }).formatToParts(new Date(dateMs));

  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

function shiftYmd(ymd, deltaDays) {
  // Tengah hari UTC supaya pergeseran hari tidak terpengaruh zona waktu.
  const base = new Date(`${ymd}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/**
 * Tanggal hari kerja untuk satu titik waktu.
 * @param dateMs epoch ms
 * @param timeZone mis. 'Asia/Jakarta'
 * @param cutoffHour jam batas; default dari env
 */
function businessYmd(dateMs, timeZone, cutoffHour) {
  const cutoff = Number.isFinite(cutoffHour) ? cutoffHour : getCutoffHour();
  const calendarYmd = ymdInTimeZone(dateMs, timeZone);

  if (cutoff <= 0) {
    return calendarYmd;
  }

  return hourInTimeZone(dateMs, timeZone) < cutoff ? shiftYmd(calendarYmd, -1) : calendarYmd;
}

const MONTHS_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function labelYmd(ymd) {
  const [year, month, day] = String(ymd).split('-');
  return `${Number(day)} ${MONTHS_ID[Number(month) - 1]} ${year}`;
}

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

module.exports = {
  DEFAULT_CUTOFF_HOUR,
  MONTHS_ID,
  businessYmd,
  getCutoffHour,
  hourInTimeZone,
  isValidYmd,
  labelYmd,
  shiftYmd,
  ymdInTimeZone,
};
