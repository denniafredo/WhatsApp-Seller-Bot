// HTML nota -> PDF + JPG, dari SATU halaman Chrome yang sama.
//
// Dua keluaran dari satu halaman itu inti pilihannya: PDF-nya teks vektor
// (tajam dicetak, bisa di-select), JPG-nya untuk dilihat langsung di chat,
// dan keduanya dijamin tidak pernah beda tata letak karena dirender dari
// halaman yang identik.
//
// Tinggi PDF diukur dari isinya, bukan dipatok ukuran kertas: nota dengan 20
// item tetap jadi satu halaman panjang, bukan pecah jadi dua lembar yang
// barisnya terputus di tengah.
//
// Lebar dan tinggi minimalnya ikut brand (Dash Mall A5, Marvel A6) - lihat
// notaBrands.js.

const puppeteer = require('puppeteer');
const { renderNotaHtml } = require('./notaTemplate');

const MM_PER_PX = 25.4 / 96;

// Cuma tinggi awal viewport; halaman tetap diukur ulang setelah dirender.
const INITIAL_HEIGHT_PX = 794;

const config = {
  // Perbesar kalau JPG-nya mau lebih tajam; 2x sudah ~1120px lebar, pas untuk
  // WhatsApp tanpa bikin file jadi besar.
  scale: Number(process.env.NOTA_JPG_SCALE) || 2,
  quality: Number(process.env.NOTA_JPG_QUALITY) || 92,
};

let browserPromise = null;

// Semua render dijalankan berurutan lewat rantai promise ini. Bukan soal benar
// atau salah hasilnya, tapi soal beban: dua nota yang datang bersamaan tidak
// perlu membuka dua Chrome.
let chain = Promise.resolve();

function isAlive(browser) {
  if (!browser) {
    return false;
  }
  // puppeteer 22+ pakai getter `connected`; versi lama pakai isConnected().
  return typeof browser.connected === 'boolean' ? browser.connected : browser.isConnected();
}

async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (isAlive(existing)) {
      return existing;
    }
    // Chrome-nya mati (di-kill, atau server sempat kehabisan memori); buka lagi.
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  return browserPromise;
}

async function renderOnce(nota, brand) {
  const widthMm = brand.widthMm;
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({
      width: Math.ceil(widthMm / MM_PER_PX),
      height: INITIAL_HEIGHT_PX,
      deviceScaleFactor: config.scale,
    });

    // Aset sudah jadi data URI di dalam HTML-nya, jadi tidak ada permintaan
    // jaringan yang perlu ditunggu.
    await page.setContent(renderNotaHtml(nota, brand), { waitUntil: 'domcontentloaded' });

    const heightPx = await page.evaluate(
      () => Math.ceil(document.body.getBoundingClientRect().height)
    );
    // Setengah milimeter kelebihan: pembulatan px->mm yang kurang sedikit saja
    // membuat Chrome menambah halaman kedua yang isinya kosong.
    const contentMm = heightPx * MM_PER_PX + 0.5;
    // Nota pendek tetap dicetak seukuran kertas aslinya - PDF-nya bisa saja
    // diprint, dan ukuran yang tidak standar membuat printer menskalakannya
    // sendiri. JPG-nya TIDAK diberi batas ini: di chat, sisa putih di bawah
    // cuma bikin notanya kelihatan kecil.
    const heightMm = Math.max(brand.minHeightMm, contentMm);

    const pdf = await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm}mm`,
      printBackground: true,
      pageRanges: '1',
    });

    // Screenshot elemen body, bukan fullPage: batasnya persis kertas nota,
    // tanpa sisa piksel putih dari pembulatan lebar viewport.
    const body = await page.$('body');
    const jpg = await body.screenshot({ type: 'jpeg', quality: config.quality });

    return {
      pdf: Buffer.from(pdf),
      jpg: Buffer.from(jpg),
      widthMm,
      heightMm,
      contentMm,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * @param nota hasil parseNota().nota
 * @param brand hasil resolveBrand()
 * @returns {Promise<{ pdf: Buffer, jpg: Buffer, widthMm: number, heightMm: number }>}
 */
function renderNota(nota, brand) {
  const run = chain.then(() => renderOnce(nota, brand));
  // Rantai tidak boleh putus karena satu nota gagal; kegagalannya tetap
  // diteruskan ke pemanggil lewat `run`.
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function closeBrowser() {
  if (!browserPromise) {
    return;
  }
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (isAlive(browser)) {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  renderNota,
  closeBrowser,
  config,
};
