// Otomasi Seller Centre Shopee. Alurnya, sesuai halaman aslinya:
//
//   /portal/finance/wallet/shopeepay  ("Saldo Penjual")
//     -> kadang popup kata sandi untuk MELIHAT saldo
//     -> baca label "Saldo" + nominalnya
//     -> [Tarik Dana] membuka HALAMAN BARU "Tarik Dana"
//          - pilihan tujuan: ShopeePay / rekening bank
//          - kolom "Jumlah Penarikan Dana" sudah terisi
//          - [Konfirmasi] -> POPUP PIN 6 DIGIT
//
// Kata sandi akun dan PIN penarikan adalah DUA hal berbeda:
// SHOPEE_SELLER_PASSWORD membuka halaman saldo, SHOPEE_SELLER_WITHDRAW_PIN
// menyelesaikan penarikan.
//
// Kenapa UI dan bukan API: modul Payment di Shopee Open API v2 hanya baca
// (get_wallet_transaction_list, get_payout_detail, get_escrow_list, ...). Tidak
// ada endpoint yang memulai penarikan, jadi penarikan wajib lewat halaman.
//
// Konsekuensinya: halaman ini memindahkan uang dan tidak punya kontrak versi.
// Pengaman berikut wajib ada, jangan dihapus saat memperbaiki selektor:
//   1. withdrawGuard   - satu penarikan berjalan pada satu waktu (proses ini).
//   2. state harian    - satu penarikan sukses per tanggal, disimpan di disk.
//   3. dry run         - verifikasi tanpa menyentuh tombol Tarik Dana.
//   4. cek tujuan      - tujuan terpilih harus cocok SHOPEE_SELLER_WITHDRAW_TO.
//   5. cek nominal     - isi kolom jumlah harus sama dengan saldo yang dibaca.
// Pengaman 4 dan 5 berhenti SEBELUM Konfirmasi ditekan, jadi saat keduanya
// gagal tidak ada apa pun yang terkirim.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'keuangan-state.json');
const PROFILE_DIR = path.join(DATA_DIR, 'shopee-seller-profile');

function readNumber(rawValue, fallback, min, max) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

const config = {
  balanceUrl:
    process.env.SHOPEE_SELLER_BALANCE_URL ||
    'https://seller.shopee.co.id/portal/finance/wallet/shopeepay',
  loginUrl: process.env.SHOPEE_SELLER_LOGIN_URL || 'https://seller.shopee.co.id/account/signin',
  username: process.env.SHOPEE_SELLER_USERNAME || '',
  password: process.env.SHOPEE_SELLER_PASSWORD || '',
  headless: process.env.SHOPEE_SELLER_HEADLESS !== 'false',
  chromePath: process.env.CHROME_PATH || undefined,
  navigationTimeoutMs: readNumber(process.env.SHOPEE_SELLER_NAV_TIMEOUT_MS, 60000, 5000, 300000),
  withdrawTimeoutMs: readNumber(
    process.env.SHOPEE_SELLER_WITHDRAW_TIMEOUT_MS,
    120000,
    10000,
    600000
  ),
  // 0 = tanpa batas. Di atas nol, saldo yang melebihi batas membatalkan
  // penarikan dan melapor, bukan diteruskan: nominal ganjil lebih mungkin salah
  // baca halaman daripada benar-benar ada.
  maxWithdraw: Math.max(Number(process.env.KEUANGAN_MAX_WITHDRAW) || 0, 0),
  dryRun: process.env.KEUANGAN_DRY_RUN === 'true',
  // PIN 6 digit konfirmasi penarikan. BUKAN kata sandi akun - Shopee memintanya
  // di popup terakhir. Kosong = penarikan berhenti di popup itu dan dilaporkan.
  withdrawPin: String(process.env.SHOPEE_SELLER_WITHDRAW_PIN || '').trim(),
  // Nama tujuan penarikan yang diharapkan (dicocokkan sebagai regex, mis.
  // "SeaBank"). Halaman Tarik Dana juga menawarkan ShopeePay, dan menarik ke
  // tujuan yang salah tidak bisa dibatalkan.
  withdrawTo: String(process.env.SHOPEE_SELLER_WITHDRAW_TO || '').trim(),
  // Jendela tunggu saat manusia menyelesaikan login/OTP sendiri di jendela yang
  // terlihat. Hanya dipakai kalau headless=false - bot tidak bisa membaca OTP.
  manualLoginTimeoutMs: readNumber(
    process.env.SHOPEE_SELLER_MANUAL_TIMEOUT_MS,
    300000,
    30000,
    1800000
  ),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Semua asumsi bentuk halaman ada di blok ini. Kalau alurnya rusak, yang perlu
// diedit adalah bagian ini, bukan logika di bawahnya. Jalankan dengan
// SHOPEE_SELLER_HEADLESS=false dan KEUANGAN_DRY_RUN=true saat memperbaikinya.
const selectors = {
  usernameField:
    'input[name="loginKey"], input[placeholder*="Email"], input[placeholder*="No. Handphone"], input[type="text"]',
  passwordField: 'input[type="password"], input[name="password"]',
  loginSubmitText: /^(log ?in|login|masuk|sign ?in)$/i,
  // Penanda bahwa halaman saldo benar-benar terbuka. Menu "Saldo Saya" bermuara
  // di /portal/finance/wallet/shopeepay, jadi judulnya bisa menyebut ShopeePay
  // dan bukan "Saldo Saya".
  balanceMarker: /saldo saya|saldo shopeepay|my balance|saldo penjual|shopeepay/i,
  // Label saldo yang bisa ditarik. Halaman ShopeePay memuat beberapa nominal
  // sekaligus (saldo tertahan, dalam proses penarikan), jadi nominalnya diambil
  // relatif ke label - bukan "angka Rupiah pertama di halaman".
  //
  // URUTAN INI PENTING dan bukan sekadar daftar alternatif: dicoba dari yang
  // paling eksplisit ke yang paling longgar. Kalau digabung jadi satu regex,
  // yang menang adalah label yang posisinya paling atas di halaman - sehingga
  // "Total Saldo" (yang bisa memuat dana tertahan) berpeluang mengalahkan
  // "Saldo dapat ditarik". Untuk angka uang, itu tidak boleh terjadi.
  // Halaman "Saldo Penjual" yang sebenarnya memakai label sependek "Saldo",
  // di kartu "Informasi Saldo" tepat di samping tombol Tarik Dana. Karena kata
  // itu terlalu umum, pencocokannya BARIS PERSIS (^saldo$) - bukan "mengandung
  // kata saldo", yang akan ikut menyambar "Informasi Saldo", "Saldo Tertahan",
  // atau "Total Saldo".
  withdrawableLabels: [
    /saldo (yang )?(dapat|bisa) ditarik/i,
    /dana (yang )?(dapat|bisa) ditarik/i,
    /available balance|withdrawable/i,
    /saldo tersedia/i,
    /^saldo$/i,
    /^balance$/i,
    /saldo shopeepay/i,
    /total saldo/i,
  ],
  // Halaman Saldo Saya terkunci: password akun harus dimasukkan untuk MELIHAT
  // saldo, terpisah dari konfirmasi saat menarik dana.
  passwordGateMarker:
    /masukkan (kata sandi|password)|verifikasi kata sandi|konfirmasi kata sandi|enter your password|masukkan sandi/i,
  passwordGateSubmitText: /^(konfirmasi|lanjut|lanjutkan|kirim|submit|confirm|ok|verifikasi|masuk)$/i,
  withdrawButtonText: /^(tarik dana|tarik saldo|withdraw|withdrawal)$/i,
  // Penanda halaman form Tarik Dana (halaman baru, bukan popup).
  withdrawFormMarker: /jumlah penarikan dana|withdrawal amount|tarik dana ke/i,
  // Popup PIN 6 digit setelah Konfirmasi. PIN ini BUKAN kata sandi akun.
  //
  // \bpin\b WAJIB pakai batas kata: halaman saldo memuat "SPinjam Untuk
  // Penjual", dan /pin/ polos akan cocok di dalam kata itu - membuat bot
  // mengira popup PIN sudah muncul padahal masih di halaman saldo.
  pinMarker: /\bpin\b|masukkan pin|kode pin|6 digit/i,
  pinRejected: /pin (yang anda masukkan )?(salah|tidak (valid|benar))|incorrect pin|wrong pin/i,
  confirmButtonText: /^(konfirmasi|lanjut|lanjutkan|kirim|submit|confirm|ya|tarik dana)$/i,
  successMarker: /berhasil|sukses|success|permintaan penarikan (anda )?(telah )?(di)?terima/i,
  // Login Shopee sering pindah ke verifikasi OTP; ini harus dikenali supaya bot
  // berhenti dengan pesan jelas, bukan menunggu sampai timeout.
  otpMarker:
    /kode verifikasi|verification code|verifikasi via|otp|tautan verifikasi|whatsapp untuk verifikasi/i,
  captchaMarker: /captcha|puzzle|geser untuk|slide to verify|verifikasi keamanan/i,
  loginRejected: /kata sandi salah|password (is )?(incorrect|wrong)|akun tidak ditemukan|invalid/i,
  passwordRejected: /kata sandi salah|password salah|incorrect password/i,
};

class ShopeeWithdrawError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShopeeWithdrawError';
    this.code = code;
  }
}

