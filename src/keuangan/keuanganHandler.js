// Orkestrasi "auto rekap": tarik dana Shopee -> baca setoran offline dan
// ringkasan kulakan/kas dari grup rekap -> tulis semuanya ke spreadsheet
// keuangan (pemasukan di kolom C, pengeluaran di kolom D) -> balas ringkasan.
//
// Meniru pola kiloHandler (queue + progress reporter + describeFailure).
//
// Urutan tahapnya disengaja: Shopee lebih dulu, karena itu satu-satunya tahap
// yang memindahkan uang. Kalau tahap itu gagal, tidak ada yang tertulis ke
// sheet dan tidak ada angka separuh jadi yang perlu dibersihkan.

const { getKeuanganCommand } = require('./keuanganTrigger');
const { collectManualExpenses, collectOfflineIncome } = require('./offlineParser');
const { collectRecapExpenses } = require('./pengeluaranParser');
const {
  ShopeeWithdrawError,
  formatRupiah,
  withdrawShopeeBalance,
} = require('./shopeeWithdrawClient');
const { KeuanganSheetError, writeDailyLedger } = require('./keuanganSheet');
const { createProgressReporter } = require('../shared/progressReporter');
const { resolveGroupId } = require('../shared/groupResolver');
const {
  config: summaryConfig,
  resolveSummaryGroupId,
} = require('../shared/recapSummary');

const config = {
  groupName: process.env.KEUANGAN_GROUP_NAME || 'rekap harian',
  groupId: process.env.KEUANGAN_GROUP_ID || '',
  historyCount: Math.min(Math.max(Number(process.env.KEUANGAN_HISTORY_COUNT) || 500, 50), 3000),
};

function describeFailure(error) {
  switch (error && error.code) {
    case 'NO_CREDENTIALS':
      return 'Akun Seller Centre Shopee belum diatur di server (SHOPEE_SELLER_USERNAME/PASSWORD). Hubungi admin.';
    case 'OTP_REQUIRED':
    case 'CAPTCHA_REQUIRED':
      return `${error.message}`;
    case 'LOGIN_FAILED':
      return `Login Shopee gagal: ${error.message}`;
    case 'BALANCE_PAGE_FAILED':
    case 'BALANCE_NOT_FOUND':
      return `Saldo Shopee tidak terbaca: ${error.message}`;
    case 'BALANCE_OVER_CAP':
    case 'VERIFICATION_REQUIRED':
    case 'PAGE_UNSTABLE':
    case 'NAVIGATION_FAILED':
    case 'SESSION_EXPIRED':
    case 'LOGIN_TIMEOUT':
    case 'BROWSER_FAILED':
      return error.message;
    case 'WITHDRAW_BUTTON_MISSING':
    case 'WITHDRAW_PASSWORD_MISSING':
      return `Penarikan tidak bisa dilanjutkan: ${error.message}`;
    case 'WITHDRAW_PASSWORD_REJECTED':
      return 'Password penarikan Shopee ditolak. Tidak ada dana yang ditarik.';
    case 'BALANCE_PASSWORD_REJECTED':
      return 'Kata sandi untuk membuka halaman Saldo Saya ditolak. Tidak ada dana yang ditarik.';
    case 'WITHDRAW_OTP_REQUIRED':
    case 'WITHDRAW_UNCONFIRMED':
    case 'WITHDRAW_PIN_REQUIRED':
    case 'WITHDRAW_PIN_MISSING':
    case 'WITHDRAW_PIN_REJECTED':
    case 'WITHDRAW_PIN_INVALID':
      return error.message;
    // Pengaman berhenti sebelum apa pun dikirim, jadi pesannya harus menegaskan
    // itu - kalau tidak, orang akan mengira uangnya sudah bergerak.
    case 'WITHDRAW_FORM_MISSING':
    case 'WITHDRAW_CONFIRM_MISSING':
    case 'WITHDRAW_AMOUNT_UNREADABLE':
    case 'WITHDRAW_AMOUNT_MISMATCH':
    case 'WITHDRAW_DESTINATION_UNKNOWN':
    case 'WITHDRAW_DESTINATION_MISMATCH':
      return `${error.message} (tidak ada dana yang ditarik)`;
    case 'GROUP_NOT_FOUND':
      return error.message;
    case 'NO_SHEET_ID':
      return 'KEUANGAN_SHEET_ID belum diatur di server. Hubungi admin.';
    case 'NO_SHEET_ACCESS':
    case 'SHEET_NOT_FOUND':
    case 'TAB_NOT_FOUND':
    case 'SHEET_FAILED':
      return error.message;
    case 'QUEUE_FULL':
      return 'Sedang ada auto rekap lain berjalan. Tunggu sampai selesai ya.';
    default:
      return `Auto rekap gagal: ${(error && error.message) || 'error tidak diketahui'}`;
  }
}

