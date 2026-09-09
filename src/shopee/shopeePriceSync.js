const { getShopeePriceRows, updateShopeePriceStatus } = require('../sheets/googleSheets');
const { createShopeeClient } = require('./shopeeClient');

const BASE_INFO_CHUNK_SIZE = 20;
const UPDATE_DELAY_MS = 400;

function formatPrice(value) {
  return new Intl.NumberFormat('id-ID').format(value);
}

function formatSyncTime(timeZone) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

function parseTarget(target) {
  const [itemPart, modelPart] = String(target).split(':');
  const itemId = String(itemPart || '').replace(/[^\d]/g, '');
  const modelId = String(modelPart || '').replace(/[^\d]/g, '');

  if (!itemId) {
    return null;
  }

  return { itemId, modelId: modelId || null };
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOriginalPrice(priceInfo) {
  const price = Number(priceInfo?.[0]?.original_price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function fetchItemInfo(client, itemIds) {
  const itemsById = new Map();

  for (const itemIdChunk of chunk(itemIds, BASE_INFO_CHUNK_SIZE)) {
    const response = await client.getItemBaseInfo(itemIdChunk);
    (response.item_list || []).forEach((item) => {
      itemsById.set(String(item.item_id), item);
    });
  }

  return itemsById;
}

async function resolveTargets(client, rows, itemsById) {
  const modelListCache = new Map();
  const resolved = [];

  for (const row of rows) {
    const item = itemsById.get(row.itemId);
    if (!item) {
      resolved.push({ ...row, status: 'failed', message: `item_id ${row.itemId} tidak ada di toko ini` });
      continue;
    }

    let modelId = row.modelId;
    let currentPrice = getOriginalPrice(item.price_info);

    if (item.has_model) {
      if (!modelListCache.has(row.itemId)) {
        modelListCache.set(row.itemId, await client.getModelList(row.itemId));
      }
      const models = modelListCache.get(row.itemId).model || [];

      if (!modelId && models.length === 1) {
        modelId = String(models[0].model_id);
      }

      if (!modelId) {
        const modelHints = models
          .map((model) => `${row.itemId}:${model.model_id}`)
          .join(', ');
        resolved.push({
          ...row,
          status: 'failed',
          message: `punya ${models.length} varian, tulis di kolom C salah satu: ${modelHints}`,
        });
        continue;
      }

      const model = models.find((candidate) => String(candidate.model_id) === modelId);
      if (!model) {
        resolved.push({ ...row, status: 'failed', message: `model_id ${modelId} tidak ada di item ${row.itemId}` });
        continue;
      }

      currentPrice = getOriginalPrice(model.price_info);
    } else if (modelId) {
      resolved.push({
        ...row,
        status: 'failed',
        message: `item ${row.itemId} tidak punya variasi, hapus ":${modelId}" di kolom C`,
      });
      continue;
    }

    if (currentPrice === row.price) {
      resolved.push({ ...row, status: 'unchanged', currentPrice, itemName: item.item_name });
      continue;
    }

    resolved.push({ ...row, status: 'pending', modelId, currentPrice, itemName: item.item_name });
  }

  return resolved;
}

function getFailureReason(failure) {
  return (
    failure?.failed_reason ||
    failure?.failure_reason ||
    failure?.failure_message ||
    failure?.failure_error ||
    'ditolak Shopee tanpa detail'
  );
}

async function applyUpdates(client, pendingRows) {
  const rowsByItemId = new Map();
  pendingRows.forEach((row) => {
    const rows = rowsByItemId.get(row.itemId) || [];
    rows.push(row);
    rowsByItemId.set(row.itemId, rows);
  });

  let isFirstCall = true;
  for (const [itemId, rows] of rowsByItemId) {
    if (!isFirstCall) {
      await delay(UPDATE_DELAY_MS);
    }
    isFirstCall = false;

    const priceList = rows.map((row) =>
      row.modelId
        ? { model_id: Number(row.modelId), original_price: row.price }
        : { original_price: row.price }
    );

    try {
      const response = await client.updatePrice(itemId, priceList);
      const failures = response.failure_list || [];

      rows.forEach((row) => {
        const failure = failures.find((candidate) =>
          row.modelId ? String(candidate.model_id) === row.modelId : true
        );

        if (failure && (failures.length === 1 || row.modelId)) {
          row.status = 'failed';
          row.message = getFailureReason(failure);
          return;
        }

        row.status = 'updated';
      });
    } catch (error) {
      rows.forEach((row) => {
        row.status = 'failed';
        row.message = error.message;
      });
    }
  }
}

function buildStatusText(row, syncedAt) {
  if (row.status === 'updated') {
    return `OK ${formatPrice(row.currentPrice ?? 0)} -> ${formatPrice(row.price)} · ${syncedAt}`;
  }

  if (row.status === 'unchanged') {
    return `SAMA ${formatPrice(row.price)} · ${syncedAt}`;
  }

  return `GAGAL ${row.message} · ${syncedAt}`;
}

async function syncShopeePrices() {
  const timeZone = process.env.RECAP_TIMEZONE || 'Asia/Makassar';
  const sheetRows = await getShopeePriceRows();
  const targetedRows = [];

  sheetRows.forEach((sheetRow) => {
    if (!sheetRow.target) {
      return;
    }

    const target = parseTarget(sheetRow.target);
    if (!target) {
      targetedRows.push({
        ...sheetRow,
        status: 'failed',
        message: `kolom C "${sheetRow.target}" bukan item_id yang valid`,
      });
      return;
    }

    if (!sheetRow.price) {
      targetedRows.push({
        ...sheetRow,
        ...target,
        status: 'failed',
        message: `harga "${sheetRow.rawPrice}" tidak valid`,
      });
      return;
    }

    targetedRows.push({ ...sheetRow, ...target, status: 'pending' });
  });

  if (!targetedRows.length) {
    return { total: 0, updated: [], unchanged: [], failed: [] };
  }

  const client = createShopeeClient();
  const readyRows = targetedRows.filter((row) => row.status === 'pending');
  const itemIds = [...new Set(readyRows.map((row) => row.itemId))];
  const itemsById = itemIds.length ? await fetchItemInfo(client, itemIds) : new Map();
  const resolvedRows = await resolveTargets(client, readyRows, itemsById);
  const allRows = [...targetedRows.filter((row) => row.status === 'failed'), ...resolvedRows];

  await applyUpdates(client, allRows.filter((row) => row.status === 'pending'));

  const syncedAt = formatSyncTime(timeZone);
  await updateShopeePriceStatus(
    allRows.map((row) => ({ row: row.row, text: buildStatusText(row, syncedAt) }))
  );

  return {
    total: allRows.length,
    updated: allRows.filter((row) => row.status === 'updated'),
    unchanged: allRows.filter((row) => row.status === 'unchanged'),
    failed: allRows.filter((row) => row.status === 'failed'),
  };
}

function buildSyncReport(result) {
  if (!result.total) {
    const sheetName = process.env.SHOPEE_SHEET_NAME || 'Harga Shopee';
    return `Tidak ada baris yang punya item_id di kolom C tab "${sheetName}".`;
  }

  const lines = [
    `Sync harga Shopee: ${result.updated.length} diupdate, ${result.unchanged.length} sudah sama, ${result.failed.length} gagal.`,
  ];

  result.updated.forEach((row) => {
    lines.push(
      `✅ ${row.product || row.itemName || row.itemId}: ${formatPrice(row.currentPrice ?? 0)} → ${formatPrice(row.price)}`
    );
  });
  result.failed.forEach((row) => {
    lines.push(`❌ ${row.product || row.itemId} (baris ${row.row}): ${row.message}`);
  });

  return lines.join('\n');
}

module.exports = { buildSyncReport, formatPrice, formatSyncTime, syncShopeePrices };
