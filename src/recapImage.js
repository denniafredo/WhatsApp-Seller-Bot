const puppeteer = require('puppeteer');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function renderRecapJpg(rows) {
  const bodyRows = Array.from({ length: 62 }, (_, index) => {
    const row = rows[index] || [];
    const cells = Array.from({ length: 5 }, (_, column) =>
      `<td>${escapeHtml(row[column])}</td>`
    ).join('');
    return `<tr class="row-${index + 1}">${cells}</tr>`;
  }).join('');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html>
      <html><head><style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 18px; background: #fff; font-family: Arial, sans-serif; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
        td { border: 1px solid #b7b7b7; padding: 5px 7px; min-height: 25px; vertical-align: middle; }
        td:nth-child(1) { width: 34%; font-weight: 600; }
        td:nth-child(2) { width: 23%; }
        td:nth-child(3), td:nth-child(4), td:nth-child(5) { width: 14.33%; text-align: right; }
        .row-1 td, .row-2 td { background: #d9ead3; font-weight: 700; }
        .row-22 td, .row-36 td { background: #f3f3f3; font-weight: 700; }
        .row-56 td, .row-57 td, .row-58 td, .row-62 td { background: #fff2cc; font-weight: 700; }
      </style></head><body><table>${bodyRows}</table></body></html>`, {
      waitUntil: 'domcontentloaded',
    });
    return await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true });
  } finally {
    await browser.close();
  }
}

module.exports = { renderRecapJpg };
