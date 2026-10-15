// Tulis pemasukan harian ke spreadsheet keuangan ("Shopee Summary").
//
// Spreadsheet ini terpisah dari GOOGLE_SHEET_ID (template pembayaran), jadi
// punya env sendiri: KEUANGAN_SHEET_ID.
//
// Bentuk sheetnya adalah BUKU JURNAL, bukan satu baris per hari:
//
//   A=Tanggal        B=Keterangan      C=Pemasukan   D=Pengeluaran
//   14/09/2026       Income Shopee     Rp1.265.759
//                    Offline           Rp85.000
//                    Offline           Rp45.000
//                    Kulakan Yohan                   Rp1.353.000
//   15/09/2026       Income Shopee     ...
//
// Konsekuensi yang menentukan seluruh logika di file ini:
//   - Tanggal hanya ditulis sekali, di baris pertama blok hari itu.
//   - Setiap setoran offline punya BARIS SENDIRI, tidak dijumlahkan.
//   - Pengeluaran (Kulakan Yohan, Kas) sebaliknya: SATU baris per hari per
//     jenis, karena angkanya hasil rekap hari itu - rekap yang diulang
//     menimpa nominalnya, bukan menambah baris.
//   - Pengeluaran lepas yang diketik orang ("pengeluaran 9rb") diperlakukan
//     seperti offline: satu baris per catatan, dicocokkan sebagai multiset.
//   - Penjualan dari foto buku ("Offline Tunai" / "Offline Qris"): satu baris
//     per baris buku. Buku terbaru yang berlaku - rekap yang diulang
//     menyamakan baris-baris itu dengan isi buku (ditimpa, ditambah, atau
//     dihapus), bukan menumpuk.
//   - F1=SUM(C:C), G1=SUM(D:D), I1=F1-G1 memakai seluruh kolom, jadi menambah
//     baris otomatis ikut terhitung dan tidak ada formula yang perlu disentuh.
//   - Tab-nya per bulan ("September 2026"), dan namanya tidak selalu konsisten
//     ("Feb 2026", bukan "Februari 2026"), jadi nama tab dicocokkan dengan
//     daftar tab sungguhan - tidak dirangkai dari nama bulan.

const { getAccessToken } = require('../sheets/googleSheets');

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function readInt(rawValue, fallback) {
  const value = Number(rawValue);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getLayout() {
  return {
    spreadsheetId: process.env.KEUANGAN_SHEET_ID || '',
    // Kosong = nama tab dicari otomatis dari bulan tanggalnya.
    sheetName: process.env.KEUANGAN_SHEET_NAME || '',
    shopeeLabel: process.env.KEUANGAN_SHOPEE_LABEL || 'Income Shopee',
    offlineLabel: process.env.KEUANGAN_OFFLINE_LABEL || 'Offline',
    kulakanLabel: process.env.KEUANGAN_KULAKAN_LABEL || 'Kulakan Yohan',
    kasLabel: process.env.KEUANGAN_KAS_LABEL || 'Kas',
    pengeluaranLabel: process.env.KEUANGAN_PENGELUARAN_LABEL || 'Pengeluaran',
    // Penjualan barang dari foto buku tulis tangan, satu baris per baris buku,
    // labelnya menurut metode bayar (kolom T/Q di bukunya).
    jualanTunaiLabel: process.env.KEUANGAN_JUALAN_TUNAI_LABEL || 'Offline Tunai',
    jualanQrisLabel: process.env.KEUANGAN_JUALAN_QRIS_LABEL || 'Offline Qris',
    headerRows: readInt(process.env.KEUANGAN_HEADER_ROWS, 1),
    maxRows: readInt(process.env.KEUANGAN_LAST_ROW, 1000),
  };
}

class KeuanganSheetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KeuanganSheetError';
    this.code = code;
  }
}

