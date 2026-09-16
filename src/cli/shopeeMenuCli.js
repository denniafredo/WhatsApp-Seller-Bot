#!/usr/bin/env node
// Temukan URL halaman "Saldo Saya" di Seller Centre, tanpa menebak.
//
// Dua cara sekaligus:
//   1. Sapu semua <a href> di halaman dan saring yang berbau keuangan.
//   2. Pantau perubahan URL selama beberapa menit - kamu klik sendiri sampai
//      halaman saldo terbuka, dan skrip mencetak URL persisnya.
//
// Cara kedua yang paling bisa dipercaya: menu Seller Centre banyak yang
// digerakkan JavaScript tanpa href sungguhan, jadi menyapu DOM saja bisa buta.
//
//   npm run cek:menu
require('dotenv').config();

const fs = require('fs');
const puppeteer = require('puppeteer');
const {
  PROFILE_DIR,
  config,
  detectLoginState,
  waitForUrlSettled,
} = require('../keuangan/shopeeWithdrawClient');

const HOME_URL = 'https://seller.shopee.co.id/';
const FINANCE_WORDS =
  /saldo|keuangan|finance|balance|wallet|penghasilan|income|rekening|penarikan|withdraw|dompet|pendapatan/i;

const watchMinutes = Math.min(
  Math.max(Number(process.argv.find((arg) => /^\d+$/.test(arg))) || 5, 1),
  30
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectLinks(page) {
  return page
    .evaluate(() => {
      const seen = new Map();
      document.querySelectorAll('a[href]').forEach((anchor) => {
        const href = anchor.href;
        const text = (anchor.innerText || anchor.textContent || '').trim().replace(/\s+/g, ' ');
        if (href && !seen.has(href)) {
          seen.set(href, text.slice(0, 60));
        }
      });
      return [...seen.entries()].map(([href, text]) => ({ href, text }));
    })
    .catch(() => []);
}

async function main() {
  if (!fs.existsSync(PROFILE_DIR)) {
    console.log(`Profil Chrome belum ada di ${PROFILE_DIR}.`);
    console.log('Jalankan dulu: SHOPEE_SELLER_HEADLESS=false npm run cek:saldo');
    return;
  }

  console.log(`Profil   : ${PROFILE_DIR}`);
  console.log(`Pantau   : ${watchMinutes} menit (ubah dengan: npm run cek:menu -- 10)`);
  console.log('');

  const browser = await puppeteer.launch({
    // Selalu terlihat: inti perintah ini adalah kamu mengeklik sendiri.
    headless: false,
    executablePath: config.chromePath,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.setViewport({ width: 1440, height: 1000 });

    console.log('Membuka Seller Centre...');
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await waitForUrlSettled(page);

    const state = await detectLoginState(page).catch(() => 'unknown');
    console.log(`Status   : ${state}`);
    console.log(`URL home : ${page.url()}`);

    if (state !== 'ready') {
      console.log('\nBelum masuk Seller Centre. Selesaikan login/verifikasi di jendela Chrome,');
      console.log('lalu biarkan skrip ini tetap berjalan - dia memantau URL-nya.');
    }

    const links = await collectLinks(page);
    const finance = links.filter(
      (link) => FINANCE_WORDS.test(link.href) || FINANCE_WORDS.test(link.text)
    );

    console.log(`\n--- Tautan berbau keuangan (${finance.length} dari ${links.length} tautan) ---`);
    if (!finance.length) {
      console.log('  (tidak ada — menunya kemungkinan digerakkan JavaScript tanpa href)');
    }
    finance.forEach((link) => console.log(`  ${link.href}\n      teks: "${link.text}"`));

    console.log(`\n--- Memantau perubahan URL selama ${watchMinutes} menit ---`);
    console.log('Klik sendiri di Chrome: menu keuangan -> Saldo Saya.');
    console.log('Setiap URL baru dicetak di bawah ini. Tekan Ctrl+C kalau sudah dapat.\n');

    const deadlineMs = Date.now() + watchMinutes * 60000;
    let lastUrl = page.url();
    const visited = [lastUrl];

    while (Date.now() < deadlineMs) {
      await sleep(500);

      let currentUrl;
      try {
        currentUrl = page.url();
      } catch (error) {
        break;
      }

      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        visited.push(currentUrl);
        const mark = FINANCE_WORDS.test(currentUrl) ? ' <-- berbau keuangan' : '';
        console.log(`  [${new Date().toLocaleTimeString('id-ID')}] ${currentUrl}${mark}`);
      }
    }

    console.log('\n--- Ringkasan URL yang dikunjungi ---');
    [...new Set(visited)].forEach((url) => console.log(`  ${url}`));
    console.log('\nSalin URL halaman saldo ke .env sebagai SHOPEE_SELLER_BALANCE_URL.');
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\nGAGAL [${error.code || 'UNKNOWN'}] ${error.message}`);
  process.exitCode = 1;
});