// Cari grup "rekap harian" tempat setoran offline dilaporkan.
async function resolveRekapGroupId(client, message) {
  return resolveGroupId(client, {
    message,
    groupId: config.groupId,
    groupName: config.groupName,
    envHint: 'Set KEUANGAN_GROUP_NAME atau KEUANGAN_GROUP_ID di .env.',
  });
}

function dedupeMessages(lists) {
  const byIdentity = new Map();

  lists.flat().forEach((message) => {
    if (!message) {
      return;
    }
    const id = message.id?._serialized || message.id?.id || message.id;
    const identity =
      id && typeof id !== 'object'
        ? String(id)
        : [message.t || message.timestamp || 0, message.author || message.from || '', message.body || ''].join('|');
    byIdentity.set(identity, message);
  });

  return [...byIdentity.values()];
}

async function loadGroupMessages(client, groupId, getGroupBuffer) {
  const history = await client
    .getMessages(groupId, { count: config.historyCount })
    .catch((error) => {
      console.error(`Gagal baca history grup ${groupId}:`, error.message);
      return [];
    });
  const buffered = getGroupBuffer ? getGroupBuffer(groupId) || [] : [];

  return dedupeMessages([history, buffered]);
}

function buildReply({ command, shopee, offline, expenses, manualExpenses, sheet }) {
  const lines = [];

  lines.push(`*Auto rekap — ${command.dateLabel}*`);
  lines.push(`Tab: ${sheet.sheetName}`);
  lines.push('');

  if (shopee.skipped) {
    lines.push(`Shopee: _dilewati_ (${shopee.reason})`);
  } else if (shopee.status === 'reused') {
    lines.push(
      `Shopee: ${formatRupiah(shopee.amount)} _(sudah ditarik hari ini, tidak ditarik ulang)_`
    );
  } else if (shopee.status === 'zero-balance') {
    lines.push('Shopee: Rp0 _(tidak ada saldo yang bisa ditarik)_');
  } else if (shopee.status === 'dry-run') {
    lines.push(`Shopee: ${formatRupiah(shopee.amount)} _(DRY RUN — dana tidak ditarik)_`);
  } else {
    lines.push(`Shopee: *${formatRupiah(shopee.amount)}* _(tarik dana berhasil)_`);
  }

  if (sheet.shopeeAction === 'unchanged') {
    lines.push('  _sudah tercatat dengan nominal sama, tidak diubah_');
  } else if (sheet.shopeeAction === 'updated') {
    lines.push(`  _baris ${sheet.shopeeRow} diperbarui_`);
  }

  lines.push('');
  lines.push(`Offline: ${offline.entries.length} setoran, total ${formatRupiah(offline.total)}`);
  offline.entries.forEach((entry) => {
    lines.push(`  • ${entry.author}: ${formatRupiah(entry.amount)} _(${entry.raw})_`);
  });

  if (offline.skippedNoTimestamp) {
    lines.push(`  _${offline.skippedNoTimestamp} pesan dilewati karena waktunya tidak terbaca._`);
  }

  if (sheet.offlineAlreadyThere) {
    lines.push(`  _${sheet.offlineAlreadyThere} setoran sudah ada di sheet, tidak ditulis ulang._`);
  }

  lines.push('');
  lines.push('Pengeluaran:');

  const describeExpenseAction = (expense) => {
    if (expense.action === 'updated') {
      return `baris ${expense.row} diperbarui`;
    }
    if (expense.action === 'unchanged') {
      return `baris ${expense.row} sudah sama`;
    }
    return `ditulis di baris ${expense.row}`;
  };

  if (expenses.groupMissing) {
    lines.push(`  _grup ringkasan "${summaryConfig.groupName}" tidak ditemukan, kulakan/kas dilewati._`);
  } else if (!expenses.entry) {
    lines.push(`  _ringkasan rekap ${command.dateLabel} belum ada di grup, kulakan/kas dilewati._`);
  }

  sheet.expenses.forEach((expense) => {
    lines.push(
      `  • ${expense.label}: *${formatRupiah(expense.amount)}* _(${describeExpenseAction(expense)})_`
    );
  });

  sheet.expensesZero.forEach((expense) => {
    lines.push(`  • ${expense.label}: Rp0 _(tidak ditulis)_`);
  });

  if (expenses.found > 1) {
    lines.push(`  _${expenses.found} ringkasan ditemukan, dipakai yang terakhir._`);
  }

  manualExpenses.entries.forEach((entry) => {
    lines.push(`  • ${entry.author}: ${formatRupiah(entry.amount)} _(${entry.raw})_`);
  });

  if (sheet.expenseAmountsAlreadyThere) {
    lines.push(
      `  _${sheet.expenseAmountsAlreadyThere} pengeluaran sudah ada di sheet, tidak ditulis ulang._`
    );
  }

  lines.push('');

  const nothingChanged =
    !sheet.rowsAdded &&
    sheet.shopeeAction !== 'updated' &&
    !sheet.expenses.some((expense) => expense.action === 'updated');

  if (nothingChanged) {
    lines.push('*Sheet tidak berubah* — semuanya sudah tercatat.');
  } else {
    lines.push(`Masuk: *${formatRupiah(sheet.total)}*`);
    lines.push(`Keluar: *${formatRupiah(sheet.expenseTotal)}*`);
    lines.push(
      `${sheet.rowsAdded} baris baru` +
        (sheet.blockExisted ? ` di blok ${command.dateLabel}` : ' (blok tanggal baru)') +
        (sheet.insertedInMiddle ? ' _(disisipkan di tengah)_' : '')
    );
  }

  return lines.join('\n');
}