async function sheetsFetch(url, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 403) {
      throw new KeuanganSheetError(
        'NO_SHEET_ACCESS',
        `Service account ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} belum punya akses Editor ` +
          'ke spreadsheet keuangan. Share spreadsheet itu ke email tersebut.'
      );
    }
    if (response.status === 404) {
      throw new KeuanganSheetError(
        'SHEET_NOT_FOUND',
        'Spreadsheet keuangan tidak ditemukan. Cek KEUANGAN_SHEET_ID.'
      );
    }
    throw new KeuanganSheetError(
      'SHEET_FAILED',
      result.error?.message || `Google Sheets menolak permintaan (${response.status}).`
    );
  }

  return result;
}

// ---- Tanggal <-> serial Google -------------------------------------------

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

function ymdToSerial(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - SERIAL_EPOCH_MS) / 86400000);
}

function serialToYmd(serial) {
  const numeric = Number(serial);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 200000) {
    return null;
  }
  return new Date(SERIAL_EPOCH_MS + Math.floor(numeric) * 86400000)
    .toISOString()
    .slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

// Locale spreadsheetnya in_ID dengan pola dd/mm/yyyy, jadi teks ini diparse
// Google jadi tanggal asli - bukan string.
function ymdToSheetDate(ymd) {
  const [year, month, day] = String(ymd).split('-');
  return `${pad(day)}/${pad(month)}/${year}`;
}

// ---- Nama tab ------------------------------------------------------------

/**
 * Cocokkan tanggal ke tab bulanan yang benar-benar ada.
 * Nama tab tidak konsisten ("Feb 2026"), jadi pencocokannya per awalan nama
 * bulan, bukan perangkaian string.
 */
function pickMonthlyTab(titles, ymd) {
  const [year, month] = String(ymd).split('-');
  const monthName = MONTHS_ID[Number(month) - 1].toLowerCase();
  const candidates = [];

  titles.forEach((title) => {
    const normalized = title.toLowerCase().trim();
    if (!normalized.includes(year)) {
      return;
    }
    // "sep" cukup untuk mencocokkan "September 2026" maupun "Sep 2026",
    // sementara tab lain seperti "Database Produk September" disaring karena
    // tidak memuat tahunnya.
    const word = normalized.replace(year, '').trim();
    if (monthName.startsWith(word) || word.startsWith(monthName.slice(0, 3))) {
      candidates.push(title);
    }
  });

  // Nama terpendek adalah tab bulan itu sendiri; yang lebih panjang biasanya
  // tab turunan ("Evaluasi September 2026").
  candidates.sort((left, right) => left.length - right.length);
  return candidates[0] || null;
}

async function getSpreadsheetTabs(spreadsheetId) {
  const result = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`
  );

  return (result.sheets || []).map((sheet) => ({
    title: sheet.properties.title,
    sheetId: sheet.properties.sheetId,
  }));
}

async function resolveTab(layout, ymd) {
  const tabs = await getSpreadsheetTabs(layout.spreadsheetId);

  if (layout.sheetName) {
    const forced = tabs.find((tab) => tab.title === layout.sheetName);
    if (!forced) {
      throw new KeuanganSheetError(
        'TAB_NOT_FOUND',
        `Tab "${layout.sheetName}" (KEUANGAN_SHEET_NAME) tidak ada di spreadsheet.`
      );
    }
    return forced;
  }

  const title = pickMonthlyTab(
    tabs.map((tab) => tab.title),
    ymd
  );

  if (!title) {
    const [year, month] = ymd.split('-');
    throw new KeuanganSheetError(
      'TAB_NOT_FOUND',
      `Tab bulan "${MONTHS_ID[Number(month) - 1]} ${year}" belum ada di spreadsheet. ` +
        'Buat tabnya dulu, atau set KEUANGAN_SHEET_NAME.'
    );
  }

  return tabs.find((tab) => tab.title === title);
}

// ---- Membaca blok harian -------------------------------------------------

function parseAmount(cellValue) {
  if (typeof cellValue === 'number') {
    return Number.isFinite(cellValue) ? cellValue : 0;
  }
  const digits = String(cellValue ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function normalizeLabel(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function readLedger(layout, tabTitle) {
  const range = `'${tabTitle}'!A${layout.headerRows + 1}:D${layout.maxRows}`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${layout.spreadsheetId}/values/${encodeURIComponent(range)}`
  );
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');

  const result = await sheetsFetch(url);
  const values = result.values || [];

  const rows = values.map((row, index) => ({
    row: layout.headerRows + 1 + index,
    dateSerial: typeof row[0] === 'number' ? row[0] : null,
    label: row[1] ?? '',
    income: row[2] ?? '',
    expense: row[3] ?? '',
    isEmpty: [row[0], row[1], row[2], row[3]].every(
      (cell) => cell === undefined || cell === null || String(cell).trim() === ''
    ),
  }));

  let lastDataRow = layout.headerRows;
  rows.forEach((row) => {
    if (!row.isEmpty) {
      lastDataRow = row.row;
    }
  });

  return { rows, lastDataRow };
}

