const path = require('path');

const ASSET_DIR = path.resolve(__dirname, '..', 'assets');

const replies = [
  {
    keyword: 'PL box',
    imagePath: path.join(ASSET_DIR, 'pl-box.jpg'),
    fileName: 'pl-box.jpg',
    caption: 'Price list box',
  },
  {
    keyword: 'PL Box Warna',
    imagePath: path.join(ASSET_DIR, 'pl-box-warna.jpg'),
    fileName: 'pl-box-warna.jpg',
    caption: 'Price list box warna',
  },
  {
    keyword: 'PL Thermal Bag',
    imagePath: path.join(ASSET_DIR, 'pl-thermal-bag.jpg'),
    fileName: 'pl-thermal-bag.jpg',
    caption: 'Price list Thermal Bag',
  },
  {
    keyword: 'PL Lembaran',
    imagePath: path.join(ASSET_DIR, 'pl-lembaran.jpg'),
    fileName: 'pl-lembaran.jpg',
    caption: 'Price list Lembaran',
  },
  {
    keyword: 'PL PE foam',
    imagePath: path.join(ASSET_DIR, 'pl-pe-foam.jpg'),
    fileName: 'pl-pe-foam.jpg',
    caption: 'Price list PE foam',
  },
  {
    keyword: 'PL Ice Pack',
    imagePath: path.join(ASSET_DIR, 'pl-ice-pack.jpg'),
    fileName: 'pl-ice-pack.jpg',
    caption: 'Price list Ice Pack',
  },
  {
    keyword: 'PL Ice Gel',
    imagePath: path.join(ASSET_DIR, 'pl-ice-gel.jpg'),
    fileName: 'pl-ice-gel.jpg',
    caption: 'Price list Ice Gel',
  },
  {
    keyword: 'PL Lem Sterofoam',
    imagePath: path.join(ASSET_DIR, 'pl-lem-sterofoam.jpg'),
    fileName: 'pl-lem-sterofoam.jpg',
    caption: 'Price list Lem Sterofoam',
  },
  {
    keyword: 'PL Pemotong Sterofoam',
    imagePath: path.join(ASSET_DIR, 'pl-pemotong-sterofoam.jpg'),
    fileName: 'pl-pemotong-sterofoam.jpg',
    caption: 'Price list Pemotong Sterofoam',
  },
  {
    keyword: 'PL Palet Plastik',
    imagePath: path.join(ASSET_DIR, 'pl-palet-plastik.jpg'),
    fileName: 'pl-palet-plastik.jpg',
    caption: 'Price list Palet Plastik',
  },
];

function normalizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function findReply(messageBody) {
  const normalizedBody = normalizeKeyword(messageBody);
  return replies.find((reply) => normalizeKeyword(reply.keyword) === normalizedBody);
}

module.exports = {
  replies,
  findReply,
  normalizeKeyword,
};
