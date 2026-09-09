const welcomeTriggerWords = ['halo',
  'hallo',
  'helo',
  'hello',
  'hai',
  'hi',
  'p',
  'punten',
  'permisi',
  'assalamualaikum',
  'assalamu alaikum',
  'salam',
  'selamat pagi',
  'pagi',
  'siang',
  'sore',
  'malam',
  'price list',
  'daftar harga',
  'pl',
  'pricelist',
  'katalog',
  'catalog',
];

function containsWelcomeTrigger(messageBody) {
  const normalizedBody = String(messageBody || '').toLowerCase();
  const words = normalizedBody.match(/[a-z0-9]+/g) || [];

  return welcomeTriggerWords.some((triggerWord) => words.includes(triggerWord));
}

module.exports = {
  containsWelcomeTrigger,
};