// ---- State harian --------------------------------------------------------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) || {};
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read keuangan state:', error.message);
    }
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getWithdrawRecord(date) {
  const state = loadState();
  return state.withdrawals?.[date] || null;
}

function putWithdrawRecord(date, record) {
  const state = loadState();
  state.withdrawals = { ...(state.withdrawals || {}), [date]: record };
  saveState(state);
}

// ---- Pengaman satu-penarikan-sekaligus -----------------------------------

let withdrawGuard = Promise.resolve();

function runExclusively(task) {
  const result = withdrawGuard.then(task, task);
  // Rantai penjaga tidak boleh ikut gagal, kalau tidak semua panggilan
  // berikutnya akan menolak sendiri tanpa pernah menjalankan task.
  withdrawGuard = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// ---- Bantuan halaman -----------------------------------------------------

// Seller Centre melakukan redirect sisi-klien sendiri. Kalau itu terjadi saat
// page.evaluate / page.$ sedang berjalan, Chrome menghancurkan execution
// context dan Puppeteer melempar "Cannot find context with specified id" atau
// "Execution context was destroyed" - bukan kesalahan halaman, cuma soal
// waktu. Semua pembacaan halaman karena itu lewat withPageRetry.
function isContextError(error) {
  return /Cannot find context|Execution context was destroyed|Cannot find object with id|Target closed|detached Frame/i.test(
    String((error && error.message) || '')
  );
}

async function withPageRetry(task, { attempts = 4, delayMs = 800 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isContextError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(delayMs);
    }
  }

  throw lastError;
}

// Tunggu sampai URL berhenti berubah, supaya halaman tidak diperiksa di tengah
// rantai redirect. Tanpa ini, pemeriksaan pertama hampir selalu jatuh di celah
// antara balance-url dan halaman signin.
async function waitForUrlSettled(page, { quietMs = 1500, timeoutMs = 20000 } = {}) {
  const deadlineMs = Date.now() + timeoutMs;
  let lastUrl = page.url();
  let stableSinceMs = Date.now();

  while (Date.now() < deadlineMs) {
    await sleep(300);
    const currentUrl = page.url();

    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      stableSinceMs = Date.now();
      continue;
    }

    if (Date.now() - stableSinceMs >= quietMs) {
      return currentUrl;
    }
  }

  return page.url();
}

function readPageText(page) {
  return withPageRetry(() =>
    page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '))
  );
}

function hasPasswordField(page) {
  return withPageRetry(async () => Boolean(await page.$(selectors.passwordField)));
}

