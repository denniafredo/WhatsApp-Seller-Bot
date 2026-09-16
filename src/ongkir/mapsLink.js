// Mengubah link Google jadi kata kunci alamat yang bisa dicari di Maxim.
//
// Link pendek Google TIDAK memuat lat/long - sudah dicek untuk share.google
// maupun maps.app.goo.gl, dan halamannya cuma shell JavaScript. Yang tersedia
// hanyalah nama tempat/alamat di URL hasil redirect, dan itu justru yang
// dibutuhkan: pencarian Maxim memang menerima teks, bukan koordinat.
//
//   maps.app.goo.gl/...  -> /maps/place/Jl.+Kukilo+Mukti+Raya+No.143,...
//   share.google/...     -> /search?...&q=Dash+Mall+(Sterofoam+%26+Lembaran)

const { OngkirError } = require('./mumuClient');

const LINK_PATTERN = /https?:\/\/[^\s]+/gi;
const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|goo\.gl|share\.google|maps\.app\.goo\.gl)$/i;
const resolveTimeoutMs = Math.max(Number(process.env.ONGKIR_LINK_TIMEOUT_MS) || 20000, 5000);

function findLinks(text) {
  return String(text || '').match(LINK_PATTERN) || [];
}

function isGoogleLink(url) {
  try {
    return GOOGLE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function tidy(value) {
  return decodeURIComponent(String(value).replace(/\+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Membuang ekor yang tidak membantu pencarian: kode pos, "Kec.", provinsi.
function usefulParts(value) {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const useful = parts.filter(
    (part) => !/^(kec\.|kota|kabupaten|jawa|daerah|indonesia)/i.test(part) && !/^\d{5}$/.test(part)
  );
  return useful.length ? useful : parts;
}

// Pencarian Maxim cocok dengan "Kukilo Mukti Raya 143", tapi meleset ke POI
// lain sekelurahan kalau diberi "Jl. Kukilo Mukti Raya No.143, Pedurungan
// Kidul" - jadi awalan jalan, "No.", dan ekor kelurahan dibuang.
function shortenAddress(value) {
  const [first] = usefulParts(value);
  if (!first) return '';

  return first
    .replace(/^(jl\.?|jalan|gg\.?|gang)\s+/i, '')
    .replace(/\bno\.?\s*(\d)/i, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bentuk yang lebih lengkap, dipakai kalau pencarian bentuk pendek gagal.
function fullAddress(value) {
  return usefulParts(value).slice(0, 2).join(', ');
}

function extractPlace(finalUrl) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return null;
  }

  const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);
  if (placeMatch) {
    const raw = tidy(placeMatch[1]);
    return { place: shortenAddress(raw), placeFull: fullAddress(raw) };
  }

  const query = url.searchParams.get('q');
  if (query) {
    // Nama tempat dari hasil pencarian sering berekor kurung penjelas.
    const raw = tidy(query).replace(/\s*\([^)]*\)\s*$/, '');
    return { place: shortenAddress(raw), placeFull: fullAddress(raw) };
  }

  return null;
}

async function resolveGoogleLink(url) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(resolveTimeoutMs),
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      },
    });
  } catch (error) {
    throw new OngkirError('LINK_FAILED', `Link Google tidak bisa dibuka: ${error.message}`);
  }

  const place = extractPlace(response.url);
  if (!place || !place.place) {
    throw new OngkirError(
      'LINK_NO_PLACE',
      'Link itu tidak memuat nama tempat yang bisa dicari. Tulis alamatnya sebagai teks ya.'
    );
  }

  return place;
}

function tokenize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

// Seberapa banyak isi `place` yang sudah disebut di `other`.
function overlapRatio(place, other) {
  const placeTokens = tokenize(place);
  if (!placeTokens.length) return 0;

  const otherTokens = new Set(tokenize(other));
  const shared = placeTokens.filter((token) => otherTokens.has(token)).length;
  return shared / placeTokens.length;
}

// Mengganti setiap link Google di teks dengan nama tempatnya. Teks di luar link
// dipertahankan karena sering memuat nomor rumah - kecuali kalau isinya sudah
// terkandung di nama tempat hasil resolve, yang bikin kata kunci dobel
// ("Jl. Kukilo Mukti Raya no. 143 Jl. Kukilo Mukti Raya No.143").
async function expandLinks(text) {
  const links = findLinks(text).filter(isGoogleLink);
  if (!links.length) {
    return { text: String(text || '').trim(), resolved: [] };
  }

  const resolved = [];
  for (const link of links) {
    resolved.push({ link, ...(await resolveGoogleLink(link)) });
  }

  const places = resolved.map((entry) => entry.place);
  let remainder = String(text);
  links.forEach((link) => {
    remainder = remainder.replace(link, ' ');
  });
  remainder = remainder.replace(/\s+/g, ' ').replace(/[.,;:\s]+$/, '').trim();

  const alreadySaid = places.some((place) => overlapRatio(place, remainder) >= 0.6);
  const combined = !remainder || alreadySaid ? places.join(', ') : `${remainder} ${places.join(', ')}`;

  return { text: combined.replace(/\s+/g, ' ').trim(), resolved };
}

module.exports = {
  expandLinks,
  resolveGoogleLink,
  extractPlace,
  findLinks,
  isGoogleLink,
  shortenAddress,
  fullAddress,
};
