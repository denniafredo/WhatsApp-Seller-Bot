// Lapisan tipis di atas MuMuPlayer: menyalakan emulator, menyambung adb, dan
// membaca/menekan layar Android. Sengaja tidak tahu apa-apa soal Maxim -
// semua pengetahuan aplikasi ada di maximDriver.js.
//
// Semua pemanggilan adb lewat execFile (tanpa shell) karena path emulator
// mengandung spasi dan argumen seperti /sdcard/ui.xml akan diubah jadi path
// Windows kalau lewat shell.

const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class OngkirError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OngkirError';
    this.code = code;
  }
}

const mumuDir = process.env.MUMU_DIR || 'C:\\Program Files\\Netease\\MuMuPlayer\\nx_main';
const vmIndex = String(process.env.MUMU_VM_INDEX || '0');
const managerPath = path.join(mumuDir, 'MuMuManager.exe');
const adbPath = path.join(mumuDir, 'adb.exe');
const bootTimeoutMs = Math.max(Number(process.env.MUMU_BOOT_TIMEOUT_MS) || 180000, 30000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTool(file, args, { binary = false, timeoutMs = 90000 } = {}) {
  try {
    const { stdout } = await execFileAsync(file, args, {
      encoding: binary ? 'buffer' : 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      timeout: timeoutMs,
    });
    return binary ? stdout : String(stdout).trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new OngkirError(
        'NO_EMULATOR',
        `MuMuPlayer tidak ditemukan di ${mumuDir}. Atur MUMU_DIR di .env.`
      );
    }
    // uiautomator di Android 15 keluar dengan status 139 SETELAH file tertulis;
    // pemanggilnya yang memutuskan itu gagal atau tidak, bukan di sini.
    error.stdoutText = String(error.stdout || '');
    error.stderrText = String(error.stderr || '');
    throw error;
  }
}

async function manager(args) {
  const raw = await runTool(managerPath, args);
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

async function getVmInfo() {
  return manager(['info', '-v', vmIndex]);
}

async function startEmulator() {
  await manager(['control', '-v', vmIndex, 'launch']).catch(() => ({}));

  const deadline = Date.now() + bootTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const info = await getVmInfo().catch(() => ({}));
    if (info.is_android_started) {
      return;
    }
  }

  throw new OngkirError(
    'BOOT_TIMEOUT',
    `Emulator tidak siap dalam ${Math.round(bootTimeoutMs / 1000)} detik. Buka MuMuPlayer manual lalu coba lagi.`
  );
}

// Serial adb (host:port) emulator, menyalakannya kalau perlu.
async function ensureDevice() {
  const info = await getVmInfo();
  if (!info.is_android_started) {
    await startEmulator();
  }

  const conn = await manager(['adb', '-v', vmIndex]);
  const port = conn.adb_port || conn.port;
  const host = conn.adb_host || '127.0.0.1';

  if (!port) {
    throw new OngkirError('NO_ADB', `Port adb emulator tidak terbaca: ${JSON.stringify(conn)}`);
  }

  const serial = `${host}:${port}`;
  await runTool(adbPath, ['connect', serial]);
  return serial;
}

function createDevice(serial) {
  const adb = (args, options) => runTool(adbPath, ['-s', serial, ...args], options);

  return {
    serial,
    adb,

    async shell(...args) {
      return adb(['shell', ...args]);
    },

    async tap(x, y, settleMs = 1200) {
      await adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
      await sleep(settleMs);
    },

    // input text memakai %s untuk spasi; tanda lain yang dipakai alamat aman.
    async typeText(value, settleMs = 2500) {
      const encoded = String(value).trim().replace(/ /g, '%s');
      await adb(['shell', 'input', 'text', encoded]);
      await sleep(settleMs);
    },

    async clearText(count = 40, settleMs = 1200) {
      const keys = Array.from({ length: count }, () => '67');
      await adb(['shell', 'input', 'keyevent', ...keys]);
      await sleep(settleMs);
    },

    async pressKey(key, settleMs = 1200) {
      await adb(['shell', 'input', 'keyevent', String(key)]);
      await sleep(settleMs);
    },

    async screenshot() {
      return adb(['exec-out', 'screencap', '-p'], { binary: true });
    },

    async foregroundPackage() {
      const dump = await adb(['shell', 'dumpsys', 'activity', 'activities']).catch(() => '');
      const line = dump.split('\n').find((l) => l.includes('topResumedActivity')) || '';
      const match = line.match(/\s([a-zA-Z0-9_.]+)\/[^\s]+/);
      return match ? match[1] : null;
    },

    async launchPackage(pkg, settleMs = 6000) {
      await adb([
        'shell', 'monkey', '-p', pkg,
        '-c', 'android.intent.category.LAUNCHER', '1',
      ]);
      await sleep(settleMs);
    },

    async isInstalled(pkg) {
      const list = await adb(['shell', 'pm', 'list', 'packages', pkg]).catch(() => '');
      return list.includes(pkg);
    },

    async dump() {
      try {
        await adb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml']);
      } catch (error) {
        if (!String(error.stdoutText || '').includes('dumped to')) {
          throw error;
        }
      }
      const xml = await adb(['shell', 'cat', '/sdcard/ui.xml']);
      return parseNodes(xml);
    },
  };
}

// ---- Pembacaan hierarki -------------------------------------------------

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function parseNodes(xml) {
  const nodes = [];

  for (const match of String(xml).matchAll(/<node[^>]*>/g)) {
    const tag = match[0];
    const attr = (name) => {
      const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
      return found ? decodeXmlEntities(found[1]) : '';
    };

    const bounds = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;

    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);

    nodes.push({
      id: attr('resource-id').replace(/^[^:]+:id\//, ''),
      text: attr('text'),
      desc: attr('content-desc'),
      cls: attr('class'),
      clickable: attr('clickable') === 'true',
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }

  return nodes;
}

function findNode(nodes, predicate) {
  return nodes.find(predicate) || null;
}

function findById(nodes, id) {
  return findNode(nodes, (node) => node.id === id);
}

function findAllById(nodes, id) {
  return nodes.filter((node) => node.id === id);
}

// Menunggu layar berubah: dump berulang sampai `predicate` memberi nilai.
async function waitFor(device, predicate, { timeoutMs = 20000, intervalMs = 1200, label = 'layar' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastNodes = [];

  while (Date.now() < deadline) {
    lastNodes = await device.dump();
    const hit = predicate(lastNodes);
    if (hit) {
      return { hit, nodes: lastNodes };
    }
    await sleep(intervalMs);
  }

  throw new OngkirError('UI_TIMEOUT', `Menunggu ${label} terlalu lama di aplikasi Maxim.`);
}

module.exports = {
  OngkirError,
  ensureDevice,
  createDevice,
  parseNodes,
  findNode,
  findById,
  findAllById,
  waitFor,
  sleep,
  adbPath,
  managerPath,
};