// Klik elemen terdalam yang teksnya cocok. Shopee membungkus tombol dalam
// beberapa div; klik pada pembungkus tidak memicu handler anaknya.
function clickByText(page, pattern, scopeAttribute) {
  return page.evaluate(
    (source, flags, scopeAttr) => {
      const root = scopeAttr ? document.querySelector(`[${scopeAttr}]`) : document;
      if (!root) {
        return null;
      }

      const expression = new RegExp(source, flags);
      const matches = [
        ...root.querySelectorAll('button, a, [role="button"], div, span, label'),
      ].filter((element) => {
        const text = (element.innerText || '').trim();
        if (!text || text.length > 40 || !expression.test(text)) {
          return false;
        }
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
          return false;
        }
        const box = element.getBoundingClientRect();
        return box.width >= 5 && box.height >= 5;
      });

      if (!matches.length) {
        return null;
      }

      const innermost = matches.filter(
        (element) => !matches.some((other) => other !== element && element.contains(other))
      );
      const target = innermost[0] || matches[matches.length - 1];
      target.click();

      return (target.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    },
    pattern.source,
    pattern.flags.replace('g', ''),
    scopeAttribute || null
  );
}

// "Rp1.234.567" -> 1234567. Hanya titik yang dipakai sebagai pemisah ribuan;
// koma di Seller Centre adalah desimal dan dibuang bersama sennya.
function parseRupiah(rawText) {
  const text = String(rawText || '');
  const match = text.match(/rp\s*\.?\s*([\d.]+)(?:,(\d+))?/i);
  if (!match) {
    return null;
  }

  // Nominal bersatuan kata ("Rp1.5 Milyar") bukan angka utuh: digitnya saja
  // terbaca 15, salah 8 digit. Halaman saldo memuat iklan SPinjam berbunyi
  // "dana tunai hingga Rp1.5 Milyar!", jadi bentuk ini harus ditolak - bukan
  // dikira-kira, karena ini jalur uang.
  const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 12);
  if (/^\s*(milyar|miliar|juta|ribu|rb|jt|k\b|m\b|b\b)/i.test(tail)) {
    return null;
  }

  const digits = match[1].replace(/\./g, '');
  if (!digits) {
    return null;
  }

  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

// Cari nominal yang paling dekat setelah label "saldo dapat ditarik". Halaman
// saldo memuat beberapa angka rupiah; mengambil yang pertama di halaman salah.
function readWithdrawableBalance(page, labelPattern) {
  return page.evaluate(
    (source, flags) => {
      const expression = new RegExp(source, flags);
      const text = (document.body?.innerText || '').replace(/ /g, ' ');
      const lines = text.split('\n').map((line) => line.trim());

      for (let index = 0; index < lines.length; index += 1) {
        if (!expression.test(lines[index])) {
          continue;
        }

        // Nominal bisa berada di baris label itu sendiri atau beberapa baris
        // sesudahnya, tergantung lebar layar saat render.
        for (let offset = 0; offset <= 3 && index + offset < lines.length; offset += 1) {
          const candidate = lines[index + offset];
          if (/rp\s*\.?\s*[\d.]/i.test(candidate)) {
            return { line: lines[index], valueLine: candidate };
          }
        }
      }

      return null;
    },
    labelPattern.source,
    labelPattern.flags.replace('g', '')
  );
}

function formatRupiah(amount) {
  return `Rp${Number(amount || 0).toLocaleString('id-ID')}`;
}

// ---- Navigasi ------------------------------------------------------------

// Seller Centre adalah SPA yang kerap melakukan redirect sendiri (terutama
// sesaat setelah login). Kalau page.goto kebetulan jalan bersamaan dengan
// redirect itu, Chrome membatalkan navigasi kita dengan net::ERR_ABORTED -
// padahal halamannya sering tetap sampai ke tujuan. Jadi: coba ulang, dan
// sebelum menyerah periksa apakah kita sudah berada di tempat yang benar.
//
// waitUntil sengaja 'domcontentloaded', bukan 'networkidle2': dasbor Shopee
// terus melakukan polling, jadi jaringannya praktis tidak pernah idle.
async function gotoStable(page, url, { attempts = 3 } = {}) {
  const target = new URL(url);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
      });
      return;
    } catch (error) {
      const message = String(error.message || '');
      const interrupted = /ERR_ABORTED|ERR_NETWORK_CHANGED|interrupted|Navigation/i.test(message);

      // Sudah mendarat di path yang dituju walau navigasinya dibatalkan.
      if (page.url().includes(target.pathname)) {
        return;
      }

      if (!interrupted || attempt === attempts) {
        throw new ShopeeWithdrawError(
          'NAVIGATION_FAILED',
          `Gagal membuka ${url}: ${message}`
        );
      }

      await sleep(2000);
    }
  }
}

// ---- Login ---------------------------------------------------------------

function isOnLoginPage(page) {
  return /\/account\/(signin|login)/i.test(page.url());
}

// Shopee melempar beberapa jenis tantangan di host yang BERBEDA dari Seller
// Centre, misalnya shopee.co.id/verify/ivs (Identity Verification Service).
function isOnVerificationPage(page) {
  return /\/verify(\/|\?|$)|\/account\/verify|ivs/i.test(page.url());
}

// "Sudah login" harus DIBUKTIKAN, bukan disimpulkan dari ketiadaan tanda-tanda
// login. Versi sebelumnya memakai 'ready' sebagai nilai default, sehingga
// halaman verifikasi IVS - yang tidak punya kolom password dan URL-nya bukan
// /account/signin - lolos sebagai sukses, lalu navigasi berikutnya terpantul
// kembali ke tantangan itu.
// Sudah berada di Seller Centre (host seller.shopee.*) dan bukan di halaman
// login/verifikasi. Sengaja TIDAK mensyaratkan path /portal: URL saldo yang
// salah mendarat di seller.shopee.co.id/404, dan itu artinya sesi kita sehat
// tapi URL-nya keliru - dua masalah berbeda yang harus dilaporkan berbeda.
function isOnSellerPortal(page) {
  try {
    const url = new URL(page.url());
    return (
      /(^|\.)seller\.shopee\./i.test(url.hostname) &&
      !/\/account\/(signin|login|verify)/i.test(url.pathname)
    );
  } catch (error) {
    return false;
  }
}

