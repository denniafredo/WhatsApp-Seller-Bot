// Menjalankan aplikasi Maxim di emulator untuk membaca tarif pengiriman.
//
// Aturan perilaku aplikasi yang ditemukan lewat percobaan langsung, jangan
// diubah tanpa mengujinya lagi:
//
//   1. JANGAN menekan baris tarif di daftar Delivery - itu MENGHAPUS seluruh
//      rute. Daftar itu cukup dibaca, tidak perlu dipilih.
//   2. Pilih alamat dengan menekan baris saran; itu langsung commit dan balik
//      ke layar utama. BACK dari daftar saran malah MENAMBAH titik baru.
//   3. Jangan pernah swipe di layar peta - pin ikut bergeser dan titiknya
//      berubah jadi tempat lain.
//   4. Kategori yang sedang aktif tidak terbaca di hierarki (atribut `selected`
//      selalu false, penandanya cuma border kuning), jadi selalu tekan
//      "Delivery" secara eksplisit.
//   5. Sisa rute permintaan sebelumnya menempel jadi multi-titik dan mengubah
//      harga tanpa terlihat salah, jadi rute direset di setiap permintaan.

const {
  OngkirError,
  ensureDevice,
  createDevice,
  findById,
  findAllById,
  findNode,
  waitFor,
} = require('./mumuClient');

const MAXIM_PACKAGE = process.env.MAXIM_PACKAGE || 'com.taxsee.taxsee';
const CATEGORY = process.env.MAXIM_CATEGORY || 'Delivery';
const CITY = process.env.MAXIM_CITY || 'Semarang';
const MULTI_STOP_MARK = '➞'; // "➞" di judul tujuan menandakan rute multi-titik

// Harga Maxim mengandung U+200E (left-to-right mark) di antara "Rp" dan angka.
function cleanText(value) {
  return String(value || '').replace(/[‎‏ ]/g, '').trim();
}