// Jenis pengeluaran yang ditulis otomatis -> label kolom B-nya.
function getExpenseLabel(layout, kind) {
  return kind === 'kas' ? layout.kasLabel : layout.kulakanLabel;
}

// Label yang dianggap baris penjualan dari foto buku. Label lama ("Penjualan
// Tunai"/"Penjualan QRIS", dulu satu baris total per metode) ikut dikenali
// supaya rekap ulang di hari yang sudah terlanjur memakainya mengganti baris
// total itu dengan rinciannya, bukan menambah rincian di sampingnya.
const LEGACY_JUALAN_LABELS = ['Penjualan Tunai', 'Penjualan QRIS'];

function getJualanLabels(layout) {
  return [layout.jualanTunaiLabel, layout.jualanQrisLabel, ...LEGACY_JUALAN_LABELS].map(normalizeLabel);
}

function getJualanLabel(layout, bayar) {
  return bayar === 'Q' ? layout.jualanQrisLabel : layout.jualanTunaiLabel;
}

function getExpenseKinds(layout) {
  return [
    { kind: 'kulakan', label: layout.kulakanLabel },
    { kind: 'kas', label: layout.kasLabel },
  ];
}

/**
 * Temukan blok baris milik satu tanggal.
 * @returns null bila tanggalnya belum ada, atau
 *   { startRow, endRow, isLastBlock, shopeeRow, offlineRows, expenseRows,
 *     manualExpenseRows }
 */