/**
 * @returns 'ready' | 'otp' | 'captcha' | 'verify' | 'login' | 'unknown'
 *          Hanya 'ready' yang boleh dianggap sudah login.
 */
async function detectLoginState(page) {
  // Portal diperiksa lebih dulu: halaman saldo memuat kata "verifikasi" di
  // footer/bantuan, dan itu tidak boleh membatalkan status sukses.
  if (isOnSellerPortal(page)) {
    return 'ready';
  }

  if (isOnVerificationPage(page)) {
    return 'verify';
  }

  const text = await readPageText(page);

  if (selectors.otpMarker.test(text)) {
    return 'otp';
  }
  if (selectors.captchaMarker.test(text)) {
    return 'captcha';
  }
  if (isOnLoginPage(page) || (await hasPasswordField(page))) {
    return 'login';
  }

  return 'unknown';
}

// Petunjuk per jenis tantangan.
//
// Soal 'verify' (halaman shopee.co.id/verify/ivs): sebagian akun hanya diberi
// opsi "Verifikasi melalui link", tanpa pilihan kode sama sekali. Yang
// menentukan berhasil atau tidak adalah DI MANA link itu dibuka - verifikasi
// menempel pada sesi browser yang membukanya. Kalau dibuka di browser harian,
// yang terverifikasi adalah sesi itu, bukan profil Chrome milik bot, dan kita
// terpantul kembali ke login. Jadi: salin linknya, tempel ke address bar
// jendela Chrome yang dibuka skrip ini.
const MANUAL_HINTS = {
  login: 'Masukkan email/nomor dan kata sandi di jendela Chrome...',
  otp: 'Shopee minta kode verifikasi - masukkan kodenya di jendela Chrome...',
  captcha: 'Shopee minta verifikasi keamanan - selesaikan di jendela Chrome...',
  verify:
    'Shopee minta verifikasi identitas. Kalau hanya ada opsi "Verifikasi melalui link": ' +
    'tekan tombolnya, lalu SALIN link dari email/WhatsApp dan TEMPEL ke address bar ' +
    'jendela Chrome ini. Membukanya di browser biasa tidak berpengaruh - ' +
    'verifikasinya menempel ke sesi browser yang membuka link itu.',
  unknown: 'Menunggu halaman Seller Centre terbuka...',
};

// Tunggu manusia menyelesaikan login/OTP di jendela yang terlihat. Hanya masuk
// akal kalau headless=false; bot tidak punya cara membaca kode OTP.
async function waitForManualLogin(page, onProgress, timeoutMs) {
  const deadlineMs = Date.now() + timeoutMs;
  let lastState = '';

  await onProgress(
    `Selesaikan login/OTP di jendela Chrome yang terbuka (batas ${Math.round(timeoutMs / 60000)} menit)...`
  );

  while (Date.now() < deadlineMs) {
    const state = await detectLoginState(page).catch(() => 'login');

    if (state === 'ready') {
      // Login manual memicu redirect ke dasbor; tunggu selesai supaya navigasi
      // berikutnya tidak dibatalkan di tengah jalan.
      await waitForUrlSettled(page);
      return true;
    }

    if (state !== lastState) {
      lastState = state;
      await onProgress(MANUAL_HINTS[state] || MANUAL_HINTS.unknown);
    }

    await sleep(2000);
  }

  return false;
}

async function ensureLogin(page, onProgress) {
  await onProgress('Membuka Seller Centre Shopee...');
  await gotoStable(page, config.balanceUrl);
  // Shopee memantulkan kita ke halaman signin lewat redirect sisi-klien, jadi
  // pemeriksaan harus menunggu rantai redirect itu selesai dulu.
  await waitForUrlSettled(page);

  if ((await detectLoginState(page)) === 'ready') {
    return;
  }

  // Jendela terlihat: jangan berebut dengan manusia. Mengisi dan men-submit
  // form sementara pemilik akun sedang login manual membuat kedua pihak saling
  // membatalkan - itu yang memunculkan ERR_ABORTED pada percobaan pertama.
  if (!config.headless) {
    if (await waitForManualLogin(page, onProgress, config.manualLoginTimeoutMs)) {
      console.log('Login Shopee selesai secara manual; sesi disimpan di', PROFILE_DIR);
      return;
    }

    throw new ShopeeWithdrawError(
      'LOGIN_TIMEOUT',
      `Login belum selesai dalam ${Math.round(config.manualLoginTimeoutMs / 60000)} menit. ` +
        'Jalankan ulang dan selesaikan login di jendela Chrome yang terbuka.'
    );
  }

  if (!config.username || !config.password) {
    throw new ShopeeWithdrawError(
      'NO_CREDENTIALS',
      'SHOPEE_SELLER_USERNAME dan SHOPEE_SELLER_PASSWORD belum diisi di .env.'
    );
  }

  await onProgress('Login ke Shopee...');

  const usernameField = await page
    .waitForSelector(selectors.usernameField, { visible: true, timeout: 25000 })
    .catch(() => null);

  if (!usernameField) {
    const text = await readPageText(page);
    throw new ShopeeWithdrawError(
      'LOGIN_FAILED',
      selectors.captchaMarker.test(text)
        ? 'Shopee menampilkan verifikasi keamanan (captcha). Login manual sekali dengan SHOPEE_SELLER_HEADLESS=false.'
        : 'Form login Shopee tidak muncul. Tampilan halamannya kemungkinan berubah.'
    );
  }

  await usernameField.click({ clickCount: 3 });
  await usernameField.type(config.username, { delay: 40 });

  const passwordField = await page.$(selectors.passwordField);
  if (!passwordField) {
    throw new ShopeeWithdrawError('LOGIN_FAILED', 'Kolom password tidak ada di form login Shopee.');
  }

  await passwordField.click({ clickCount: 3 });
  await passwordField.type(config.password, { delay: 40 });

  if (!(await clickByText(page, selectors.loginSubmitText))) {
    await passwordField.press('Enter');
  }

  const deadlineMs = Date.now() + 45000;
  let state = 'login';

  while (Date.now() < deadlineMs) {
    state = await detectLoginState(page).catch(() => 'login');
    if (state !== 'login') {
      break;
    }
    await sleep(1500);
  }

  if (state === 'otp') {
    throw new ShopeeWithdrawError(
      'OTP_REQUIRED',
      'Shopee minta kode verifikasi (OTP) dan bot tidak bisa membacanya. ' +
        'Jalankan sekali dengan SHOPEE_SELLER_HEADLESS=false lalu login manual - ' +
        'sesinya disimpan di data/shopee-seller-profile dan dipakai untuk run berikutnya.'
    );
  }

  if (state === 'captcha') {
    throw new ShopeeWithdrawError(
      'CAPTCHA_REQUIRED',
      'Shopee menampilkan verifikasi keamanan. Login manual sekali dengan SHOPEE_SELLER_HEADLESS=false.'
    );
  }

  if (state !== 'ready') {
    const text = await readPageText(page);
    throw new ShopeeWithdrawError(
      'LOGIN_FAILED',
      selectors.loginRejected.test(text)
        ? 'Login Shopee ditolak. Periksa SHOPEE_SELLER_USERNAME dan SHOPEE_SELLER_PASSWORD.'
        : 'Login Shopee tidak selesai dalam 45 detik.'
    );
  }
}

