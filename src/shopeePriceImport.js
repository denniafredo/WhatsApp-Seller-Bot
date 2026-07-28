const { replaceShopeePriceRows } = require('./googleSheets');
const { loadHargaTerbaru } = require('./hargaTerbaru');
const { createShopeeClient } = require('./shopeeClient');
const { formatSyncTime } = require('./shopeePriceSync');
const { mapShopeeProduct } = require('./shopeeProductMap');

const ITEM_LIST_PAGE_SIZE = 100;
const BASE_INFO_CHUNK_SIZE = 20;
const MAX_PAGES = 50;

function getItemStatuses() {
  return String(process.env.SHOPEE_IMPORT_ITEM_STATUS || 'NORMAL,UNLIST')
    .split(',')
    .map((status) => status.trim().toUpperCase())
    .filter(Boolean);
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getOriginalPrice(priceInfo) {
  const price = Number(priceInfo?.[0]?.original_price);
  return Number.isFinite(price) && price > 0 ? price : '';
}

function buildModelName(model, tierVariations) {
  const optionNames = (model.tier_index || [])
    .map((optionIndex, tierIndex) => tierVariations?.[tierIndex]?.option_list?.[optionIndex]?.option)
    .filter(Boolean);

  if (optionNames.length) {
    return optionNames.join(', ');
  }

  return model.model_name || model.model_sku || `varian ${model.model_id}`;
}

async function fetchAllItemIds(client) {
  const itemStatuses = getItemStatuses();
  const itemIds = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.getItemList(offset, ITEM_LIST_PAGE_SIZE, itemStatuses);
    (response.item || []).forEach((item) => itemIds.push(String(item.item_id)));

    if (!response.has_next_page) {
      break;
    }

    offset = response.next_offset ?? offset + ITEM_LIST_PAGE_SIZE;
  }

  return [...new Set(itemIds)];
}

async function importShopeePrices() {
  const timeZone = process.env.RECAP_TIMEZONE || 'Asia/Makassar';
  const client = createShopeeClient();
  const itemIds = await fetchAllItemIds(client);

  if (!itemIds.length) {
    return { itemCount: 0, rows: [] };
  }

  const items = [];
  for (const itemIdChunk of chunk(itemIds, BASE_INFO_CHUNK_SIZE)) {
    const response = await client.getItemBaseInfo(itemIdChunk);
    items.push(...(response.item_list || []));
  }

  const importedAt = formatSyncTime(timeZone);
  const rows = [];

  for (const item of items) {
    if (!item.has_model) {
      rows.push({
        product: item.item_name || String(item.item_id),
        price: getOriginalPrice(item.price_info),
        target: String(item.item_id),
        note: `diambil ${importedAt}`,
      });
      continue;
    }

    const modelResponse = await client.getModelList(item.item_id);
    const models = modelResponse.model || [];
    const tierVariations = modelResponse.tier_variation || [];

    if (!models.length) {
      rows.push({
        product: item.item_name || String(item.item_id),
        price: '',
        target: String(item.item_id),
        note: `varian tidak terbaca · diambil ${importedAt}`,
      });
      continue;
    }

    models.forEach((model) => {
      rows.push({
        product: `${item.item_name} - ${buildModelName(model, tierVariations)}`,
        price: getOriginalPrice(model.price_info),
        target: `${item.item_id}:${model.model_id}`,
        note: `diambil ${importedAt}`,
      });
    });
  }

  rows.sort((left, right) => left.product.localeCompare(right.product, 'id'));

  const hargaTerbaru = await loadHargaTerbaru();
  rows.forEach((row) => {
    Object.assign(row, mapShopeeProduct(hargaTerbaru, row.product));
  });

  await replaceShopeePriceRows(rows);

  return { itemCount: items.length, rows, importedAt };
}

function buildImportReport(result) {
  const sheetName = process.env.SHOPEE_SHEET_NAME || 'Harga Shopee';

  if (!result.rows.length) {
    return `Tidak ada produk dengan status ${getItemStatuses().join('/')} di toko Shopee ini.`;
  }

  const variantCount = result.rows.filter((row) => row.target.includes(':')).length;
  const missingPriceCount = result.rows.filter((row) => row.price === '').length;
  const mappedRows = result.rows.filter((row) => row.referencePrice);
  const differentRows = mappedRows.filter((row) => row.referencePrice !== row.price);
  const manualRows = result.rows.filter((row) => row.source === 'manual');
  const lines = [
    `Berhasil ambil ${result.itemCount} produk (${result.rows.length} baris${variantCount ? `, ${variantCount} baris varian` : ''}) ke tab "${sheetName}".`,
    `Termapping ke "Harga Terbaru": ${mappedRows.length} baris, manual: ${manualRows.length} baris.`,
    `Harga Shopee beda dari Harga Terbaru: ${differentRows.length} baris.`,
  ];

  if (missingPriceCount) {
    lines.push(`${missingPriceCount} baris harganya kosong di Shopee, cek manual ya.`);
  }

  lines.push('Segarkan harga dari "Harga Terbaru" lalu isi kolom B: npm run map:harga');

  return lines.join('\n');
}

module.exports = { buildImportReport, importShopeePrices };
