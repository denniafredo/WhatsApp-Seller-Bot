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
const { collectAiExpenses } = require('./aiPengeluaranParser');
const { collectJualanIncome } = require('./jualanParser');
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
    case 'WITHDRAW_PIN_NOT_FILLED':
      return error.message;
    // Pengaman berhenti sebelum apa pun dikirim, jadi pesannya harus menegaskan
    // itu - kalau tidak, orang akan mengira uangnya sudah bergerak.
    case 'WITHDRAW_FORM_MISSING':
    case 'WITHDRAW_CONFIRM_MISSING':
    case 'WITHDRAW_CONFIRM_NO_EFFECT':
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

function describeRowAction(row) {
  if (row.action === 'updated') {
    return `baris ${row.row} diperbarui`;
  }
  if (row.action === 'unchanged') {
    return `baris ${row.row} sudah sama`;
  }
  return `ditulis di baris ${row.row}`;
}

function buildReply({
  command,
  shopee,
  offline,
  expenses,
  manualExpenses,
  aiExpenses,
  jualan,
  sheet,
}) {
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

  // Penjualan barang dari foto buku. Barisnya di sheet cuma dua (tunai/QRIS),
  // jadi rinciannya ada di sini - itu satu-satunya tempat salah baca OCR bisa
  // ketahuan sebelum orang membuka spreadsheet.
  const jual = jualan || { rows: [], rejected: [], mismatched: [] };

  // Cukup ADA foto yang diperiksa untuk memunculkan bagian ini. Kalau syaratnya
  // foto yang lolos jadi buku penjualan, foto yang ditolak model hilang diam-diam
  // dan orang mengira fotonya tidak pernah sampai.
  if (jual.candidates || jual.photos || jual.rows.length || (jual.skipped && jual.reason)) {
    const candidates = jual.candidates || 0;
    const header =
      candidates && candidates !== jual.photos
        ? `Penjualan barang (${jual.photos || 0} buku penjualan dari ${candidates} foto diperiksa):`
        : `Penjualan barang (${jual.photos || 0} foto buku):`;

    lines.push('');
    lines.push(header);

    // sheet.jualan sejajar dengan jual.rows (urutan buku), jadi tiap baris
    // sheet bisa ditampilkan bersama nama barangnya.
    jual.rows.forEach((row, index) => {
      const written = (sheet.jualan || [])[index];
      const label = written?.label || (row.bayar === 'Q' ? 'QRIS' : 'Tunai');
      lines.push(
        `  • ${label}: *${formatRupiah(row.amount)}* — ${row.barang}` +
          (written ? ` _(${describeRowAction(written)})_` : '') +
          (row.yakin ? '' : ' ⚠️ _ragu baca_')
      );
    });

    if (jual.rows.length) {
      lines.push(
        `  _Total: tunai ${formatRupiah(jual.tunai)}, QRIS ${formatRupiah(jual.qris)}._`
      );
    }

    if (sheet.jualanRemoved) {
      lines.push(`  _${sheet.jualanRemoved} baris penjualan lama dihapus (tidak ada lagi di buku)._`);
    }

    if (jual.notBook) {
      lines.push(
        `  _${jual.notBook} foto dinilai bukan buku penjualan, tidak dihitung._`
      );
    }

    if (jual.skipped && jual.reason) {
      lines.push(`  _pembacaan foto dilewati: ${jual.reason}._`);
    }

    jual.mismatched.forEach((item) => {
      lines.push(
        `  _${item.baris} baris bertanggal "${item.tanggal}" dilewati, bukan ${command.dateLabel}._`
      );
    });

    if (jual.rejected.length) {
      lines.push(`  _${jual.rejected.length} baris buku tidak dipakai (masukkan manual):_`);
      jual.rejected.slice(0, 5).forEach((item) => {
        lines.push(`    - ${item.barang} — ${item.reason}`);
      });
      if (jual.rejected.length > 5) {
        lines.push(`    _...dan ${jual.rejected.length - 5} lainnya._`);
      }
    }
  }

  lines.push('');
  lines.push('Pengeluaran:');

  const describeExpenseAction = describeRowAction;

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

  // Hasil AI dirinci satu per satu: keterangan yang masuk sheet, nominalnya,
  // dan kalimat aslinya. Ini yang membuat salah baca langsung kelihatan di grup
  // dan bisa dikoreksi manual, karena barisnya sudah terlanjur ditulis.
  const ai = aiExpenses || { entries: [], rejected: [] };

  ai.entries.forEach((entry) => {
    lines.push(
      `  • ${entry.keterangan}: ${formatRupiah(entry.amount)}` +
        ` _(AI, ${entry.author}: "${entry.raw}")_` +
        (entry.yakin ? '' : ' ⚠️ _ragu_')
    );
  });

  if (ai.skipped && ai.reason) {
    lines.push(`  _pembacaan AI dilewati: ${ai.reason}._`);
  }

  // Yang ditolak harus kelihatan isinya, bukan cuma jumlahnya: catatan itu
  // tidak masuk sheet, jadi orang harus tahu apa yang perlu dimasukkan manual.
  if (ai.rejected && ai.rejected.length) {
    lines.push(`  _${ai.rejected.length} catatan tidak dipakai (masukkan manual):_`);
    ai.rejected.slice(0, 5).forEach((item) => {
      lines.push(`    - "${item.text}" — ${item.reason}`);
    });
    if (ai.rejected.length > 5) {
      lines.push(`    _...dan ${ai.rejected.length - 5} lainnya._`);
    }
  }

  if (ai.droppedOverLimit) {
    lines.push(`  _${ai.droppedOverLimit} pesan lama tidak ikut dinilai AI (batas per run)._`);
  }

  if (sheet.expenseAmountsAlreadyThere) {
    lines.push(
      `  _${sheet.expenseAmountsAlreadyThere} pengeluaran sudah ada di sheet, tidak ditulis ulang._`
    );
  }

  lines.push('');

  const nothingChanged =
    !sheet.rowsAdded &&
    sheet.shopeeAction !== 'updated' &&
    !(sheet.jualan || []).some((item) => item.action === 'updated') &&
    !sheet.jualanRemoved &&
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

  // --- 2b. Pengeluaran bebas-format, dinilai AI ---
  // Hanya pesan yang TIDAK cocok pola di atas yang dilempar ke Claude, dan
  // kegagalannya tidak pernah menggagalkan rekap - pada titik ini dana Shopee
  // sudah ditarik, jadi berhenti di sini akan meninggalkan uang yang sudah
  // bergerak tanpa catatan.
  await reporter.update('Menilai catatan pengeluaran bebas dengan AI...');

  const aiExpenses = await collectAiExpenses(messages, {
    targetDate: command.targetDate,
    timeZone: deps.timeZone,
  }).catch((error) => {
    console.error('AI pengeluaran gagal:', error.message);
    return { entries: [], skipped: true, reason: error.message, candidates: 0, rejected: [] };
  });

  // --- 2c. Penjualan barang dari foto buku tulis tangan ---
  // Fotonya dikirim ke grup yang sama. AI yang memutuskan foto mana buku
  // penjualan (foto buku kilo laundry diabaikan), dan hasilnya dijumlahkan per
  // metode bayar - T (tunai) dan Q (QRIS) - jadi dua baris pemasukan.
  await reporter.update('Membaca foto buku penjualan...');

  const jualan = await collectJualanIncome(messages, {
    targetDate: command.targetDate,
    timeZone: deps.timeZone,
    decryptFile: (mediaMessage) => client.decryptFile(mediaMessage),
  }).catch((error) => {
    console.error('Pembacaan foto jualan gagal:', error.message);
    return {
      tunai: 0,
      qris: 0,
      rows: [],
      photos: 0,
      candidates: 0,
      notBook: 0,
      rejected: [],
      mismatched: [],
      skipped: true,
      reason: error.message,
    };
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
    // Satu baris sheet per baris buku ("Offline Tunai" / "Offline Qris").
    jualanRows: jualan.rows.map((row) => ({ bayar: row.bayar, amount: row.amount })),
    expenses: expenses.entry
      ? [
          { kind: 'kulakan', amount: expenses.entry.kulakan },
          { kind: 'kas', amount: expenses.entry.kas || 0 },
        ]
      : [],
    expenseAmounts: [
      // Angka polos: keterangannya tetap "Pengeluaran".
      ...manualExpenses.entries.map((item) => item.amount),
      // Hasil AI: keterangannya ikut apa yang ditulis orangnya.
      ...aiExpenses.entries.map((item) => ({ amount: item.amount, keterangan: item.keterangan })),
    ],
  });

  const reply = buildReply({
    command,
    shopee,
    offline,
    expenses,
    manualExpenses,
    aiExpenses,
    jualan,
    sheet,
  });
  await client.sendText(message.from, reply);

  return { shopee, offline, expenses, manualExpenses, aiExpenses, jualan, sheet };
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
