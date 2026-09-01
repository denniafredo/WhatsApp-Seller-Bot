const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

function readNumber(rawValue, fallback, min, max) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

const config = {
  baseUrl: process.env.VOICECLEANER_URL || 'https://voicecleaner.ai/',
  email: process.env.VOICECLEANER_EMAIL || '',
  password: process.env.VOICECLEANER_PASSWORD || '',
  enhancement: process.env.VOICECLEANER_ENHANCEMENT || 'Remove Noise',
  headless: process.env.VOICECLEANER_HEADLESS !== 'false',
  chromePath: process.env.CHROME_PATH || undefined,
  navigationTimeoutMs: readNumber(process.env.VOICECLEANER_NAV_TIMEOUT_MS, 60000, 5000, 300000),
  processTimeoutMs: readNumber(process.env.VOICECLEANER_TIMEOUT_MS, 300000, 10000, 1800000),
  pollIntervalMs: 2000,
};

// Every page-shape assumption lives here, and all of it was verified against the
// live site. A hosted UI has no versioned contract, so this block is what needs
// editing when the flow breaks - not the logic below.
const selectors = {
  loginTriggerText: 'sign ?in|log in to receive',
  emailField: 'input[type="email"], input[name="email"], input[autocomplete="username"]',
  passwordField: 'input[type="password"], input[name="password"]',
  submitText: /^(sign ?in|log ?in|continue|submit|masuk)$/i,
  submitBanned: /receive credits|for free/i,
  uploadSourceText: '^my device$',
  fileField: 'input[type="file"]',
  workspaceMarker: 'select enhancement type',
  startText: '^enhance media$',
  downloadText: '^download result$|^download$',
  outOfCredits: /insufficient credit|not enough credit|out of credit|upgrade to continue/i,
  loginRejected: /incorrect|invalid|wrong password|does not exist|not found/i,
  resultReady: /download result/i,
};

class VoiceCleanerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VoiceCleanerError';
    this.code = code;
  }
}