// ---- Saldo ---------------------------------------------------------------

// Cari label saldo + nominalnya, urut dari label paling eksplisit.
// Mengembalikan null kalau tidak ada yang punya angka Rupiah yang sah.
async function findBalanceOnPage(page) {
  for (const pattern of selectors.withdrawableLabels) {
    // eslint-disable-next-line no-await-in-loop
    const found = await readWithdrawableBalance(page, pattern).catch(() => null);
    if (found && parseRupiah(found.valueLine) !== null) {
      return { found, pattern };
    }
  }

  return null;
}

// Syarat "halaman saldo siap" adalah NOMINALNYA TERBACA - bukan judul halaman
// yang cocok. Judul "Saldo Penjual" tetap ada di latar belakang walau popup
// kata sandi menutupinya, jadi memakai penanda teks membuat halaman terkunci
// lolos sebagai siap, dan saldonya lalu terbaca kosong.
async function waitForBalanceReadable(page, timeoutMs) {
  const deadlineMs = Date.now() + timeoutMs;

  while (Date.now() < deadlineMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await findBalanceOnPage(page)) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }

  return false;
}

// Lewati gerbang password di halaman Saldo Saya. Ini HANYA untuk melihat
// saldo - bukan konfirmasi penarikan - jadi tetap dijalankan di mode dry run.
async function passPasswordGate(page, onProgress) {
  const field = await withPageRetry(async () => page.$(selectors.passwordField)).catch(() => null);

  if (!field) {
    return false;
  }

  if (!config.password) {
    throw new ShopeeWithdrawError(
      'NO_CREDENTIALS',
      'Halaman Saldo Saya minta kata sandi, tapi SHOPEE_SELLER_PASSWORD belum diisi di .env.'
    );
  }

  await onProgress('Halaman saldo terkunci, memasukkan kata sandi...');

  await field.click({ clickCount: 3 }).catch(() => {});
  await field.type(config.password, { delay: 40 });

  if (!(await clickByText(page, selectors.passwordGateSubmitText))) {
    await field.press('Enter');
  }

  const opened = await waitForBalanceReadable(page, 30000);

  if (!opened) {
    const text = await readPageText(page).catch(() => '');
    if (selectors.passwordRejected.test(text)) {
      throw new ShopeeWithdrawError(
        'BALANCE_PASSWORD_REJECTED',
        'Kata sandi untuk membuka halaman Saldo Saya ditolak. Periksa SHOPEE_SELLER_PASSWORD.'
      );
    }
  }

  return opened;
}

