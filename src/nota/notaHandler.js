// Orkestrasi fitur "nota": baca perintah -> pilih toko -> render -> balas
// JPG + PDF.
//
// JPG-nya dikirim lebih dulu karena itu yang langsung kelihatan di chat
// (dokumen PDF cuma muncul sebagai kartu file), sedangkan PDF-nya yang
// diteruskan ke pelanggan.
//
// Tidak ada job queue di sini: renderNota() sudah menjalankan pekerjaannya
// berurutan di satu Chrome bersama, jadi menumpuknya lagi di antrean cuma
// menambah lapisan tanpa mengubah apa pun.

const { getNotaCommand } = require('./notaTrigger');
const { parseNota, formatNumber, formatHelp } = require('./notaParser');
const { resolveBrand, listAliases } = require('./notaBrands');
const { renderNota } = require('./notaRender');
const { hasAsset } = require('./notaAssets');

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

// Nama pelanggan cuma masuk nama file untuk toko yang notanya memang punya
// kolom Nama. Di Marvel namanya tidak muncul di mana pun, jadi tidak ada
// gunanya menempel di nama file.
function baseFileName(nota, brand) {
  const name = brand.showsCustomerName ? slug(nota.customerName) : '';
  return ['nota', brand.key, nota.ymd, name].filter(Boolean).join('-');
}

function brandListText() {
  return listAliases()
    .map((entry) => `• \`${entry.alias}\` — ${entry.label}`)
    .join('\n');
}

function unknownBrandText(alias) {
  return [`Toko "${alias}" belum ada. Yang tersedia:`, '', brandListText()].join('\n');
}

// Nominal yang ditulis singkat ("50" jadi 50.000) dikonfirmasi ulang di
// balasan. Aturannya memang aturan rumah, tapi di nota angkanya dibaca
// pelanggan - lebih baik kelihatan daripada diam-diam benar.
function implicitPriceNotes(nota) {
  return nota.items
    .filter((item) => item.priceScale === 'ribu-implisit')
    .map((item) => `• ${item.name}: dibaca *${formatNumber(item.price)}*`);
}

// Aset yang belum dikirim, disebut sekali di caption supaya jelas kenapa
// notanya belum berlogo - bukan sebagai pesan terpisah.
//
// "nama:" yang diketik untuk toko tanpa kolom Nama TIDAK dilaporkan: itu
// field opsional yang memang tidak berlaku di situ, dan mengingatkannya tiap
// nota cuma jadi kebisingan.
function brandNotes(nota, brand) {
  const notes = [];

  if (!hasAsset(brand.assets.logo)) {
    notes.push(`Logo ${brand.label} belum ada (\`assets/${brand.assets.logo}\`), sementara dipakai tulisan.`);
  }

  if (!hasAsset(brand.assets.signature)) {
    notes.push(`Tanda tangan belum ada (\`assets/${brand.assets.signature}\`), kolomnya dikosongkan.`);
  }

  return notes;
}

function buildCaption(nota, brand) {
  const showName = brand.showsCustomerName && nota.customerName;
  const heading = showName
    ? `*Nota ${brand.label}* — ${nota.customerName}`
    : `*Nota ${brand.label}*`;

  const lines = [heading, nota.dateLabel, ''];
  lines.push(`${nota.items.length} item — Total *Rp${formatNumber(nota.total)}*`);

  const prices = implicitPriceNotes(nota);
  if (prices.length) {
    lines.push('', 'Harga ditulis singkat:', ...prices);
  }

  const notes = brandNotes(nota, brand);
  if (notes.length) {
    lines.push('', ...notes.map((note) => `_${note}_`));
  }

  return lines.join('\n');
}

function buildProblemText(problems) {
  return ['Baris yang tidak masuk nota:', ...problems.map((problem) => `• ${problem}`)].join('\n');
}

async function sendNota(client, chatId, nota, brand) {
  const { jpg, pdf } = await renderNota(nota, brand);
  const fileName = baseFileName(nota, brand);

  await client.sendFileFromBase64(
    chatId,
    `data:image/jpeg;base64,${jpg.toString('base64')}`,
    `${fileName}.jpg`,
    buildCaption(nota, brand)
  );

  await client.sendFileFromBase64(
    chatId,
    `data:application/pdf;base64,${pdf.toString('base64')}`,
    `${fileName}.pdf`,
    ''
  );
}

/**
 * @returns true bila pesannya perintah nota (sudah ditangani), false bila
 *   bukan - pemanggil lanjut ke handler berikutnya.
 */
async function handleNotaCommand(client, message, options = {}) {
  const botIds = options.getBotIds ? await options.getBotIds() : [];
  const command = getNotaCommand(message, botIds, { isGroup: options.isGroup });

  if (!command) {
    return false;
  }

  // Nama toko yang tidak dikenal dihentikan di sini, tidak diam-diam jatuh ke
  // toko default: nota toko yang salah terlanjur terkirim ke pelanggan jauh
  // lebih sulit dibereskan daripada satu pesan kesalahan.
  const brand = resolveBrand(command.alias);
  if (!brand) {
    await client.sendText(message.from, unknownBrandText(command.alias));
    return true;
  }

  const { nota, problems } = parseNota(command.text, { timeZone: options.timeZone });

  // Tidak ada satu pun item terbaca: kirim contoh formatnya, jangan nota kosong.
  if (!nota) {
    const text = [
      problems.length ? buildProblemText(problems) : null,
      formatHelp(),
      // Yang default adalah toko tanpa alias, bukan toko yang barusan dipilih.
      `Toko: ${listAliases().map((entry) => entry.alias).join(', ')} (kosong = ${resolveBrand('').label}).`,
    ]
      .filter(Boolean)
      .join('\n\n');
    await client.sendText(message.from, text);
    return true;
  }

  try {
    await sendNota(client, message.from, nota, brand);
    console.log(
      `Nota ${brand.key} ${nota.ymd} (${nota.items.length} item, ${formatNumber(nota.total)}) terkirim ke ${message.from}.`
    );
  } catch (error) {
    console.error(`Failed to render nota ${brand.key} for ${message.from}:`, error);
    await client.sendText(message.from, `Nota gagal dibuat: ${error.message}`).catch(() => {});
    return true;
  }

  // Nota tetap dikirim walau ada baris yang gagal dibaca - yang benar sudah
  // jadi, dan yang salah diberitahukan supaya bisa dikirim ulang.
  if (problems.length) {
    await client.sendText(message.from, buildProblemText(problems)).catch(() => {});
  }

  return true;
}

module.exports = {
  handleNotaCommand,
  buildCaption,
  baseFileName,
  brandNotes,
  implicitPriceNotes,
  unknownBrandText,
};