async function runKeuanganJob(client, message, command, deps, reporter) {
  const { getGroupBuffer } = deps;

  // --- 1. Shopee (satu-satunya tahap yang memindahkan uang) ---
  let shopee = { amount: 0, status: 'skipped', skipped: true, reason: '' };

  if (command.skipShopee) {
    shopee.reason = command.isToday
      ? 'diminta tanpa shopee'
      : 'tarik dana hanya berlaku untuk saldo hari ini';
  } else {
    const result = await withdrawShopeeBalance({
      date: command.targetDate,
      onProgress: (text) => reporter.update(text),
    });
    shopee = { ...result, skipped: false };
  }

  // --- 2. Setoran offline dari grup ---
  await reporter.update('Membaca grup rekap harian...');

  const groupId = await resolveRekapGroupId(client, message);
  const messages = await loadGroupMessages(client, groupId, getGroupBuffer);

  const offline = collectOfflineIncome(messages, {
    targetDate: command.targetDate,
    timeZone: deps.timeZone,
  });

  // "pengeluaran <angka>" diketik orang di grup yang sama dengan setoran
  // offline, jadi historynya tidak perlu ditarik lagi.
  const manualExpenses = collectManualExpenses(messages, {
    targetDate: command.targetDate,
    timeZone: deps.timeZone,
  });

  // --- 3. Kulakan & kas dari ringkasan rekap ---
  // Ringkasannya dikirim bot ke grupnya sendiri (REKAP_SUMMARY_GROUP_NAME).
  // Biasanya grup yang sama dengan sumber setoran offline, jadi historynya
  // dipakai ulang daripada ditarik dua kali.
  const summaryGroupId = await resolveSummaryGroupId(client, message).catch((error) => {
    console.error('Grup ringkasan rekap tidak ditemukan:', error.message);
    return null;
  });
  const summaryMessages =
    !summaryGroupId || String(summaryGroupId) === String(groupId)
      ? messages
      : await loadGroupMessages(client, summaryGroupId, getGroupBuffer);

  const expenses = summaryGroupId
    ? collectRecapExpenses(summaryMessages, {
        targetDate: command.targetDate,
        timeZone: deps.timeZone,
      })
    : { entry: null, found: 0, skippedNoTimestamp: 0, groupMissing: true };

  // --- 4. Tulis ke spreadsheet ---
  await reporter.update('Menulis ke spreadsheet keuangan...');

  // Setiap setoran offline jadi barisnya sendiri di sheet, jadi yang dikirim
  // adalah daftar nominalnya - bukan totalnya. Pengeluaran sebaliknya: satu
  // baris per jenis, ditimpa kalau rekapnya diulang.
  const sheet = await writeDailyLedger({
    date: command.targetDate,
    shopeeAmount: shopee.amount,
    shopeeSkipped: shopee.skipped,
    offlineAmounts: offline.entries.map((item) => item.amount),
    expenses: expenses.entry
      ? [
          { kind: 'kulakan', amount: expenses.entry.kulakan },
          { kind: 'kas', amount: expenses.entry.kas || 0 },
        ]
      : [],
    expenseAmounts: manualExpenses.entries.map((item) => item.amount),
  });

  const reply = buildReply({ command, shopee, offline, expenses, manualExpenses, sheet });
  await client.sendText(message.from, reply);

  return { shopee, offline, expenses, manualExpenses, sheet };
}