function parseRupiah(value) {
  const digits = cleanText(value).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function isMainScreen(nodes) {
  return Boolean(findById(nodes, 'rpvFrom') && findById(nodes, 'rpvTo'));
}

function getPointButtons(nodes) {
  // Dua kartu titik (asal & tujuan) terurut dari atas ke bawah.
  return findAllById(nodes, 'cvPointButton').sort((a, b) => a.bounds.y1 - b.bounds.y1);
}

// Judul kartu titik dibaca dari tvButtonTitle di dalam kartu tersebut.
function getPointTitle(nodes, cardIndex) {
  const cards = getPointButtons(nodes);
  const card = cards[cardIndex];
  if (!card) return '';

  const title = findNode(
    nodes,
    (node) =>
      node.id === 'tvButtonTitle' &&
      node.bounds.y1 >= card.bounds.y1 &&
      node.bounds.y2 <= card.bounds.y2
  );

  return cleanText(title?.text);
}

// Titik ditekan di sepertiga atas kartu: bagian bawahnya kolom catatan
// ("main entrance"), yang membuka dialog lain kalau tertekan.
function pointTapTarget(card) {
  return {
    x: card.center.x,
    y: Math.round(card.bounds.y1 + (card.bounds.y2 - card.bounds.y1) * 0.3),
  };
}

// Saat pertama dibuka setelah emulator baru menyala, Maxim menebak kota dari
// GPS emulator (yang mengira dirinya di Jakarta) lewat dialog "The app has
// identified your location as: ...". Kalau dibiarkan, semua tarif dihitung
// untuk kota yang salah - jadi kota selalu disetel ulang lewat tombol "Change",
// bukan "OK".
function findCityDialogButton(nodes) {
  if (!findById(nodes, 'tvMessage')) {
    return null;
  }

  return (
    findNode(
      nodes,
      (node) => node.id === 'bButton' && cleanText(node.text).toLowerCase() === 'change'
    ) || null
  );
}

async function ensureCity(device, nodes, onProgress) {
  const changeButton = findCityDialogButton(nodes);
  if (!changeButton) {
    return nodes;
  }

  await onProgress(`Menyetel kota ke ${CITY}...`);
  await device.tap(changeButton.center.x, changeButton.center.y, 2500);

  const { hit: searchBar } = await waitFor(device, (n) => findById(n, 'search_bar'), {
    label: 'daftar kota',
  });

  await device.tap(searchBar.center.x, searchBar.center.y, 1200);
  await device.clearText();
  await device.typeText(CITY);

  // Dicocokkan persis, bukan "hasil teratas": salah kota berarti seluruh tarif
  // yang dibaca ikut salah tanpa kelihatan salah.
  const { hit: cityRow } = await waitFor(
    device,
    (n) =>
      findNode(
        n,
        (node) =>
          node.id === 'title' &&
          node.bounds.y1 > 150 &&
          cleanText(node.text).toLowerCase() === CITY.toLowerCase()
      ),
    { label: `kota ${CITY} di daftar` }
  );

  await device.tap(cityRow.center.x, cityRow.center.y, 4000);

  const { nodes: mainNodes } = await waitFor(device, (n) => (isMainScreen(n) ? n : null), {
    label: 'layar utama setelah memilih kota',
  });

  return mainNodes;
}

async function ensureMaximOpen(device, onProgress) {
  if (!(await device.isInstalled(MAXIM_PACKAGE))) {
    throw new OngkirError(
      'NO_APP',
      `Aplikasi Maxim (${MAXIM_PACKAGE}) belum terpasang di emulator.`
    );
  }

  const foreground = await device.foregroundPackage();
  if (foreground !== MAXIM_PACKAGE) {
    await onProgress('Membuka aplikasi Maxim...');
    await device.launchPackage(MAXIM_PACKAGE);
  }

  let nodes = await device.dump();
  nodes = await ensureCity(device, nodes, onProgress);

  if (isMainScreen(nodes)) {
    return nodes;
  }

  // Bisa tertinggal di tab lain (Orders/Favorites) dari pemakaian sebelumnya.
  const home = findById(nodes, 'navigation_order') || findNode(nodes, (n) => n.text === 'Home');
  if (home) {
    await device.tap(home.center.x, home.center.y, 2000);
  }

  const { nodes: mainNodes } = await waitFor(device, (n) => (isMainScreen(n) ? n : null), {
    label: 'layar utama Maxim',
  });

  return mainNodes;
}

// Membuang titik sisa permintaan sebelumnya sampai rute kembali dua titik.
async function resetRoute(device, nodes, onProgress) {
  if (!cleanText(getPointTitle(nodes, 1)).includes(MULTI_STOP_MARK)) {
    return nodes;
  }

  await onProgress('Membersihkan rute sebelumnya...');

  const cards = getPointButtons(nodes);
  const target = pointTapTarget(cards[1]);
  await device.tap(target.x, target.y, 2000);

  const { nodes: editorNodes } = await waitFor(
    device,
    (n) => (findById(n, 'bRemove') ? n : null),
    { label: 'daftar titik rute' }
  );

  let current = editorNodes;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const removals = findAllById(current, 'bRemove').sort((a, b) => a.bounds.y1 - b.bounds.y1);
    if (removals.length <= 1) {
      break;
    }

    const last = removals[removals.length - 1];
    await device.tap(last.center.x, last.center.y, 1800);
    current = await device.dump();
  }

  const done = findNode(current, (node) => node.text === 'Done');
  if (done) {
    await device.tap(done.center.x, done.center.y, 2500);
  }

  const { nodes: mainNodes } = await waitFor(device, (n) => (isMainScreen(n) ? n : null), {
    label: 'layar utama setelah reset rute',
  });

  return mainNodes;
}

