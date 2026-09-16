#!/usr/bin/env node
// Verifikasi alur Shopee tanpa menarik dana: login -> buka Saldo Saya -> baca
// nominal "saldo dapat ditarik", lalu berhenti.
//
// Ini yang dipakai untuk memperbaiki selektor di shopeeWithdrawClient.js.
// Jalankan dengan jendela terlihat saat pertama kali (login/OTP manual sekali):
//
//   SHOPEE_SELLER_HEADLESS=false node src/cli/shopeeSaldoCli.js
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
  const date = todayYmd();

  console.log(`Tanggal      : ${date}`);
  console.log(`Halaman saldo: ${config.balanceUrl}`);
  console.log(`Mode         : ${reallyWithdraw ? '*** TARIK DANA SUNGGUHAN ***' : 'dry run (dana tidak ditarik)'}`);

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