function findDayBlock(ledger, layout, targetYmd) {
  const targetSerial = ymdToSerial(targetYmd);
  const { rows, lastDataRow } = ledger;

  const startIndex = rows.findIndex((row) => row.dateSerial === targetSerial);
  if (startIndex === -1) {
    return null;
  }

  const startRow = rows[startIndex].row;
  let endRow = startRow;

  for (let index = startIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.row > lastDataRow || row.dateSerial !== null) {
      break;
    }
    if (!row.isEmpty) {
      endRow = row.row;
    }
  }

  const blockRows = rows.filter((row) => row.row >= startRow && row.row <= endRow);
  const shopeeLabel = normalizeLabel(layout.shopeeLabel);
  const offlineLabel = normalizeLabel(layout.offlineLabel);
  const fixedExpenseLabels = getExpenseKinds(layout).map(({ label }) => normalizeLabel(label));

  return {
    startRow,
    endRow,
    isLastBlock: endRow >= lastDataRow,
    shopeeRow: blockRows.find((row) => normalizeLabel(row.label) === shopeeLabel) || null,
    offlineRows: blockRows
      .filter((row) => normalizeLabel(row.label) === offlineLabel)
      .map((row) => ({ row: row.row, amount: parseAmount(row.income) })),
    // Satu baris per jenis; kalau ada duplikat, yang pertama yang dipakai
    // supaya perintah yang diulang tidak berpindah-pindah baris.
    expenseRows: getExpenseKinds(layout).reduce((found, { kind, label }) => {
      const match = blockRows.find((row) => normalizeLabel(row.label) === normalizeLabel(label));
      if (match) {
        found[kind] = { row: match.row, amount: parseAmount(match.expense) };
      }
      return found;
    }, {}),
    // Pengeluaran lepas: dulu hanya baris berlabel "Pengeluaran", sekarang
    // keterangannya bebas ("beli lakban shopee"), jadi yang dipakai sebagai
    // penanda adalah kolom D terisi DAN labelnya bukan jenis tetap
    // (kulakan/kas). Tanpa ini, baris hasil AI tidak dikenali saat auto rekap
    // diulang dan akan ditulis dua kali.
    jualanRows: blockRows
      .filter((row) => getJualanLabels(layout).includes(normalizeLabel(row.label)))
      .map((row) => ({ row: row.row, amount: parseAmount(row.income), label: row.label || '' })),
    manualExpenseRows: blockRows
      .filter((row) => {
        const label = normalizeLabel(row.label);
        if (!label || fixedExpenseLabels.includes(label)) {
          return false;
        }
        return parseAmount(row.expense) > 0;
      })
      .map((row) => ({ row: row.row, amount: parseAmount(row.expense), label: row.label || '' })),
  };
}

// Sama seperti diffOfflineAmounts, tapi kuncinya keterangan + nominal.
// Pengeluaran lepas sekarang berketerangan bebas, jadi "bensin 50.000" dan
// "ice pack 50.000" pada hari yang sama adalah dua baris berbeda - membandingkan
// nominal saja akan menganggap yang kedua sudah tertulis.
function diffLabeledExpenses(newItems, existingItems) {
  const keyOf = (item) => `${normalizeLabel(item.label)}|${item.amount}`;
  const remaining = new Map();

  existingItems.forEach((item) => {
    const key = keyOf(item);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  });

  const toAdd = [];

  newItems.forEach((item) => {
    const key = keyOf(item);
    const available = remaining.get(key) || 0;
    if (available > 0) {
      remaining.set(key, available - 1);
      return;
    }
    toAdd.push(item);
  });

  return toAdd;
}

// Selisih multiset: nominal yang belum ada di sheet. Menjalankan perintah dua
// kali tidak menggandakan baris, tapi setoran baru yang masuk setelah run
// pertama tetap ikut ditambahkan.
function diffOfflineAmounts(newAmounts, existingAmounts) {
  const remaining = new Map();
  existingAmounts.forEach((amount) => {
    remaining.set(amount, (remaining.get(amount) || 0) + 1);
  });

  const toAdd = [];
  newAmounts.forEach((amount) => {
    const available = remaining.get(amount) || 0;
    if (available > 0) {
      remaining.set(amount, available - 1);
      return;
    }
    toAdd.push(amount);
  });

  return toAdd;
}

/**
 * Samakan baris penjualan yang sudah ada di blok dengan isi buku terbaru.
 * Yang persis sama dibiarkan, sisanya ditimpa berurutan, kekurangannya
 * ditambah, dan kelebihannya dihapus.
 *
 * @returns { plan: [{ label, amount, existing|null, action }], surplus: rows[] }
 *   plan mengikuti urutan buku.
 */
