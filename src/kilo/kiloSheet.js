// Menulis hasil "cek kilo" ke tab Google Sheet supaya bisa dibuka & diolah
// lebih lanjut, lalu mengembalikan link tabnya untuk dibalas ke WhatsApp.

const { getAccessToken } = require('../sheets/googleSheets');

const SHEET_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DEFAULT_SHEET_NAME = 'Summary Kiloan';
// Contoh nyata: https://web.bilas.id/transaksi/reguler/TRX%2F260919%2F001?id=VFaKaoAUIUf5fJpTOaDG
const DEFAULT_TRX_URL = 'https://web.bilas.id/transaksi/reguler/{nota}?id={id}';

const HEADERS = [
  'No', 'Tanggal', 'Nama (aplikasi)', 'Nama di foto', 'Kg Foto', 'Kg Aplikasi',
  'Selisih', 'Keterangan', 'Status', 'Nota', 'Pengerjaan',
];

// Kolom terakhir yang dipakai (K = indeks 10).
const LAST_COL_INDEX = HEADERS.length - 1;
const NOTA_COL_INDEX = HEADERS.indexOf('Nota');
const HEADER_ROW = 4;          // baris 1-based di sheet
const FIRST_DATA_ROW = 5;

const STATUS_LABEL = {
  match: 'Sama persis',
  match_toleransi: 'Beda tipis (msh toleransi)',
  kilo_diff: 'Beda kilo',
  no_kilo: 'Satuan / tanpa kg',
  not_in_bilas: 'Tak ada di Bilas',
  uncertain: 'Ragu baca',
};

const STATUS_COLOR = {
  match: { red: 0.85, green: 0.94, blue: 0.83 },
  match_toleransi: { red: 0.99, green: 0.96, blue: 0.79 },
  kilo_diff: { red: 0.98, green: 0.80, blue: 0.78 },
  no_kilo: { red: 0.85, green: 0.92, blue: 0.98 },
  not_in_bilas: { red: 0.98, green: 0.80, blue: 0.78 },
  uncertain: { red: 0.99, green: 0.89, blue: 0.75 },
};

class KiloSheetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KiloSheetError';
    this.code = code;
  }
}

function getSheetName() {
  return process.env.KILO_SHEET_NAME || DEFAULT_SHEET_NAME;
}

// Nota harus di-encode ("/" jadi %2F) karena ia bagian dari path, bukan query.
function buildTrxUrl(row) {
  if (!row.noNota) return '';
  const template = process.env.BILAS_TRX_URL || DEFAULT_TRX_URL;
  return template
    .replace('{nota}', encodeURIComponent(row.noNota))
    .replace('{notaRaw}', row.noNota)
    .replace('{id}', row.bilasId || '');
}

// Link nota dipasang sebagai link teks lewat API, BUKAN formula =HYPERLINK():
// spreadsheet ini ber-locale Indonesia sehingga pemisah argumen formula adalah
// ";" bukan ",", dan formula yang ditulis via API jadi #ERROR!.
function linkRequests(sheetId, rows) {
  return rows
    .map((row, index) => {
      // Tanpa id transaksi link-nya tidak bisa dibuka; biarkan teks biasa.
      const uri = row.noNota && row.bilasId ? buildTrxUrl(row) : '';
      if (!uri) return null;
      return {
        updateCells: {
          range: {
            sheetId,
            startRowIndex: FIRST_DATA_ROW - 1 + index,
            endRowIndex: FIRST_DATA_ROW + index,
            startColumnIndex: NOTA_COL_INDEX,
            endColumnIndex: NOTA_COL_INDEX + 1,
          },
          rows: [{
            values: [{
              userEnteredValue: { stringValue: row.noNota },
              userEnteredFormat: {
                textFormat: {
                  link: { uri },
                  underline: true,
                  foregroundColor: { red: 0.06, green: 0.33, blue: 0.80 },
                },
              },
            }],
          }],
          fields: 'userEnteredValue,userEnteredFormat.textFormat',
        },
      };
    })
    .filter(Boolean);
}

function statusText(row) {
  const label = STATUS_LABEL[row.state] || row.state || '';
  return row.weakName ? `${label} (cek nama)` : label;
}

async function callSheets(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${SHEET_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403) {
      throw new KiloSheetError(
        'SHEET_FORBIDDEN',
        `Service account ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} belum punya akses Editor ke spreadsheet.`
      );
    }
    throw new KiloSheetError('SHEET_FAILED', result.error?.message || `Google Sheets menolak (${response.status}).`);
  }
  return result;
}

