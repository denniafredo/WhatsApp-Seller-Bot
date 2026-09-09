// Klien untuk Bilas (aplikasi laundry). Dipakai fitur "cek kilo" untuk menarik
// transaksi harian lalu dibandingkan dengan foto tulisan tangan karyawan.
//
// Catatan auth: x-access-token dan x-access-web-token adalah konstanta yang
// tertanam di bundle web Bilas (sama untuk semua pengguna), jadi bukan rahasia.
// Yang per-akun hanya JWT hasil login, dan itu diambil saat runtime.

const crypto = require('crypto');

const DASHBOARD_BASE = 'https://apiweb.bilas.id';
const REPORT_BASE = 'https://laporan.apibilas.com';
const X_ACCESS_TOKEN = 'sjgyfne73592643gedudney3628465hgrdt';
const X_ACCESS_WEB_TOKEN =
  'UD1P6jZ0XKErPm5hQ4dKSXu5MQv6h8oOGeT78CVpXXAxC7H4LrtEZtj2BnwHKKcnuLfRtZYvne3Qlb2aUVg';

// Login memakai Basic auth tiga bagian: email:password:pemilik. Tanpa segmen
// "pemilik" server membalas "Terjadi kesalahan".
const LOGIN_ROLE = 'pemilik';

class BilasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BilasError';
    this.code = code;
  }
}

function decodeJwtExpiryMs(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString('utf8')
    );
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch (error) {
    return 0;
  }
}

function firstWordKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')[0] || '';
}

function createBilasClient(options = {}) {
  const username = options.username || process.env.BILAS_USERNAME || '';
  const password = options.password || process.env.BILAS_PASSWORD || '';
  const defaultOutletAlias =
    options.defaultOutlet || process.env.BILAS_DEFAULT_OUTLET || '';
  const fetchImpl = options.fetch || globalThis.fetch;

  let session = null; // { token, uid, expiresAtMs, outlets: [{id, nama}] }

  async function login() {
    if (!username || !password) {
      throw new BilasError(
        'NO_CREDENTIALS',
        'BILAS_USERNAME / BILAS_PASSWORD belum diisi di .env.'
      );
    }

    const basic = Buffer.from(`${username}:${password}:${LOGIN_ROLE}`).toString('base64');
    let response;
    try {
      response = await fetchImpl(`${DASHBOARD_BASE}/web/user/auth/login/email`, {
        method: 'POST',
        headers: {
          'x-access-token': X_ACCESS_TOKEN,
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
    } catch (error) {
      throw new BilasError('NETWORK', `Tidak bisa menghubungi Bilas: ${error.message}`);
    }

    const data = await response.json().catch(() => ({}));
    if (String(data.value) !== '1' || !data.result?.token) {
      throw new BilasError(
        'LOGIN_FAILED',
        `Login Bilas gagal: ${data.message || 'respon tidak dikenali'}`
      );
    }

    const result = data.result;
    session = {
      token: result.token,
      uid: result.uid,
      expiresAtMs: decodeJwtExpiryMs(result.token),
      outlets: (result.outletlist || []).map((outlet) => ({
        id: outlet.id,
        nama: outlet.nama,
      })),
    };

    return session;
  }

  async function ensureSession() {
    // Refresh 60 detik sebelum kedaluwarsa supaya request tidak jatuh di tengah.
    const stale = !session || (session.expiresAtMs && Date.now() > session.expiresAtMs - 60000);
    if (stale) {
      await login();
    }
    return session;
  }

  // Nama cabang pendek -> id outlet. Dibangun dari outletlist (kata pertama nama),
  // jadi tidak perlu hafal id. Contoh: "discount" -> Discount Laundry.
  function resolveOutlet(alias) {
    const outlets = session?.outlets || [];
    if (!outlets.length) {
      return null;
    }

    const wanted = firstWordKey(alias);
    if (!wanted) {
      // Tanpa alias: pakai default dari env kalau ada, kalau tidak outlet pertama.
      if (defaultOutletAlias) {
        const byDefault = outlets.find((o) => firstWordKey(o.nama) === firstWordKey(defaultOutletAlias));
        if (byDefault) return byDefault;
      }
      return outlets[0];
    }

    return (
      outlets.find((o) => firstWordKey(o.nama) === wanted) ||
      outlets.find((o) => o.nama.toLowerCase().includes(alias.toLowerCase())) ||
      null
    );
  }

  function listOutlets() {
    return (session?.outlets || []).map((o) => o.nama);
  }

  async function getTransactions({ outletId, startDate, endDate }) {
    const active = await ensureSession();
    const body = {
      req_id: crypto.randomUUID(),
      tgl_awal: startDate,
      tgl_akhir: endDate,
      dibuat_tgl: new Date().toISOString(),
      id: outletId,
      mode: 'all list',
      pemilik: active.uid,
      send_data: false,
      tipe: 'semua',
      user: `web-${active.uid}`,
    };

    let response;
    try {
      response = await fetchImpl(`${REPORT_BASE}/v1/laporanoutlet/transaksi/transaksi`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${active.token}`,
          'x-access-token': X_ACCESS_TOKEN,
          'x-access-web-token': X_ACCESS_WEB_TOKEN,
          'x-outlet-id': outletId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new BilasError('NETWORK', `Tidak bisa menarik transaksi: ${error.message}`);
    }

    if (response.status === 401 || response.status === 403) {
      // Token kedaluwarsa di tengah: login ulang sekali lalu coba lagi.
      await login();
      return getTransactions({ outletId, startDate, endDate });
    }

    const data = await response.json().catch(() => ({}));
    if (String(data.value) !== '1' || !data.result) {
      throw new BilasError(
        'REPORT_FAILED',
        `Gagal ambil transaksi: ${data.message || 'respon tidak dikenali'}`
      );
    }

    return flattenTransactions(data.result);
  }

  return { login, ensureSession, resolveOutlet, listOutlets, getTransactions };
}

// result.detail[] dikelompokkan per hari; tiap hari punya list[] transaksi.
// Kilo per transaksi ada di field `kiloan` (bukan total_kg yang agregat harian).
function flattenTransactions(result) {
  const rows = [];
  for (const day of result.detail || []) {
    for (const trx of day.list || []) {
      rows.push({
        noNota: trx.no_nota,
        nama: trx.nama_pelanggan,
        kilo: Number(trx.kiloan) || 0,
        satuan: Number(trx.satuan) || 0,
        meter: Number(trx.meter) || 0,
        status: trx.status_pengerjaan,
        tanggal: day.tanggal,
      });
    }
  }
  return rows;
}

module.exports = { createBilasClient, BilasError, flattenTransactions };
