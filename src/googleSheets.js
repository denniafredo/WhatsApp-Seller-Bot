const crypto = require('crypto');
const { renderRecapJpg } = require('./recapImage');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = String(process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY belum diisi.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsignedToken), privateKey).toString('base64url');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error_description || result.error || 'Gagal login ke Google Sheets.');
  }

  return result.access_token;
}

async function updateRecapSheet(recap) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Template pembayaran';
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum diisi.');
  }

  const clearedMainQuantities = Array.from({ length: 53 }, () => ['']);
  const clearedUsedBoxQuantities = Array.from({ length: 2 }, () => ['']);
  const data = [
    { range: `'${sheetName}'!B1`, values: [[recap.date]] },
    { range: `'${sheetName}'!D3:D55`, values: clearedMainQuantities },
    { range: `'${sheetName}'!D60:D61`, values: clearedUsedBoxQuantities },
    { range: `'${sheetName}'!D56`, values: [['=SUM(D3:D55)']] },
    { range: `'${sheetName}'!D62`, values: [['=SUM(D60:D61)']] },
    ...recap.quantities.map((item) => ({
      range: `'${sheetName}'!D${item.row}`,
      values: [[item.quantity]],
    })),
  ];

  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Service account ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} belum memiliki akses Editor ke spreadsheet.`
      );
    }
    throw new Error(result.error?.message || 'Gagal memperbarui Google Sheet.');
  }

  return result;
}

async function getRecapOutput(format = 'pdf') {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Template pembayaran';
  const sheetId = process.env.GOOGLE_SHEET_GID || '1828439131';
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}` };

  const valuesUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`
  );
  valuesUrl.searchParams.append('ranges', `'${sheetName}'!D56`);
  valuesUrl.searchParams.append('ranges', `'${sheetName}'!E58`);
  valuesUrl.searchParams.append('ranges', `'${sheetName}'!D62:E62`);
  if (format === 'jpg') {
    valuesUrl.searchParams.append('ranges', `'${sheetName}'!A1:E62`);
  }
  valuesUrl.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');

  const exportUrl = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`
  );
  Object.entries({
    format: 'pdf',
    gid: sheetId,
    range: 'A1:E62',
    size: 'A4',
    portrait: 'true',
    fitw: 'true',
    sheetnames: 'false',
    printtitle: 'false',
    pagenumbers: 'false',
    gridlines: 'true',
    fzr: 'false',
  }).forEach(([key, value]) => exportUrl.searchParams.set(key, value));

  const [valuesResponse, pdfResponse] = await Promise.all([
    fetch(valuesUrl, { headers }),
    format === 'pdf' ? fetch(exportUrl, { headers }) : Promise.resolve(null),
  ]);

  const valuesResult = await valuesResponse.json();
  if (!valuesResponse.ok) {
    throw new Error(valuesResult.error?.message || 'Gagal membaca total dari Google Sheet.');
  }
  if (pdfResponse && !pdfResponse.ok) {
    throw new Error(`Gagal export PDF Google Sheet (${pdfResponse.status}).`);
  }

  let fileBase64;
  if (format === 'jpg') {
    const sheetRows = valuesResult.valueRanges?.[3]?.values || [];
    const jpgBuffer = await renderRecapJpg(sheetRows);
    fileBase64 = `data:image/jpeg;base64,${jpgBuffer.toString('base64')}`;
  } else {
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    fileBase64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
  }

  return {
    fileBase64,
    fileExtension: format,
    totalQuantity: valuesResult.valueRanges?.[0]?.values?.[0]?.[0] || '0',
    totalAmount: valuesResult.valueRanges?.[1]?.values?.[0]?.[0] || 'Rp0',
    cashQuantity: valuesResult.valueRanges?.[2]?.values?.[0]?.[0] || '0',
    cashAmount: valuesResult.valueRanges?.[2]?.values?.[0]?.[1] || 'Rp0',
  };
}

function getShopeeSheetName() {
  return process.env.SHOPEE_SHEET_NAME || 'Harga Shopee';
}

function parseSheetPrice(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) {
    return null;
  }

  const price = Number(digits);
  return Number.isFinite(price) && price > 0 ? price : null;
}

const SHOPEE_SHEET_HEADERS = [
  'Produk',
  'Harga',
  'item_id (jangan diubah)',
  'Status',
  'Ringkas',
  'Harga Terbaru',
  'Sumber',
];

async function getSheetValues(range) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID belum diisi.');
  }

  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || `Gagal membaca range ${range} di Google Sheet.`);
  }

  return result.values || [];
}

async function writeSheetRanges(data) {
  if (!data.length) {
    return null;
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const accessToken = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    }
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Gagal menulis ke Google Sheet.');
  }

  return result;
}

async function getShopeePriceRows() {
  const sheetName = getShopeeSheetName();
  // Range terbuka (tanpa nomor baris akhir) supaya jumlah produk tidak terpotong.
  const values = await getSheetValues(`'${sheetName}'!A2:G`);

  return values.map((columns, index) => ({
    row: index + 2,
    product: String(columns[0] ?? '').trim(),
    price: parseSheetPrice(columns[1]),
    rawPrice: String(columns[1] ?? '').trim(),
    target: String(columns[2] ?? '').trim(),
    summary: String(columns[4] ?? '').trim(),
    referencePrice: parseSheetPrice(columns[5]),
    source: String(columns[6] ?? '').trim(),
  }));
}

async function clearShopeePriceRows() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = getShopeeSheetName();
  const accessToken = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!A2:G`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error?.message || `Gagal mengosongkan tab "${sheetName}".`);
  }

  return true;
}

async function replaceShopeePriceRows(rows) {
  const sheetName = getShopeeSheetName();

  // Dikosongkan dulu supaya sisa impor sebelumnya tidak tertinggal, lalu ditulis sepanjang data.
  await clearShopeePriceRows();

  return writeSheetRanges([
    { range: `'${sheetName}'!A1:G1`, values: [SHOPEE_SHEET_HEADERS] },
    {
      range: `'${sheetName}'!A2:G${rows.length + 1}`,
      values: rows.map((row) => [
        row.product,
        row.price,
        row.target,
        row.note || '',
        row.summary || '',
        row.referencePrice ?? '',
        row.source || '',
      ]),
    },
  ]);
}

async function updateShopeePriceStatus(statuses) {
  const sheetName = getShopeeSheetName();

  return writeSheetRanges(
    statuses.map((status) => ({
      range: `'${sheetName}'!D${status.row}`,
      values: [[status.text]],
    }))
  );
}

async function updateShopeeMappingColumns(rows) {
  if (!rows.length) {
    return null;
  }

  const sheetName = getShopeeSheetName();
  const firstRow = rows[0].row;

  // Baris dari getShopeePriceRows selalu berurutan, jadi kolom E:G bisa ditulis satu blok.
  return writeSheetRanges([
    {
      range: `'${sheetName}'!E${firstRow}:G${firstRow + rows.length - 1}`,
      values: rows.map((row) => [row.summary || '', row.referencePrice ?? '', row.source || '']),
    },
  ]);
}

async function applyShopeeReferencePrices(updates) {
  const sheetName = getShopeeSheetName();

  return writeSheetRanges(
    updates.map((update) => ({
      range: `'${sheetName}'!B${update.row}`,
      values: [[update.price]],
    }))
  );
}

module.exports = {
  applyShopeeReferencePrices,
  getRecapOutput,
  getSheetValues,
  getShopeePriceRows,
  replaceShopeePriceRows,
  updateRecapSheet,
  updateShopeeMappingColumns,
  updateShopeePriceStatus,
};
