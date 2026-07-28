const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'shopee-token.json');
const AUTH_PATH = '/api/v2/shop/auth_partner';
const TOKEN_GET_PATH = '/api/v2/auth/token/get';
const REFRESH_PATH = '/api/v2/auth/access_token/get';
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

function getConfig() {
  const host = String(process.env.SHOPEE_HOST || '').replace(/\/+$/, '');
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  const shopId = process.env.SHOPEE_SHOP_ID;

  if (!host || !partnerId || !partnerKey || !shopId) {
    throw new Error(
      'SHOPEE_HOST, SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, dan SHOPEE_SHOP_ID belum diisi.'
    );
  }

  return { host, partnerId, partnerKey, shopId };
}

function loadTokens() {
  try {
    const parsedValue = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    if (parsedValue?.refresh_token) {
      return parsedValue;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read Shopee token store:', error);
    }
  }

  return {
    access_token: process.env.SHOPEE_ACCESS_TOKEN || '',
    refresh_token: process.env.SHOPEE_REFRESH_TOKEN || '',
    expires_at: 0,
  };
}

function saveTokens(tokens) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function signRequest(partnerKey, baseString) {
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function isTokenError(result) {
  return ['invalid_acceess_token', 'invalid_access_token', 'error_auth', 'access_token_error']
    .includes(String(result?.error || ''));
}

function createShopeeClient() {
  const { host, partnerId, partnerKey, shopId } = getConfig();
  let tokens = loadTokens();

  const refreshAccessToken = async () => {
    if (!tokens.refresh_token) {
      throw new Error('SHOPEE_REFRESH_TOKEN belum diisi, perlu authorize ulang toko di Shopee Open Platform.');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const url = new URL(host + REFRESH_PATH);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('sign', signRequest(partnerKey, `${partnerId}${REFRESH_PATH}${timestamp}`));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: tokens.refresh_token,
        partner_id: Number(partnerId),
        shop_id: Number(shopId),
      }),
    });
    const result = await response.json();

    if (result.error || !result.access_token) {
      throw new Error(
        `Gagal refresh token Shopee: ${result.message || result.error || response.status}`
      );
    }

    tokens = {
      access_token: result.access_token,
      refresh_token: result.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (Number(result.expire_in) || 14400) * 1000,
    };
    saveTokens(tokens);
    console.log('Refreshed Shopee access token.');

    return tokens.access_token;
  };

  const getAccessToken = async () => {
    if (!tokens.access_token || !tokens.expires_at || tokens.expires_at - EXPIRY_SAFETY_MS <= Date.now()) {
      return refreshAccessToken();
    }

    return tokens.access_token;
  };

  const call = async (apiPath, { method = 'GET', params = {}, body } = {}, isRetry = false) => {
    const accessToken = await getAccessToken();
    const timestamp = Math.floor(Date.now() / 1000);
    const url = new URL(host + apiPath);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', timestamp);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('shop_id', shopId);
    url.searchParams.set(
      'sign',
      signRequest(partnerKey, `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`)
    );
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      // Sebagian API Shopee (mis. item_status) minta parameter yang sama diulang, bukan dipisah koma.
      if (Array.isArray(value)) {
        value.forEach((entry) => url.searchParams.append(key, entry));
        return;
      }

      url.searchParams.set(key, value);
    });

    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();

    if (isTokenError(result) && !isRetry) {
      // Access token bisa dicabut sebelum expire (mis. re-authorize), jadi paksa refresh lalu ulang sekali.
      tokens = { ...tokens, access_token: '', expires_at: 0 };
      return call(apiPath, { method, params, body }, true);
    }

    if (result.error) {
      throw new Error(`${result.error}: ${result.message || 'tidak ada detail'}`);
    }

    return result.response || {};
  };

  return {
    call,
    refreshAccessToken,
    getItemBaseInfo: (itemIds) =>
      call('/api/v2/product/get_item_base_info', {
        params: { item_id_list: itemIds.join(',') },
      }),
    getItemList: (offset, pageSize, itemStatus) =>
      call('/api/v2/product/get_item_list', {
        params: { offset, page_size: pageSize, item_status: itemStatus },
      }),
    getModelList: (itemId) =>
      call('/api/v2/product/get_model_list', { params: { item_id: itemId } }),
    updatePrice: (itemId, priceList) =>
      call('/api/v2/product/update_price', {
        method: 'POST',
        body: { item_id: Number(itemId), price_list: priceList },
      }),
  };
}

function buildAuthorizeUrl() {
  const { host, partnerId, partnerKey } = getConfig();
  const redirectUrl = process.env.SHOPEE_REDIRECT_URL;
  if (!redirectUrl) {
    throw new Error('SHOPEE_REDIRECT_URL belum diisi.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(host + AUTH_PATH);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', signRequest(partnerKey, `${partnerId}${AUTH_PATH}${timestamp}`));
  url.searchParams.set('redirect', redirectUrl);

  return url.toString();
}

async function exchangeAuthCode(code, shopIdOverride) {
  const { host, partnerId, partnerKey, shopId } = getConfig();
  const targetShopId = shopIdOverride || shopId;
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(host + TOKEN_GET_PATH);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', signRequest(partnerKey, `${partnerId}${TOKEN_GET_PATH}${timestamp}`));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      partner_id: Number(partnerId),
      shop_id: Number(targetShopId),
    }),
  });
  const result = await response.json();

  if (result.error || !result.access_token) {
    throw new Error(
      `Gagal tukar code jadi token: ${result.message || result.error || response.status}`
    );
  }

  const tokens = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: Date.now() + (Number(result.expire_in) || 14400) * 1000,
  };
  saveTokens(tokens);

  return { ...tokens, shop_id: targetShopId };
}

module.exports = { buildAuthorizeUrl, createShopeeClient, exchangeAuthCode, TOKEN_PATH };
