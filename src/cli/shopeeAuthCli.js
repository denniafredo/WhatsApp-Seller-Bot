require('dotenv').config();

const { buildAuthorizeUrl, exchangeAuthCode, TOKEN_PATH } = require('../shopee/shopeeClient');

const [code, shopIdOverride] = process.argv.slice(2);

if (!code) {
  console.log('1. Buka link ini di browser, login sebagai seller, klik Confirm Authorization:\n');
  console.log(buildAuthorizeUrl());
  console.log('\n2. Kamu akan diredirect ke SHOPEE_REDIRECT_URL dengan ?code=...&shop_id=... di URL-nya.');
  console.log('3. Jalankan: npm run shopee:auth -- <code> <shop_id>');
  process.exit(0);
}

exchangeAuthCode(code, shopIdOverride)
  .then((tokens) => {
    console.log(`Token tersimpan di ${TOKEN_PATH}`);
    console.log(`shop_id: ${tokens.shop_id}`);
    console.log(`access_token berlaku sampai: ${new Date(tokens.expires_at).toLocaleString('id-ID')}`);
    console.log('\nPastikan SHOPEE_SHOP_ID di .env sama dengan shop_id di atas.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
