require('dotenv').config();

const { buildSyncReport, syncShopeePrices } = require('./shopeePriceSync');

syncShopeePrices()
  .then((result) => {
    console.log(buildSyncReport(result));
  })
  .catch((error) => {
    console.error(`Update harga Shopee gagal: ${error.message}`);
    process.exitCode = 1;
  });
