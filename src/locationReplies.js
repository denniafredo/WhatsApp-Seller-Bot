function normalizeText(message) {
  return String(message || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function shouldReplyAddress(message) {
  const text = normalizeText(message);

  const strongKeywords = [
    'alamat',
    'lokasi',
    'maps',
    'map',
    'shareloc',
    'alamatnya',
    'lokasinya',
    'sendangmulyo',
  ];

  const questionKeywords = [
    'dimana',
    'di mana',
    'mana',
    'sebelah mana',
  ];

  const pickupKeywords = [
    'ambil',
    'pickup',
    'cod',
    'datang ke toko',
  ];

  const hasStrongKeyword = strongKeywords.some((word) => text.includes(word));
  const hasQuestionKeyword = questionKeywords.some((word) => text.includes(word));
  const hasPickupKeyword = pickupKeywords.some((word) => text.includes(word));

  return hasStrongKeyword || hasPickupKeyword || (
    text.includes('toko') && hasQuestionKeyword
  );
}

function findLocationReply(messageBody) {
  if (!shouldReplyAddress(messageBody)) {
    return null;
  }

  return [
    'DASH MALL',
    '',
    'Lokasi :',
    'Jl. Gendong Raya No. 38, Sendangmulyo (sebelah sentral laundry) https://maps.app.goo.gl/BKVKYdovFFUqV5i97',
  ].join('\n');
}

module.exports = {
  findLocationReply,
  shouldReplyAddress,
};
