require('dotenv').config();

const { applyHargaTerbaru, buildMapReport } = require('./shopeePriceMap');

applyHargaTerbaru()
  .then((result) => {
    console.log(buildMapReport(result));
  })
  .catch((error) => {
    console.error(`Gagal menyamakan harga: ${error.message}`);
    process.exitCode = 1;
  });