// The whole UI is built from divs with no <button> anywhere, and wrapper divs
// often hold two controls at once ("Download Result" + "Upload New File"). DOM
// events bubble upward, so clicking a wrapper never fires the handler bound to
// its child - it just fails silently. Always target the innermost match.
function clickInnermost(page, pattern, scopeAttribute) {
  return page.evaluate((pat, scopeAttr) => {
    const root = scopeAttr ? document.querySelector(`[${scopeAttr}]`) : document;
    if (!root) {
      return null;
    }

    const expression = new RegExp(pat, 'i');
    const matches = [...root.querySelectorAll('button, a, [role="button"], div, span, label, p')]
      .filter((element) => {
        const text = (element.innerText || '').trim();
        if (!text || text.length > 45 || !expression.test(text)) {
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

    return (target.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 45);
  }, pattern, scopeAttribute || null);
}

// The login trigger is a real <button>; the broad innermost strategy picks a
// decorative "Sign In" span that is not clickable. Verified working: first
// matching real button.
function clickButton(page, pattern) {
  return page.evaluate((pat) => {
    const expression = new RegExp(pat, 'i');

    for (const element of document.querySelectorAll('button, a, [role="button"]')) {
      const text = (element.innerText || '').trim();
      if (!text || text.length > 45 || !expression.test(text)) {
        continue;
      }
      const box = element.getBoundingClientRect();
      if (box.width < 5 || box.height < 5) {
        continue;
      }
      element.click();
      return text.slice(0, 45);
    }

    return null;
  }, pattern);
}

function readPageText(page) {
  return page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
}

// Walking up from the password field guarantees the button pressed belongs to the
// login dialog. Matching by text across the whole page hits the navbar trigger
// instead, which merely reopens the dialog.
function submitLoginForm(page, submitPattern, bannedPattern) {
  return page.evaluate((submitSource, bannedSource) => {
    const field = document.querySelector('input[type="password"], input[name="password"]');
    if (!field) {
      return null;
    }

    const wanted = new RegExp(submitSource, 'i');
    const banned = new RegExp(bannedSource, 'i');
    let scope = field.parentElement;
    let hops = 0;

    while (scope && scope !== document.body && hops < 8) {
      // Verified: the real submit button sits 5 levels above the password field.
      // Adding div/span here matches a handler-less wrapper at level 0-1 first,
      // which clicks nothing and stops the climb before reaching the button.
      const button = [...scope.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .find((candidate) => {
          const text = (candidate.innerText || candidate.value || '').trim();
          return text && wanted.test(text) && !banned.test(text);
        });

      if (button) {
        const text = (button.innerText || button.value || '').trim();
        button.click();
        return text;
      }

      scope = scope.parentElement;
      hops += 1;
    }

    return null;
  }, submitPattern.source, bannedPattern.source);
}

async function login(page, onProgress) {
  if (!config.email || !config.password) {
    throw new VoiceCleanerError(
      'VOICECLEANER_NO_CREDENTIALS',
      'VOICECLEANER_EMAIL dan VOICECLEANER_PASSWORD belum diisi di .env.'
    );
  }

  await onProgress('Menghubungkan ke server...');
  await page.goto(config.baseUrl, {
    waitUntil: 'networkidle2',
    timeout: config.navigationTimeoutMs,
  });

  await onProgress('Menyiapkan sesi...');
  await clickButton(page, selectors.loginTriggerText);

  const emailField = await page
    .waitForSelector(selectors.emailField, { visible: true, timeout: 25000 })
    .catch(() => null);

  if (!emailField) {
    throw new VoiceCleanerError(
      'VOICECLEANER_LOGIN_FAILED',
      'Form login tidak muncul. Tampilan situsnya kemungkinan berubah.'
    );
  }

  await emailField.type(config.email, { delay: 25 });

  const passwordField = await page.$(selectors.passwordField);
  if (!passwordField) {
    throw new VoiceCleanerError(
      'VOICECLEANER_LOGIN_FAILED',
      'Kolom password tidak ada. Login situsnya mungkin berpindah ke OTP atau OAuth.'
    );
  }

  await passwordField.type(config.password, { delay: 25 });

  if (!(await submitLoginForm(page, selectors.submitText, selectors.submitBanned))) {
    await passwordField.press('Enter');
  }

  // The dialog closing is the only reliable success signal: the upload control
  // does not exist until an upload source is picked, so waiting for it here
  // would hang even on a successful login.
  const dialogClosed = await page
    .waitForFunction(
      (fieldSelector) => !document.querySelector(fieldSelector),
      { timeout: 30000 },
      selectors.passwordField
    )
    .then(() => true)
    .catch(() => false);

  if (!dialogClosed) {
    const text = await readPageText(page);

    throw new VoiceCleanerError(
      'VOICECLEANER_LOGIN_FAILED',
      selectors.loginRejected.test(text)
        ? 'Login ditolak. Periksa VOICECLEANER_EMAIL dan VOICECLEANER_PASSWORD.'
        : 'Login tidak selesai dalam 30 detik.'
    );
  }
}

function listFiles(directory) {
  return fs.readdirSync(directory).filter((name) => !/\.(crdownload|tmp|part)$/i.test(name));
}

async function waitForStableFile(downloadDir, before, deadlineMs) {
  while (Date.now() < deadlineMs) {
    const added = listFiles(downloadDir).filter((name) => !before.has(name));

    if (added.length) {
      const filePath = path.join(downloadDir, added[0]);
      const firstSize = fs.statSync(filePath).size;

      // A file still being written keeps growing, so compare across one interval
      // before treating it as complete.
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));

      if (fs.existsSync(filePath)) {
        const secondSize = fs.statSync(filePath).size;
        if (secondSize > 0 && secondSize === firstSize) {
          return filePath;
        }
      }

      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  return null;
}

// Tags the enhancement panel so later clicks can be scoped to it. The landing
// page carries a second, decorative copy of every enhancement chip, and an
// unscoped click lands on that one and changes nothing.
async function markWorkspace(page) {
  return page.evaluate((marker, chip) => {
    const all = [...document.querySelectorAll('*')];
    const exact = all.find((element) => (element.innerText || '').trim().toLowerCase() === marker);
    const loose = all
      .filter((element) => (element.innerText || '').toLowerCase().includes(marker))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];

    const heading = exact || loose;
    if (!heading) {
      return false;
    }

    // The smallest element containing the marker is the heading itself, which
    // holds no controls, so climb until the chips fall inside the scope.
    const chipPattern = new RegExp(`^${chip}$`, 'i');
    let scope = heading;
    let hops = 0;

    while (scope && scope !== document.body && hops < 12) {
      const hasChip = [...scope.querySelectorAll('div, span, button, [role="button"], label')]
        .some((element) => chipPattern.test((element.innerText || '').trim()));

      if (hasChip) {
        scope.setAttribute('data-wa-workspace', '1');
        return true;
      }

      scope = scope.parentElement;
      hops += 1;
    }

    return false;
  }, selectors.workspaceMarker, config.enhancement);
}

async function cleanAudio({ inputPath, downloadDir, onProgress = () => { } }) {
  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: config.headless,
    executablePath: config.chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(config.navigationTimeoutMs);
    await page.setViewport({ width: 1366, height: 1000 });

    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });

    await login(page, onProgress);

    await onProgress('Mengunggah audio...');
    await clickInnermost(page, selectors.uploadSourceText);

    const fileField = await page
      .waitForSelector(selectors.fileField, { timeout: 20000 })
      .catch(() => null);

    if (!fileField) {
      throw new VoiceCleanerError(
        'VOICECLEANER_FAILED',
        'Kontrol upload tidak muncul setelah memilih sumber file.'
      );
    }

    const before = new Set(listFiles(downloadDir));
    await fileField.uploadFile(inputPath);

    const panelReady = await page
      .waitForFunction(
        (marker) => (document.body.innerText || '').toLowerCase().includes(marker),
        { timeout: 120000 },
        selectors.workspaceMarker
      )
      .then(() => true)
      .catch(() => false);

    if (!panelReady) {
      throw new VoiceCleanerError(
        'VOICECLEANER_FAILED',
        'Panel pilihan enhancement tidak muncul setelah upload.'
      );
    }

    if (!(await markWorkspace(page))) {
      throw new VoiceCleanerError(
        'VOICECLEANER_FAILED',
        'Panel kerja tidak bisa dikenali. Tampilan situsnya kemungkinan berubah.'
      );
    }

    await onProgress('Membersihkan noise, ini bagian paling lama...');
    await clickInnermost(page, `^${config.enhancement}$`, 'data-wa-workspace');

    if (!(await clickInnermost(page, selectors.startText, 'data-wa-workspace'))) {
      throw new VoiceCleanerError(
        'VOICECLEANER_FAILED',
        'Tombol mulai proses tidak ditemukan di panel.'
      );
    }

    const deadlineMs = Date.now() + config.processTimeoutMs;
    let downloadTriggered = false;
    let downloaded = null;

    while (Date.now() < deadlineMs && !downloaded) {
      const text = await readPageText(page);

      if (selectors.outOfCredits.test(text)) {
        throw new VoiceCleanerError(
          'VOICECLEANER_NO_CREDITS',
          'Kredit voicecleaner.ai habis untuk hari ini.'
        );
      }

      if (!downloadTriggered && selectors.resultReady.test(text)) {
        await onProgress('Mengambil hasil...');
        // Clicking again mid-download can cancel it, so this fires once only.
        downloadTriggered = Boolean(await clickInnermost(page, selectors.downloadText));
      }

      downloaded = await waitForStableFile(
        downloadDir,
        before,
        Math.min(deadlineMs, Date.now() + (downloadTriggered ? 20000 : 6000))
      );
    }

    if (!downloaded) {
      throw new VoiceCleanerError(
        'VOICECLEANER_TIMEOUT',
        `Tidak ada hasil setelah ${Math.round(config.processTimeoutMs / 1000)} detik.`
      );
    }

    return downloaded;
  } finally {
    await browser.close().catch(() => { });
  }
}

module.exports = {
  VoiceCleanerError,
  cleanAudio,
  clickButton,
  clickInnermost,
  config,
  selectors,
};