// Mengisi satu titik lewat pencarian teks, lalu mengembalikan alamat yang
// benar-benar dipilih aplikasi (untuk ditampilkan ke pengirim).
async function setPoint(device, nodes, cardIndex, query, onProgress, fallbackQuery = '') {
  const label = cardIndex === 0 ? 'titik jemput' : 'tujuan';
  await onProgress(`Mengisi ${label}...`);

  const cards = getPointButtons(nodes);
  if (!cards[cardIndex]) {
    throw new OngkirError('UI_CHANGED', `Kartu ${label} tidak ditemukan di layar Maxim.`);
  }

  const target = pointTapTarget(cards[cardIndex]);
  await device.tap(target.x, target.y, 2000);

  const { hit: searchBar } = await waitFor(
    device,
    (n) => findById(n, 'search_bar'),
    { label: `kolom pencarian ${label}` }
  );

  await device.tap(searchBar.center.x, searchBar.center.y, 1200);

  // Daftar saran sempat menampilkan hasil query sebelumnya, jadi baris teratas
  // baru diambil setelah dump menunjukkan kata kunci yang sekarang.
  const firstSuggestion = (n) => {
    const titles = findAllById(n, 'title')
      .filter((node) => node.bounds.y1 > 150)
      .sort((a, b) => a.bounds.y1 - b.bounds.y1);
    return titles[0] || null;
  };

  const search = async (text, timeoutMs) => {
    await device.clearText();
    await device.typeText(text);
    return waitFor(device, firstSuggestion, {
      label: `saran alamat "${text}"`,
      timeoutMs,
    });
  };

  let suggestion;
  try {
    ({ hit: suggestion } = await search(query, 25000));
  } catch (error) {
    // Teks bebas di sekitar link ("rumah bu ani ...") bisa membuat pencarian
    // tidak menemukan apa pun; ulangi dengan alamat hasil link saja.
    const canRetry = fallbackQuery && cleanText(fallbackQuery) !== cleanText(query);
    if (!canRetry) {
      throw new OngkirError('NO_ADDRESS', `Alamat "${query}" tidak ditemukan di Maxim.`);
    }

    await onProgress(`Mencoba ulang ${label} dengan alamat yang lebih singkat...`);
    try {
      ({ hit: suggestion } = await search(fallbackQuery, 25000));
    } catch {
      throw new OngkirError('NO_ADDRESS', `Alamat "${query}" tidak ditemukan di Maxim.`);
    }
  }

  const chosen = cleanText(suggestion.text);
  await device.tap(suggestion.center.x, suggestion.center.y, 3000);

  const { nodes: mainNodes } = await waitFor(device, (n) => (isMainScreen(n) ? n : null), {
    label: `layar utama setelah memilih ${label}`,
  });

  const applied = getPointTitle(mainNodes, cardIndex);
  if (!applied) {
    throw new OngkirError('POINT_FAILED', `Maxim tidak menerima ${label} "${query}".`);
  }

  return { nodes: mainNodes, chosen, applied };
}

// Daftar tarif: pasangan judul + harga, dibaca dari satu layar yang sama.
function readTariffs(nodes) {
  const titles = findAllById(nodes, 'tvTitle').sort((a, b) => a.bounds.y1 - b.bounds.y1);
  const prices = findAllById(nodes, 'tvPrice').sort((a, b) => a.bounds.y1 - b.bounds.y1);

  return prices
    .map((price) => {
      // Judul milik satu kartu selalu berada di atas harganya.
      const owner = titles.filter((title) => title.bounds.y1 < price.bounds.y1).pop();
      return {
        name: cleanText(owner?.text) || '(tanpa nama)',
        priceText: cleanText(price.text),
        price: parseRupiah(price.text),
      };
    })
    .filter((row) => row.price != null);
}

async function openTariffs(device, nodes, onProgress) {
  await onProgress('Membuka daftar tarif...');

  const category = findNode(
    nodes,
    (node) => node.id === 'category_title' && cleanText(node.text) === CATEGORY
  );

  if (!category) {
    throw new OngkirError('NO_CATEGORY', `Kategori "${CATEGORY}" tidak ada di layar Maxim.`);
  }

  await device.tap(category.center.x, category.center.y, 3000);

  const { nodes: sheetNodes } = await waitFor(
    device,
    (n) => (findAllById(n, 'tvPrice').length >= 2 ? n : null),
    { label: 'daftar tarif' }
  );

  return sheetNodes;
}

async function checkOngkir({
  pickupQuery,
  destinationQuery,
  pickupFallback = '',
  destinationFallback = '',
  onProgress = async () => {},
}) {
  const serial = await ensureDevice();
  const device = createDevice(serial);

  let nodes = await ensureMaximOpen(device, onProgress);
  nodes = await resetRoute(device, nodes, onProgress);

  const pickup = await setPoint(device, nodes, 0, pickupQuery, onProgress, pickupFallback);
  const destination = await setPoint(
    device, pickup.nodes, 1, destinationQuery, onProgress, destinationFallback
  );

  const sheetNodes = await openTariffs(device, destination.nodes, onProgress);
  const tariffs = readTariffs(sheetNodes);

  if (!tariffs.length) {
    throw new OngkirError('NO_TARIFF', 'Daftar tarif terbuka tapi tidak ada harga yang terbaca.');
  }

  await onProgress('Mengambil screenshot...');
  const screenshot = await device.screenshot();

  // Tutup lembar tarif supaya permintaan berikutnya mulai dari layar utama.
  await device.pressKey('BACK', 1500);

  return {
    pickup: pickup.applied,
    destination: destination.applied,
    tariffs,
    screenshot,
  };
}

module.exports = {
  checkOngkir,
  readTariffs,
  parseRupiah,
  cleanText,
  MAXIM_PACKAGE,
};
