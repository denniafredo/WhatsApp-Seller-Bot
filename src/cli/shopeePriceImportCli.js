require('dotenv').config();

const { buildImportReport, importShopeePrices } = require('../shopee/shopeePriceImport');

importShopeePrices()
  .then((result) => {
    console.log(buildImportReport(result));
  })
  .catch((error) => {
    console.error(`Ambil harga Shopee gagal: ${error.message}`);
    process.exitCode = 1;
  });