async function openBalancePage(page, onProgress) {
  await onProgress('Membuka Saldo Saya...');

  const balancePath = new URL(config.balanceUrl).pathname;

  // Shopee bisa memantulkan kita ke tantangan verifikasi justru SETELAH login
  // berhasil, saat halaman keuangan diminta. Jadi tahap ini butuh putaran
  // sendiri: navigasi -> kalau terpantul, tunggu manusia menyelesaikan -> ulangi.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!page.url().includes(balancePath)) {
      // Redirect Shopee bisa masih berjalan; beri jeda supaya tidak bentrok.
      await sleep(1500);
      await gotoStable(page, config.balanceUrl);
    }

    await waitForUrlSettled(page);

    const state = await detectLoginState(page).catch(() => 'unknown');

    // Gerbang kata sandi diperiksa SEBELUM menunggu nominal, dan hanya saat
    // kita memang sudah di Seller Centre (kolom password di halaman signin
    // bukan gerbang - itu login biasa). Popupnya duduk di atas halaman yang
    // judulnya sudah benar, jadi urutan sebaliknya membuat halaman terkunci
    // dikira siap dan saldonya terbaca kosong.
    if (state === 'ready' && (await hasPasswordField(page).catch(() => false))) {
      if (await passPasswordGate(page, onProgress)) {
        return;
      }

      // Teks tombol popupnya belum terverifikasi terhadap semua varian, jadi
      // pengisian otomatis bisa gagal walau kata sandinya benar. Di jendela
      // terlihat, serahkan ke manusia daripada menyerah.
      if (!config.headless) {
        await onProgress('Popup kata sandi belum tertembus - isi manual di jendela Chrome...');
        if (await waitForBalanceReadable(page, config.manualLoginTimeoutMs)) {
          return;
        }
      }
    }

    if (await waitForBalanceReadable(page, 30000)) {
      return;
    }

    if (state === 'ready') {
      // Sudah di Seller Centre, tidak ada gerbang password, tapi nominalnya
      // tetap tidak terbaca - berarti URL atau labelnya yang keliru, bukan sesi.
      break;
    }

    if (!config.headless && attempt < 3) {
      await onProgress(
        `Shopee minta verifikasi lagi sebelum membuka halaman keuangan (percobaan ${attempt}/3)...`
      );
      if (await waitForManualLogin(page, onProgress, config.manualLoginTimeoutMs)) {
        continue;
      }
    }

    if (state === 'verify' || state === 'otp' || state === 'captcha') {
      throw new ShopeeWithdrawError(
        'VERIFICATION_REQUIRED',
        `Shopee meminta verifikasi identitas di ${page.url()} dan belum diselesaikan. ` +
          'Jalankan ulang dengan SHOPEE_SELLER_HEADLESS=false. Kalau Shopee hanya memberi ' +
          'opsi "Verifikasi melalui link", salin link dari email/WhatsApp lalu tempel ke ' +
          'address bar jendela Chrome yang dibuka skrip - bukan di browser biasa.'
      );
    }

    if (state === 'login' || isOnLoginPage(page)) {
      throw new ShopeeWithdrawError(
        'SESSION_EXPIRED',
        'Sesi Shopee sudah habis. Jalankan ulang dengan SHOPEE_SELLER_HEADLESS=false dan login manual.'
      );
    }
  }

  throw new ShopeeWithdrawError(
    'BALANCE_PAGE_FAILED',
    `Halaman Saldo Saya tidak terbaca di ${page.url()}. Cek SHOPEE_SELLER_BALANCE_URL.`
  );
}

// Kumpulkan setiap baris ber-Rupiah beserta baris di atasnya. Dipakai saat
// label saldo tidak ketemu: tanpa ini, memperbaiki selektor jadi tebak-tebakan
// dan butuh satu run penuh per tebakan.
function dumpMoneyLines(page, limit = 12) {
  return page
    .evaluate((max) => {
      const lines = (document.body?.innerText || '')
        .replace(/ /g, ' ')
        .split('\n')
        .map((line) => line.trim());

      const out = [];
      lines.forEach((line, index) => {
        if (out.length < max && /rp\s*\.?\s*[\d.]/i.test(line)) {
          out.push(`${lines[index - 1] || '(tanpa label)'} => ${line}`);
        }
      });
      return out;
    }, limit)
    .catch(() => []);
}

async function readBalance(page) {
  const hit = await findBalanceOnPage(page);

  if (!hit) {
    const candidates = await dumpMoneyLines(page);
    const locked = await hasPasswordField(page).catch(() => false);

    throw new ShopeeWithdrawError(
      'BALANCE_NOT_FOUND',
      [
        locked
          ? 'Halaman saldo masih terkunci kata sandi, nominalnya belum tampil.'
          : 'Label saldo tidak ditemukan di halaman.',
        'Nominal yang ADA di halaman:',
        ...(candidates.length
          ? candidates.map((line) => `  - ${line}`)
          : ['  (tidak ada angka Rupiah sama sekali)']),
        locked
          ? 'Periksa SHOPEE_SELLER_PASSWORD, atau isi popupnya manual dengan SHOPEE_SELLER_HEADLESS=false.'
          : 'Pilih label yang benar lalu tambahkan ke selectors.withdrawableLabels.',
      ].join('\n')
    );
  }

  return {
    amount: parseRupiah(hit.found.valueLine),
    label: hit.found.line,
    rawValue: hit.found.valueLine.trim(),
    // Dilaporkan supaya bisa dicek mata: kalau yang cocok ternyata label
    // longgar seperti /total saldo/, angkanya mungkin memuat dana tertahan.
    matchedBy: String(hit.pattern),
  };
}

// ---- Penarikan ----------------------------------------------------------

// Alur Tarik Dana yang sebenarnya, diverifikasi terhadap halaman asli:
//
//   Saldo Penjual -> [Tarik Dana] -> HALAMAN BARU "Tarik Dana"
//     - "Tarik Dana ke"        : pilihan ShopeePay / rekening bank (bank terpilih)
//     - "Jumlah Penarikan Dana": input, sudah terisi nominal saldo
//     - "Biaya transaksi"      : Rp0
//     - [Konfirmasi]           -> POPUP PIN 6 DIGIT
//
// PIN 6 digit itu BUKAN kata sandi akun, jadi butuh env sendiri.
// Tanpa PIN, penarikan berhenti di popup dan dilaporkan apa adanya.

// Baca nominal di kolom "Jumlah Penarikan Dana".
function readWithdrawAmountField(page) {
  return page
    .evaluate(() => {
      const inputs = [...document.querySelectorAll('input')];
      for (const input of inputs) {
        const digits = String(input.value || '').replace(/[^\d]/g, '');
        if (digits) {
          return digits;
        }
      }
      return '';
    })
    .catch(() => '');
}

// Nama tujuan penarikan yang sedang terpilih (radio aktif).
function readSelectedDestination(page) {
  return page
    .evaluate(() => {
      const checked = [...document.querySelectorAll('input[type="radio"]')].find((r) => r.checked);
      if (!checked) {
        return '';
      }

      // Label tujuan ada di kartu pembungkus radionya, bukan di radio itu.
      let scope = checked.parentElement;
      let hops = 0;
      while (scope && hops < 8) {
        const text = (scope.innerText || '').trim().replace(/\s+/g, ' ');
        if (text.length > 8) {
          return text.slice(0, 160);
        }
        scope = scope.parentElement;
        hops += 1;
      }
      return '';
    })
    .catch(() => '');
}