function planJualanSync(desired, existingRows, blockStartRow) {
  const keyOf = (item) => `${normalizeLabel(item.label)}|${item.amount}`;
  const unused = [...existingRows];
  const plan = desired.map((item) => {
    const index = unused.findIndex((row) => keyOf(row) === keyOf(item));
    if (index === -1) {
      return { ...item, existing: null, action: null };
    }
    const [existing] = unused.splice(index, 1);
    return { ...item, existing, action: 'unchanged' };
  });

  // Baris pertama blok memegang tanggal, jadi dipakai ulang lebih dulu -
  // menghapusnya akan ikut menghapus tanggal hari itu.
  unused.sort((left, right) => {
    if (left.row === blockStartRow) return -1;
    if (right.row === blockStartRow) return 1;
    return left.row - right.row;
  });

  plan.forEach((item) => {
    if (item.action) {
      return;
    }
    const existing = unused.shift();
    item.existing = existing || null;
    item.action = existing ? 'updated' : 'added';
  });

  return { plan, surplus: unused };
}

// ---- Menulis -------------------------------------------------------------

// Hapus baris (nomor 1-based) dari bawah ke atas supaya nomor baris lainnya
// tidak bergeser di tengah jalan.
async function deleteRows(layout, sheetId, rowNumbers) {
  if (!rowNumbers.length) {
    return;
  }

  const requests = [...rowNumbers]
    .sort((left, right) => right - left)
    .map((row) => ({
      deleteDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }));

  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${layout.spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );
}

async function insertBlankRows(layout, sheetId, afterRow, count) {
  // inheritFromBefore menyalin format baris di atasnya (tanggal dd/mm/yyyy di
  // kolom A, Rupiah di C/D), jadi hasilnya sama seperti menyisipkan baris
  // secara manual.
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${layout.spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: afterRow,
                endIndex: afterRow + count,
              },
              inheritFromBefore: true,
            },
          },
        ],
      }),
    }
  );
}

async function writeValues(layout, tabTitle, data) {
  if (!data.length) {
    return;
  }

  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${layout.spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );
}

/**
 * Tulis satu hari sebagai blok jurnal: pemasukan di kolom C, pengeluaran di D.
 *
 * @param entry {
 *   date, shopeeAmount, shopeeSkipped, offlineAmounts: number[],
 *   jualanRows: [{ bayar: 'T'|'Q', amount }],
 *   expenses: [{ kind: 'kulakan'|'kas', amount }], expenseAmounts: number[]
 * }
 * @returns ringkasan apa yang benar-benar berubah
 */
