// Ringkasan singkat hasil "rekap" yang dikirim ke grup lain (default "booot"),
// supaya angka kulakan dan kas hari itu terbaca tanpa harus membuka grup
// pesanan yang penuh obrolan.

const { resolveGroupId } = require('./groupResolver');

const config = {
  enabled: process.env.REKAP_SUMMARY_ENABLED !== 'false',
  groupName: process.env.REKAP_SUMMARY_GROUP_NAME || 'booot',
  groupId: process.env.REKAP_SUMMARY_GROUP_ID || '',
  totalLabel: process.env.REKAP_SUMMARY_TOTAL_LABEL || 'kulakan yohan',
  cashLabel: process.env.REKAP_SUMMARY_CASH_LABEL || 'kas',
};

function buildRecapSummary(output, options = {}) {
  const totalLabel = options.totalLabel || config.totalLabel;
  const cashLabel = options.cashLabel || config.cashLabel;

  return [
    `${totalLabel}: ${output.totalAmount}`,
    `${cashLabel}: ${output.cashAmount}`,
  ].join('\n');
}

function resolveSummaryGroupId(client, message) {
  return resolveGroupId(client, {
    message,
    groupId: config.groupId,
    groupName: config.groupName,
    envHint: 'Set REKAP_SUMMARY_GROUP_NAME atau REKAP_SUMMARY_GROUP_ID di .env.',
  });
}

// Mengembalikan hasilnya alih-alih melempar untuk kasus yang bukan kegagalan
// (fitur dimatikan, atau tujuannya grup yang sama) supaya pemanggil tidak
// perlu membedakan "tidak dikirim" dari "gagal dikirim".
async function sendRecapSummary(client, message, output) {
  if (!config.enabled) {
    return { sent: false, reason: 'dimatikan' };
  }

  const groupId = await resolveSummaryGroupId(client, message);

  // Rekapnya sendiri sudah memuat total dan kas, jadi mengirim ringkasan ke
  // grup yang sama cuma mengulang angka yang baru saja lewat.
  if (String(groupId) === String(message?.from || '')) {
    return { sent: false, reason: 'grup tujuan sama dengan grup rekap', groupId };
  }

  const text = buildRecapSummary(output);
  await client.sendText(groupId, text);

  return { sent: true, groupId, text };
}

module.exports = {
  buildRecapSummary,
  config,
  resolveSummaryGroupId,
  sendRecapSummary,
};