async function findSheetId(spreadsheetId, sheetName, token) {
  const meta = await callSheets(
    `${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { token }
  );
  const found = (meta.sheets || []).find((s) => s.properties?.title === sheetName);
  if (!found) {
    throw new KiloSheetError('NO_TAB', `Tab "${sheetName}" tidak ada di spreadsheet.`);
  }
  return found.properties.sheetId;
}

function buildRows({ outletName, rangeLabel, photoCount, bilasCount, comparison, checkedAt }) {
  const { rows, tolerance, counts } = comparison;
  const ringkas = [
    `Sama persis ${counts.match}`,
    `beda tipis ${counts.matchToleransi}`,
    `beda kilo ${counts.kiloDiff}`,
    `satuan ${counts.noKilo}`,
    `tak ada di Bilas ${counts.notInBilas}`,
    `ragu baca ${counts.uncertain}`,
  ].join(' • ');

  const values = [
    [`Cek kilo — ${outletName}`],
    [`Periode ${rangeLabel} • Dicek ${checkedAt} • Foto ${photoCount} baris • Bilas ${bilasCount} transaksi • Toleransi ±${String(tolerance).replace('.', ',')} kg • ${ringkas}`],
    [],
    HEADERS,
  ];

  rows.forEach((row, index) => {
    values.push([
      index + 1,
      row.tanggal || '',
      row.nama || '',
      row.namaFoto || '',
      row.photoKilo == null ? '' : row.photoKilo,
      row.bilasKilo == null ? '' : row.bilasKilo,
      row.selisih == null ? '' : row.selisih,
      row.keterangan || '',
      statusText(row),
      row.noNota || '',
      row.status || '',
    ]);
  });

  return values;
}

function buildFormatRequests(sheetId, comparison) {
  const dataRowCount = comparison.rows.length;
  const lastRow = FIRST_DATA_ROW - 1 + dataRowCount; // 0-based exclusive end
  const requests = [
    // Bersihkan isi + format lama supaya sisa hasil sebelumnya tidak menempel.
    {
      updateCells: {
        range: { sheetId },
        fields: 'userEnteredValue,userEnteredFormat,textFormatRuns',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: HEADER_ROW } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Judul.
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    // Baris header tabel.
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: HEADER_ROW - 1,
          endRowIndex: HEADER_ROW,
          startColumnIndex: 0,
          endColumnIndex: LAST_COL_INDEX + 1,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.90, green: 0.90, blue: 0.90 },
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
  ];

  if (!dataRowCount) {
    return requests;
  }

  const dataRange = (startColumnIndex, endColumnIndex) => ({
    sheetId,
    startRowIndex: FIRST_DATA_ROW - 1,
    endRowIndex: lastRow,
    startColumnIndex,
    endColumnIndex,
  });

  // Tanggal transaksi: USER_ENTERED mengubahnya jadi tanggal asli, jadi
  // formatnya dikunci supaya tidak ikut berubah mengikuti locale sheet.
  requests.push({
    repeatCell: {
      range: dataRange(1, 2),
      cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  // Kg foto & kg aplikasi: 2 desimal; kg aplikasi ditebalkan karena itu angka
  // acuan yang dipakai untuk menghitung.
  requests.push({
    repeatCell: {
      range: dataRange(4, 5),
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });
  requests.push({
    repeatCell: {
      range: dataRange(5, 6),
      cell: {
        userEnteredFormat: {
          numberFormat: { type: 'NUMBER', pattern: '0.00' },
          textFormat: { bold: true },
        },
      },
      fields: 'userEnteredFormat(numberFormat,textFormat)',
    },
  });
  // Selisih: tanda + / - selalu tampak, nol ditulis "sama".
  requests.push({
    repeatCell: {
      range: dataRange(6, 7),
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '+0.00;-0.00;"sama"' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });

  // Warna per baris menurut status, supaya yang perlu dicek langsung kelihatan.
  comparison.rows.forEach((row, index) => {
    const color = STATUS_COLOR[row.state];
    if (!color) return;
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: FIRST_DATA_ROW - 1 + index,
          endRowIndex: FIRST_DATA_ROW + index,
          startColumnIndex: 0,
          endColumnIndex: LAST_COL_INDEX + 1,
        },
        cell: { userEnteredFormat: { backgroundColor: color } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  });

  const widths = [40, 90, 200, 160, 70, 90, 70, 160, 170, 140, 100];
  widths.forEach((pixelSize, index) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 },
        properties: { pixelSize },
        fields: 'pixelSize',
      },
    });
  });

  return requests;
}

/**
 * Menulis hasil perbandingan ke tab Google Sheet (menimpa isi sebelumnya).
 * @returns {{ url, sheetName, rowCount }}
 */
async function writeKiloSummary(context) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new KiloSheetError('NO_SHEET_ID', 'GOOGLE_SHEET_ID belum diisi di .env.');
  }

  const sheetName = getSheetName();
  const token = await getAccessToken();
  const sheetId = await findSheetId(spreadsheetId, sheetName, token);
  const values = buildRows(context);

  // Format dulu (termasuk membersihkan isi lama), baru tulis nilainya.
  await callSheets(`${spreadsheetId}:batchUpdate`, {
    token,
    method: 'POST',
    body: { requests: buildFormatRequests(sheetId, context.comparison) },
  });

  const range = encodeURIComponent(`'${sheetName}'!A1`);
  await callSheets(`${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    token,
    method: 'PUT',
    body: { values },
  });

  // Link nota dipasang setelah nilainya ada, supaya tidak tertimpa values.update.
  const links = linkRequests(sheetId, context.comparison.rows);
  if (links.length) {
    await callSheets(`${spreadsheetId}:batchUpdate`, {
      token,
      method: 'POST',
      body: { requests: links },
    });
  }

  return {
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
    sheetName,
    rowCount: context.comparison.rows.length,
  };
}

module.exports = {
  writeKiloSummary,
  buildTrxUrl,
  buildRows,
  linkRequests,
  statusText,
  KiloSheetError,
  DEFAULT_TRX_URL,
};
