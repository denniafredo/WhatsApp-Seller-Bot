// Menjalankan screener MA Squeeze Daily v2 (Python) dan mengembalikan
// laporannya yang sudah berformat WhatsApp.
//
// Logika sinyalnya sengaja TIDAK disalin ke JavaScript: sumbernya satu, di
// project tradingview (indodax_squeeze_screener.py, port dari Pine v2).
// Bot cuma memanggil dan mengirim hasilnya, jadi tuning di config.json
// screener langsung ikut ke sini.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = {
  scriptPath:
    process.env.SQUEEZE_SCREENER_PATH ||
    path.resolve(__dirname, '..', '..', '..', 'tradingview', 'screener', 'indodax_squeeze_screener.py'),
  python: process.env.SQUEEZE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  timeoutMs: Number(process.env.SQUEEZE_TIMEOUT_MS) || 5 * 60 * 1000,
};

function runSqueezeScreener() {
  if (!fs.existsSync(config.scriptPath)) {
    return Promise.reject(
      new Error(`Screener tidak ditemukan di ${config.scriptPath}. Set SQUEEZE_SCREENER_PATH di .env.`)
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      config.python,
      [config.scriptPath, '--format', 'whatsapp'],
      {
        cwd: path.dirname(config.scriptPath),
        timeout: config.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        // Tanpa ini Python di Windows menulis stdout pakai cp1252 dan emoji
        // di laporan berubah jadi "?".
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || '').trim().split(/\r?\n/).slice(-3).join(' | ');
          reject(new Error(`Screener gagal: ${detail || error.message}`));
          return;
        }

        const text = String(stdout || '').trim();
        if (!text) {
          reject(new Error('Screener tidak menghasilkan laporan.'));
          return;
        }

        resolve(text);
      }
    );
  });
}

module.exports = {
  config,
  runSqueezeScreener,
};
