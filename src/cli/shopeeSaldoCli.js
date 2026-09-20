#!/usr/bin/env node
// Verifikasi alur Shopee tanpa menarik dana: login -> buka Saldo Saya -> baca
// nominal "saldo dapat ditarik", lalu berhenti.
//
// Ini yang dipakai untuk memperbaiki selektor di shopeeWithdrawClient.js.
// Jalankan dengan jendela terlihat saat pertama kali (login/OTP manual sekali):
//
//   SHOPEE_SELLER_HEADLESS=false node src/cli/shopeeSaldoCli.js
//
//   SHOPEE_SELLER_HEADLESS=false node src/cli/shopeeSaldoCli.js --uji
//
// --uji melanjutkan sampai halaman Tarik Dana dan melaporkan tujuan, nominal,
// dan tombol Konfirmasi yang akan ditekan - tanpa menekannya.
//
// --uji-pin melanjutkan sampai popup PIN terbuka, mengetik 2 digit contoh, dan
// memeriksa apakah jumlah digit terbaca benar. Popup baru mengirim di digit
// keenam, jadi tidak ada dana yang berpindah.
//
// Tambahkan --tarik hanya kalau memang ingin benar-benar menarik dana.
require('dotenv').config();

const {
  config,
  formatRupiah,
  getWithdrawRecord,
  withdrawShopeeBalance,
} = require('../keuangan/shopeeWithdrawClient');

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.RECAP_TIMEZONE || 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main() {
  const args = process.argv.slice(2);
  const reallyWithdraw = args.includes('--tarik');
  const force = args.includes('--paksa');
  // --uji: buka sampai halaman Tarik Dana, periksa tujuan/nominal/tombol
  // Konfirmasi, lalu berhenti sebelum tombolnya ditekan. Tidak ada dana yang
  // berpindah - ini cara memverifikasi selektor sebelum menjalankan --tarik.
  const probe = args.includes('--uji') && !reallyWithdraw;
  // --uji-pin: lanjut sampai popup PIN terbuka, ketik 2 digit contoh, lalu
  // laporkan apakah jumlah digit terbaca dengan benar - dan berhenti. Popup PIN
  // baru mengirim di digit keenam, jadi tidak ada dana yang berpindah.
  const probePin = args.includes('--uji-pin') && !reallyWithdraw;
  const date = todayYmd();

  console.log(`Tanggal      : ${date}`);
  console.log(`Halaman saldo: ${config.balanceUrl}`);
  const mode = reallyWithdraw
    ? '*** TARIK DANA SUNGGUHAN ***'
    : probePin
      ? 'uji popup PIN (2 digit contoh, tidak dikirim)'
      : probe
        ? 'uji halaman Tarik Dana (berhenti sebelum Konfirmasi)'
        : 'dry run (dana tidak ditarik)';
  console.log(`Mode         : ${mode}`);

  if (config.headless) {
    console.log('Jendela      : tersembunyi (headless)');
    console.log('               Kalau Shopee minta OTP, jalankan ulang dengan');
    console.log('               SHOPEE_SELLER_HEADLESS=false lalu login manual.');
  } else {
    console.log('Jendela      : TERLIHAT — skrip tidak akan mengisi form sendiri.');
    console.log('               Login manual di jendela Chrome yang terbuka; skrip');
    console.log('               menunggu sampai selesai, lalu lanjut baca saldo.');
  }

  const existing = getWithdrawRecord(date);
  if (existing) {
    console.log(
      `Catatan      : sudah ada penarikan tercatat hari ini ${formatRupiah(existing.amount)} ` +
        `pada ${existing.withdrawnAt}${force ? ' (diabaikan karena --paksa)' : ''}`
    );
  }

  if (reallyWithdraw) {
    console.log('\nMenunggu 5 detik — tekan Ctrl+C sekarang kalau tidak sengaja.\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  const result = await withdrawShopeeBalance({
    date,
    force,
    probe,
    probePin,
    pinProbeDigits: probePin ? '12' : '',
    dryRun: !reallyWithdraw,
    onProgress: (text) => console.log(`  ${text}`),
  });

  console.log('\n--- HASIL ---');
  console.log(`Status  : ${result.status}`);
  console.log(`Nominal : ${formatRupiah(result.amount)}`);
  if (result.label) {
    console.log(`Label   : "${result.label}"`);
  }
  if (result.rawValue) {
    console.log(`Teks asli: "${result.rawValue}"`);
  }
  if (result.status === 'probe-pin') {
    console.log(`Kolom PIN terdeteksi : ${result.pinInputsFound}`);
    console.log(`Digit diketik/terbaca: ${result.probeDigits} / ${result.countedDigits}`);
    console.log(
      result.countedDigits === String(result.probeDigits).length
        ? '  ^ pembacaan PIN cocok - pengisian 6 digit akan lolos verifikasi.'
        : '  ^ PEMBACAAN MELESET - perbaiki countFilledPinDigits sebelum --tarik.'
    );
  }
  if (result.status === 'probe') {
    console.log(`Tujuan  : ${result.destination}`);
    console.log(`Nominal di form: ${formatRupiah(result.formAmount)}`);
    console.log(`Tombol konfirmasi yang akan ditekan: "${result.confirmLabel}"`);
    console.log('  ^ kalau teks ini bukan "Konfirmasi", JANGAN jalankan --tarik.');
  }
  if (result.matchedBy) {
    console.log(`Cocok via: ${result.matchedBy}`);
    if (/total saldo|saldo shopeepay/i.test(result.matchedBy)) {
      console.log('  ^ PERHATIAN: ini label longgar. Angkanya bisa memuat saldo');
      console.log('    tertahan / dalam proses, bukan murni yang bisa ditarik.');
    }
  }
}

main().catch((error) => {
  console.error(`\nGAGAL [${error.code || 'UNKNOWN'}] ${error.message}`);
  process.exitCode = 1;
});