async function writeDailyLedger(entry) {
  const layout = getLayout();

  if (!layout.spreadsheetId) {
    throw new KeuanganSheetError('NO_SHEET_ID', 'KEUANGAN_SHEET_ID belum diisi di .env.');
  }

  const shopeeAmount = Math.max(Number(entry.shopeeAmount) || 0, 0);
  const offlineAmounts = (entry.offlineAmounts || []).map((amount) =>
    Math.max(Number(amount) || 0, 0)
  );
  const writeShopee = !entry.shopeeSkipped && shopeeAmount > 0;
  // Penjualan dari foto buku, satu baris per baris buku. Daftar kosong berarti
  // bukunya tidak terbaca hari ini - baris yang sudah ada dibiarkan, bukan
  // dihapus.
  const jualanRows = (entry.jualanRows || [])
    .map((item) => ({
      label: getJualanLabel(layout, item.bayar),
      amount: Math.max(Number(item.amount) || 0, 0),
    }))
    .filter((item) => item.amount > 0);
  // Nol tidak ditulis: baris Rp0 tidak mengubah SUM apa pun dan cuma
  // memanjangkan blok harian. Yang dilewati dilaporkan lewat expensesZero.
  const expenses = (entry.expenses || [])
    .map((expense) => ({ kind: expense.kind, amount: Math.max(Number(expense.amount) || 0, 0) }))
    .filter((expense, index, list) => list.findIndex((item) => item.kind === expense.kind) === index);
  const expensesToWrite = expenses.filter((expense) => expense.amount > 0);
  // Pengeluaran lepas boleh ditulis dua cara:
  //   - angka polos           -> keterangannya label tetap ("Pengeluaran")
  //   - { amount, keterangan } -> keterangannya apa yang ditulis orangnya
  // Bentuk kedua yang dipakai hasil pembacaan AI ("beli lakban shopee"), dan
  // bentuk pertama dipertahankan supaya "pengeluaran 9rb" tetap jalan.
  const expenseAmounts = (entry.expenseAmounts || [])
    .map((item) => {
      const amount = Math.max(Number(typeof item === 'object' ? item?.amount : item) || 0, 0);
      const keterangan =
        typeof item === 'object' ? String(item?.keterangan || item?.label || '').trim() : '';
      return { amount, label: keterangan || layout.pengeluaranLabel };
    })
    .filter((item) => item.amount > 0);

  const tab = await resolveTab(layout, entry.date);
  const ledger = await readLedger(layout, tab.title);
  const block = findDayBlock(ledger, layout, entry.date);

  const summary = {
    sheetName: tab.title,
    date: entry.date,
    blockExisted: Boolean(block),
    shopeeAction: 'skip',
    shopeeAmount,
    shopeeRow: null,
    offlineAdded: [],
    offlineAlreadyThere: 0,
    // Urutannya sama dengan jualanRows (urutan buku).
    jualan: [],
    jualanRemoved: 0,
    expenses: [],
    expensesZero: expenses
      .filter((expense) => expense.amount <= 0)
      .map((expense) => ({ kind: expense.kind, label: getExpenseLabel(layout, expense.kind) })),
    expenseAmountsAdded: [],
    expenseAmountsAlreadyThere: 0,
    expenseTotal: 0,
    rowsAdded: 0,
    insertedInMiddle: false,
    total: 0,
  };

  // --- Blok hari itu belum ada: tambahkan di bawah data terakhir ---
  if (!block) {
    // Empat kolom penuh: baris pemasukan mengosongkan D, baris pengeluaran
    // mengosongkan C, jadi tidak ada nominal yang nyasar kolom.
    const newRows = [];
    if (writeShopee) {
      newRows.push(['', layout.shopeeLabel, shopeeAmount, '']);
    }
    const jualanStartIndex = newRows.length;
    jualanRows.forEach((item) => {
      newRows.push(['', item.label, item.amount, '']);
    });
    offlineAmounts.forEach((amount) => {
      newRows.push(['', layout.offlineLabel, amount, '']);
    });
    const expenseStartIndex = newRows.length;
    expensesToWrite.forEach((expense) => {
      newRows.push(['', getExpenseLabel(layout, expense.kind), '', expense.amount]);
    });
    expenseAmounts.forEach((item) => {
      newRows.push(['', item.label, '', item.amount]);
    });

    if (!newRows.length) {
      return summary;
    }

    // Tanggalnya harus menempel di baris pertama blok, siapa pun penghuninya.
    newRows[0][0] = ymdToSheetDate(entry.date);

    const startRow = ledger.lastDataRow + 1;
    await writeValues(layout, tab.title, [
      {
        range: `'${tab.title}'!A${startRow}:D${startRow + newRows.length - 1}`,
        values: newRows,
      },
    ]);

    summary.shopeeAction = writeShopee ? 'added' : 'skip';
    summary.shopeeRow = writeShopee ? startRow : null;
    summary.offlineAdded = offlineAmounts;
    summary.jualan = jualanRows.map((item, index) => ({
      ...item,
      row: startRow + jualanStartIndex + index,
      action: 'added',
    }));
    summary.expenses = expensesToWrite.map((expense, index) => ({
      kind: expense.kind,
      label: getExpenseLabel(layout, expense.kind),
      amount: expense.amount,
      row: startRow + expenseStartIndex + index,
      action: 'added',
    }));
    summary.expenseAmountsAdded = expenseAmounts;
    summary.expenseTotal =
      expensesToWrite.reduce((sum, expense) => sum + expense.amount, 0) +
      expenseAmounts.reduce((sum, item) => sum + item.amount, 0);
    summary.rowsAdded = newRows.length;
    summary.startRow = startRow;
    summary.endRow = startRow + newRows.length - 1;
    summary.total =
      (writeShopee ? shopeeAmount : 0) +
      offlineAmounts.reduce((a, b) => a + b, 0) +
      jualanRows.reduce((sum, item) => sum + item.amount, 0);
    return summary;
  }

  // --- Blok sudah ada: perbarui Shopee, tambahkan offline yang belum ada ---
  const existingOffline = block.offlineRows.map((row) => row.amount);
  const offlineToAdd = diffOfflineAmounts(offlineAmounts, existingOffline);
  const expenseAmountsToAdd = diffLabeledExpenses(expenseAmounts, block.manualExpenseRows);

  summary.offlineAlreadyThere = offlineAmounts.length - offlineToAdd.length;
  summary.expenseAmountsAlreadyThere = expenseAmounts.length - expenseAmountsToAdd.length;
  summary.startRow = block.startRow;
  summary.endRow = block.endRow;

  const data = [];

  if (writeShopee && block.shopeeRow) {
    summary.shopeeRow = block.shopeeRow.row;

    if (parseAmount(block.shopeeRow.income) === shopeeAmount) {
      // Nominalnya sudah sama, jadi tidak ada gunanya menulis ulang - dan
      // balasan "sheet tidak berubah" jadi benar-benar jujur.
      summary.shopeeAction = 'unchanged';
    } else {
      // Ditimpa, bukan ditambah: penjaga harian di shopeeWithdrawClient
      // memastikan angka ini penarikan yang sama, jadi menulis ulang aman.
      data.push({
        range: `'${tab.title}'!C${block.shopeeRow.row}`,
        values: [[shopeeAmount]],
      });
      summary.shopeeAction = 'updated';
    }
  }

  // Penjualan dari foto buku: disamakan dengan isi buku terbaru. Foto yang
  // dikirim ulang setelah ada tambahan penjualan memperbarui baris-barisnya,
  // bukan menambah salinan kedua yang membuat pemasukan terhitung dua kali.
  const jualanSync = jualanRows.length
    ? planJualanSync(jualanRows, block.jualanRows, block.startRow)
    : { plan: [], surplus: [] };
  const jualanPending = [];

  jualanSync.plan.forEach((item) => {
    if (item.action === 'added') {
      jualanPending.push(item);
      return;
    }
    if (item.action === 'updated') {
      data.push({
        range: `'${tab.title}'!B${item.existing.row}:D${item.existing.row}`,
        values: [[item.label, item.amount, '']],
      });
    }
  });

  // Kelebihan baris lama dihapus - kecuali baris pertama blok, yang cukup
  // dikosongkan supaya tanggalnya tetap ada.
  const jualanRowsToDelete = [];
  jualanSync.surplus.forEach((row) => {
    if (row.row === block.startRow) {
      data.push({ range: `'${tab.title}'!B${row.row}:D${row.row}`, values: [['', '', '']] });
      return;
    }
    jualanRowsToDelete.push(row.row);
  });
  summary.jualanRemoved = jualanSync.surplus.length;

  // Pengeluaran: satu baris per jenis. Kalau barisnya sudah ada, nominalnya
  // ditimpa - rekap terakhir hari itu yang berlaku, bukan penjumlahan.
  const expensesPending = [];
  expensesToWrite.forEach((expense) => {
    const label = getExpenseLabel(layout, expense.kind);
    const existing = block.expenseRows[expense.kind];

    if (!existing) {
      expensesPending.push({ ...expense, label });
      return;
    }

    if (existing.amount === expense.amount) {
      summary.expenses.push({ ...expense, label, row: existing.row, action: 'unchanged' });
      return;
    }

    data.push({ range: `'${tab.title}'!D${existing.row}`, values: [[expense.amount]] });
    summary.expenses.push({ ...expense, label, row: existing.row, action: 'updated' });
  });

  const rowsToAdd = [];
  if (writeShopee && !block.shopeeRow) {
    rowsToAdd.push(['', layout.shopeeLabel, shopeeAmount, '']);
  }
  const jualanStartIndex = rowsToAdd.length;
  jualanPending.forEach((item) => {
    rowsToAdd.push(['', item.label, item.amount, '']);
  });
  offlineToAdd.forEach((amount) => {
    rowsToAdd.push(['', layout.offlineLabel, amount, '']);
  });
  const expenseStartIndex = rowsToAdd.length;
  expensesPending.forEach((expense) => {
    rowsToAdd.push(['', expense.label, '', expense.amount]);
  });
  expenseAmountsToAdd.forEach((item) => {
    rowsToAdd.push(['', item.label, '', item.amount]);
  });

  let jualanAddedStartRow = null;

  if (rowsToAdd.length) {
    let startRow = block.endRow + 1;

    if (!block.isLastBlock) {
      // Blok hari lain ada di bawahnya, jadi barisnya harus disisipkan supaya
      // urutan tanggalnya tidak rusak.
      await insertBlankRows(layout, tab.sheetId, block.endRow, rowsToAdd.length);
      summary.insertedInMiddle = true;
    } else {
      startRow = Math.max(block.endRow + 1, ledger.lastDataRow + 1);
    }

    data.push({
      range: `'${tab.title}'!A${startRow}:D${startRow + rowsToAdd.length - 1}`,
      values: rowsToAdd,
    });

    if (writeShopee && !block.shopeeRow) {
      summary.shopeeAction = 'added';
      summary.shopeeRow = startRow;
    }

    jualanAddedStartRow = startRow + jualanStartIndex;

    expensesPending.forEach((expense, index) => {
      summary.expenses.push({
        ...expense,
        row: startRow + expenseStartIndex + index,
        action: 'added',
      });
    });
  }

  await writeValues(layout, tab.title, data);
  // Setelah semua penulisan: baris yang dihapus ada di dalam blok, di atas
  // baris-baris baru, jadi nomor baris yang dipakai di atas masih berlaku.
  await deleteRows(layout, tab.sheetId, jualanRowsToDelete);

  // Nomor baris akhir, setelah baris di atasnya ada yang terhapus.
  const shiftAfterDelete = (row) => row - jualanRowsToDelete.filter((deleted) => deleted < row).length;
  let jualanAddedIndex = 0;
  summary.jualan = jualanSync.plan.map((item) => {
    const row =
      item.action === 'added' ? jualanAddedStartRow + jualanAddedIndex++ : item.existing.row;
    return { label: item.label, amount: item.amount, row: shiftAfterDelete(row), action: item.action };
  });

  summary.offlineAdded = offlineToAdd;
  summary.expenseAmountsAdded = expenseAmountsToAdd;
  summary.rowsAdded = rowsToAdd.length;
  summary.total =
    (writeShopee ? shopeeAmount : 0) +
    offlineToAdd.reduce((sum, amount) => sum + amount, 0) +
    summary.jualan
      .filter((item) => item.action !== 'unchanged')
      .reduce((sum, item) => sum + item.amount, 0);
  summary.expenseTotal =
    summary.expenses
      .filter((expense) => expense.action !== 'unchanged')
      .reduce((sum, expense) => sum + expense.amount, 0) +
    expenseAmountsToAdd.reduce((sum, item) => sum + item.amount, 0);

  return summary;
}

module.exports = {
  KeuanganSheetError,
  MONTHS_ID,
  diffOfflineAmounts,
  findDayBlock,
  getLayout,
  parseAmount,
  pickMonthlyTab,
  planJualanSync,
  serialToYmd,
  diffLabeledExpenses,
  writeDailyLedger,
  ymdToSerial,
  ymdToSheetDate,
};
