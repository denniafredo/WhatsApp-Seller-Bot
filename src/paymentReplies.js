const path = require('path');

const ASSET_DIR = path.resolve(__dirname, '..', 'assets');

function containsWord(messageBody, word) {
  const normalizedBody = String(messageBody || '').toLowerCase();
  const words = normalizedBody.match(/[a-z0-9]+/g) || [];

  return words.includes(word.toLowerCase());
}

function findPaymentReply(messageBody) {
  if (containsWord(messageBody, 'qris')) {
    return {
      type: 'image',
      keyword: 'qris',
      imagePath: path.join(ASSET_DIR, 'qris.jpg'),
      fileName: 'qris.jpg',
      caption: 'QRIS pembayaran',
    };
  }

  if (containsWord(messageBody, 'transfer')) {
    return {
      type: 'text',
      keyword: 'transfer',
      text: [
        'Pembayaran melalui transfer bisa ke :',
        '',
        'BCA 8915836379',
        '',
        'Atas nama',
        'Denni Afredo Suryono Hartanu',
      ].join('\n'),
    };
  }

  return null;
}

module.exports = {
  findPaymentReply,
};