// Isi PIN. Shopee bisa memakai satu kolom atau enam kotak terpisah, jadi
// keduanya ditangani: kalau kotaknya banyak, digitnya disebar satu-satu.
async function fillWithdrawPin(page, pin) {
  const boxes = await page.$$('input[type="password"], input[type="tel"], input[inputmode="numeric"]');

  if (!boxes.length) {
    return false;
  }

  if (boxes.length >= pin.length) {
    for (let index = 0; index < pin.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await boxes[index].type(pin[index], { delay: 60 });
    }
    return true;
  }

  await boxes[0].click({ clickCount: 3 }).catch(() => {});
  await boxes[0].type(pin, { delay: 60 });
  return true;
}

async function performWithdraw(page, onProgress, expectedAmount) {
  await onProgress('Menekan Tarik Dana...');

  if (!(await clickByText(page, selectors.withdrawButtonText))) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_BUTTON_MISSING',
      'Tombol "Tarik Dana" tidak ditemukan di halaman saldo.'
    );
  }

  // Tarik Dana membuka halaman baru, bukan popup di halaman saldo.
  await waitForUrlSettled(page);

  const onFormPage = await withPageRetry(() =>
    page
      .waitForFunction(
        (marker) =>
          new RegExp(marker, 'i').test((document.body?.innerText || '').replace(/\s+/g, ' ')),
        { timeout: 30000 },
        selectors.withdrawFormMarker.source
      )
      .then(() => true)
  ).catch(() => false);

  if (!onFormPage) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_FORM_MISSING',
      `Halaman "Tarik Dana" tidak terbuka setelah tombolnya ditekan (sekarang di ${page.url()}).`
    );
  }

  // --- Pengaman 1: tujuan penarikan ---
  // Halaman ini menawarkan ShopeePay DAN rekening bank. Menarik ke tujuan yang
  // salah tidak bisa dibatalkan, jadi tujuan terpilih harus cocok dengan yang
  // diharapkan - kalau tidak, berhenti dan lapor.
  const destination = await readSelectedDestination(page);

  if (!destination) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_DESTINATION_UNKNOWN',
      'Tujuan penarikan tidak terbaca di halaman Tarik Dana. Penarikan dibatalkan.'
    );
  }

  if (config.withdrawTo && !new RegExp(config.withdrawTo, 'i').test(destination)) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_DESTINATION_MISMATCH',
      `Tujuan penarikan terpilih "${destination}" tidak cocok dengan SHOPEE_SELLER_WITHDRAW_TO ` +
        `("${config.withdrawTo}"). Penarikan dibatalkan supaya dana tidak masuk ke tujuan yang salah.`
    );
  }

  // --- Pengaman 2: nominal ---
  // Kolom jumlah sudah terisi Shopee. Kalau isinya berbeda dari saldo yang kita
  // baca, salah satu dari keduanya keliru - dan menebak di jalur uang tidak
  // boleh, jadi berhenti.
  const fieldDigits = await readWithdrawAmountField(page);
  const fieldAmount = Number(fieldDigits);

  if (!fieldDigits || !Number.isFinite(fieldAmount)) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_AMOUNT_UNREADABLE',
      'Nominal di kolom "Jumlah Penarikan Dana" tidak terbaca. Penarikan dibatalkan.'
    );
  }

  if (Number.isFinite(expectedAmount) && fieldAmount !== expectedAmount) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_AMOUNT_MISMATCH',
      `Nominal di form (${formatRupiah(fieldAmount)}) berbeda dari saldo yang dibaca ` +
        `(${formatRupiah(expectedAmount)}). Penarikan dibatalkan - cek manual di Seller Centre.`
    );
  }

  await onProgress(`Mengonfirmasi penarikan ${formatRupiah(fieldAmount)} ke ${destination.slice(0, 40)}...`);

  if (!(await clickByText(page, selectors.confirmButtonText))) {
    throw new ShopeeWithdrawError(
      'WITHDRAW_CONFIRM_MISSING',
      'Tombol "Konfirmasi" tidak ditemukan di halaman Tarik Dana.'
    );
  }

  // --- PIN 6 digit ---
  await onProgress('Memasukkan PIN penarikan...');

  const pinAppeared = await page
    .waitForFunction(
      (marker) =>
        new RegExp(marker, 'i').test((document.body?.innerText || '').replace(/\s+/g, ' ')),
      { timeout: 20000 },
      selectors.pinMarker.source
    )
    .then(() => true)
    .catch(() => false);

  if (pinAppeared || !config.withdrawPin) {
    if (!config.withdrawPin) {
      throw new ShopeeWithdrawError(
        'WITHDRAW_PIN_REQUIRED',
        'Shopee minta PIN 6 digit untuk menyelesaikan penarikan, tapi SHOPEE_SELLER_WITHDRAW_PIN ' +
          'belum diisi. Penarikan BELUM selesai dan menunggu di popup PIN - selesaikan manual ' +
          'di Seller Centre, atau isi PIN-nya di .env kalau mau otomatis.'
      );
    }

    if (!/^\d{4,8}$/.test(config.withdrawPin)) {
      throw new ShopeeWithdrawError(
        'WITHDRAW_PIN_INVALID',
        'SHOPEE_SELLER_WITHDRAW_PIN harus berupa angka (biasanya 6 digit).'
      );
    }

    if (!(await fillWithdrawPin(page, config.withdrawPin))) {
      throw new ShopeeWithdrawError(
        'WITHDRAW_PIN_MISSING',
        'Popup PIN muncul tapi kolom PIN-nya tidak ditemukan. Penarikan BELUM selesai - ' +
          'selesaikan manual di Seller Centre.'
      );
    }

    // Sebagian popup PIN mengirim sendiri begitu digit terakhir masuk; kalau
    // tidak, tombol konfirmasinya ditekan.
    await sleep(1200);
    await clickByText(page, selectors.confirmButtonText);
  }

  await onProgress('Menunggu konfirmasi Shopee...');

  const deadlineMs = Date.now() + config.withdrawTimeoutMs;
  while (Date.now() < deadlineMs) {
    // eslint-disable-next-line no-await-in-loop
    const text = await readPageText(page).catch(() => '');

    if (selectors.successMarker.test(text)) {
      return { successText: text.slice(0, 400), amount: fieldAmount, destination };
    }

    if (selectors.pinRejected.test(text)) {
      throw new ShopeeWithdrawError(
        'WITHDRAW_PIN_REJECTED',
        'PIN penarikan ditolak Shopee. Tidak ada dana yang ditarik. Periksa SHOPEE_SELLER_WITHDRAW_PIN.'
      );
    }

    if (selectors.otpMarker.test(text)) {
      throw new ShopeeWithdrawError(
        'WITHDRAW_OTP_REQUIRED',
        'Shopee minta OTP untuk penarikan ini dan bot tidak bisa membacanya. ' +
          'Penarikan BELUM selesai - teruskan manual di Seller Centre.'
      );
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(2000);
  }

  // Timeout bukan berarti gagal - permintaan bisa sudah terkirim. State harian
  // tidak ditandai sukses, jadi pesan ini harus menyuruh cek manual, bukan
  // menyuruh mengulang perintah.
  throw new ShopeeWithdrawError(
    'WITHDRAW_UNCONFIRMED',
    `Tidak ada konfirmasi sukses setelah ${Math.round(config.withdrawTimeoutMs / 1000)} detik. ` +
      'JANGAN ulangi perintah sebelum cek manual di Seller Centre - penarikannya mungkin sudah terkirim.'
  );
}

