// LTI 1.1 launch verification (OAuth 1.0a, HMAC-SHA1) and signed session tokens.
// Uses only the Web Crypto API, which is available in Cloudflare Workers.

const enc = new TextEncoder();

// RFC 3986 percent-encoding as required by OAuth 1.0a.
export function percentEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmac(hash, key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an LTI 1.1 launch POST from Moodle.
 * @param {string} requestUrl  The URL the request arrived on (must equal the Tool URL configured in Moodle).
 * @param {FormData} form      The parsed form body.
 * @param {string} consumerKey Expected oauth_consumer_key.
 * @param {string} secret      Shared secret.
 * @returns {{ok: boolean, reason?: string}}
 */
export async function verifyLtiLaunch(requestUrl, form, consumerKey, secret) {
  if (form.get('lti_message_type') !== 'basic-lti-launch-request') return { ok: false, reason: 'not a launch request' };
  if (form.get('oauth_consumer_key') !== consumerKey) return { ok: false, reason: 'unknown consumer key' };
  if (form.get('oauth_signature_method') !== 'HMAC-SHA1') return { ok: false, reason: 'unsupported signature method' };

  const ts = Number(form.get('oauth_timestamp'));
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return { ok: false, reason: 'timestamp out of range' };

  const url = new URL(requestUrl);
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  const pairs = [];
  for (const [k, v] of form.entries()) {
    if (k === 'oauth_signature') continue;
    pairs.push([percentEncode(k), percentEncode(String(v))]);
  }
  for (const [k, v] of url.searchParams.entries()) pairs.push([percentEncode(k), percentEncode(v)]);
  pairs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));

  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const baseString = ['POST', percentEncode(baseUrl), percentEncode(normalized)].join('&');
  const signingKey = percentEncode(secret) + '&';
  const expected = toBase64(await hmac('SHA-1', signingKey, baseString));

  if (!timingSafeEqual(expected, form.get('oauth_signature') || '')) return { ok: false, reason: 'bad signature' };
  return { ok: true };
}

/** Derive an opaque player id from Moodle's user_id so the database can't be joined back to Moodle. */
export async function playerId(userId, salt) {
  return toHex(await hmac('SHA-256', salt, userId)).slice(0, 32);
}

/** Create a signed, expiring token carried by the game page instead of a cookie. */
export async function signToken(payload, secret) {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = toBase64Url(await hmac('SHA-256', secret, body));
  return `${body}.${sig}`;
}

export async function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = toBase64Url(await hmac('SHA-256', secret, body));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}