async function handleKeuanganCommand(client, message, { queue, getBotIds, isGroup, timeZone, getGroupBuffer }) {
  const botIds = isGroup ? await getBotIds() : [];
  const command = getKeuanganCommand(message, botIds, { isGroup, timeZone });

  if (!command) {
    return false;
  }

  if (queue.isFull) {
    await client.sendText(message.from, describeFailure({ code: 'QUEUE_FULL' }));
    return true;
  }

  console.log(
    `Auto rekap dari ${message.from}: tanggal=${command.targetDate} skipShopee=${command.skipShopee}`
  );

  const reporter = createProgressReporter(client, message.from);
  const jobOutcome = queue
    .push(() => runKeuanganJob(client, message, command, { timeZone, getGroupBuffer }, reporter))
    .then((result) => ({ result }), (error) => ({ error }));

  await reporter.start(`Auto rekap ${command.dateLabel} diproses, tunggu ya...`);

  const { result, error } = await jobOutcome;

  if (error) {
    console.error(`Auto rekap gagal untuk ${message.from}:`, error);
    await client.sendText(message.from, describeFailure(error)).catch(() => {});
    return true;
  }

  console.log(
    `Auto rekap selesai ${command.targetDate}: tab="${result.sheet.sheetName}" ` +
      `shopee=${result.shopee.amount}(${result.sheet.shopeeAction}) ` +
      `offline=${result.offline.total} keluar=${result.sheet.expenseTotal} ` +
      `barisBaru=${result.sheet.rowsAdded}`
  );
  return true;
}

module.exports = {
  KeuanganSheetError,
  ShopeeWithdrawError,
  buildReply,
  config,
  describeFailure,
  handleKeuanganCommand,
  resolveRekapGroupId,
};