/**
 * Tarik saldo Shopee sekali untuk satu tanggal, lalu kembalikan nominalnya.
 *
 * @param options { date: 'YYYY-MM-DD', onProgress, dryRun, force }
 * @returns { amount, status, label, rawValue, alreadyDone }
 *          status: 'withdrawn' | 'reused' | 'dry-run' | 'zero-balance'
 */
async function withdrawShopeeBalance(options = {}) {
  const date = options.date;
  const onProgress = options.onProgress || (() => {});
  const dryRun = options.dryRun ?? config.dryRun;

  if (!date) {
    throw new ShopeeWithdrawError('NO_DATE', 'Tanggal penarikan wajib diisi.');
  }

  return runExclusively(async () => {
    // Perintah "auto rekap" wajar diulang beberapa kali sehari (salah ketik,
    // grup belum lengkap). Tanpa penjaga ini, ulangan kedua menarik dana lagi.
    const existing = getWithdrawRecord(date);
    if (existing && !options.force && !dryRun) {
      return {
        amount: existing.amount,
        status: 'reused',
        label: existing.label || '',
        rawValue: existing.rawValue || '',
        alreadyDone: true,
        withdrawnAt: existing.withdrawnAt,
      };
    }

    if (!dryRun && !config.password) {
      throw new ShopeeWithdrawError(
        'NO_CREDENTIALS',
        'SHOPEE_SELLER_PASSWORD belum diisi, tidak bisa mengonfirmasi penarikan.'
      );
    }

    fs.mkdirSync(PROFILE_DIR, { recursive: true });

    const browser = await puppeteer.launch({
      headless: config.headless,
      executablePath: config.chromePath,
      // Sesi login disimpan supaya OTP tidak diminta setiap run.
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
      page.setDefaultTimeout(config.navigationTimeoutMs);
      await page.setViewport({ width: 1440, height: 1000 });

      await ensureLogin(page, onProgress);
      await openBalancePage(page, onProgress);

      const balance = await readBalance(page);

      if (dryRun) {
        console.log(`[dry-run] Saldo Shopee dapat ditarik: ${formatRupiah(balance.amount)}`);
        return { ...balance, status: 'dry-run', alreadyDone: false };
      }

      if (balance.amount <= 0) {
        return { ...balance, status: 'zero-balance', alreadyDone: false };
      }

      if (config.maxWithdraw && balance.amount > config.maxWithdraw) {
        throw new ShopeeWithdrawError(
          'BALANCE_OVER_CAP',
          `Saldo terbaca ${formatRupiah(balance.amount)}, di atas batas aman ` +
            `${formatRupiah(config.maxWithdraw)} (KEUANGAN_MAX_WITHDRAW). ` +
            'Penarikan dibatalkan, silakan cek manual.'
        );
      }

      const outcome = await performWithdraw(page, onProgress, balance.amount);

      const record = {
        amount: balance.amount,
        label: balance.label,
        rawValue: balance.rawValue,
        withdrawnAt: new Date().toISOString(),
      };
      putWithdrawRecord(date, record);
      console.log(`Shopee withdraw ${date}: ${formatRupiah(balance.amount)} - sukses.`);

      return {
        ...record,
        status: 'withdrawn',
        alreadyDone: false,
        successText: outcome.successText,
      };
    } catch (error) {
      // Error Puppeteer mentah tidak memberi tahu apa pun yang bisa
      // ditindaklanjuti ("Cannot find context with specified id"), jadi
      // diterjemahkan supaya pesan di WhatsApp dan di terminal bisa dipakai.
      if (error instanceof ShopeeWithdrawError) {
        throw error;
      }
      if (isContextError(error)) {
        throw new ShopeeWithdrawError(
          'PAGE_UNSTABLE',
          'Halaman Shopee terus berpindah saat dibaca, jadi prosesnya dibatalkan. ' +
            'Tidak ada dana yang ditarik. Coba lagi sebentar lagi.'
        );
      }
      throw new ShopeeWithdrawError('BROWSER_FAILED', `Gagal mengendalikan Chrome: ${error.message}`);
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

module.exports = {
  PROFILE_DIR,
  MANUAL_HINTS,
  detectLoginState,
  gotoStable,
  passPasswordGate,
  isContextError,
  waitForUrlSettled,
  withPageRetry,
  STATE_PATH,
  ShopeeWithdrawError,
  config,
  formatRupiah,
  getWithdrawRecord,
  dumpMoneyLines,
  parseRupiah,
  performWithdraw,
  readBalance,
  selectors,
  withdrawShopeeBalance,
};
