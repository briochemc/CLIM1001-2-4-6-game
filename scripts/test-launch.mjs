// Simulates Moodle launching the tool, so you can test without Moodle.
//
//   npm run dev                       (in one terminal)
//   npm run test-launch -- alice      (in another; the argument is a fake user id)
//
// Prints the HTML the game would return, or the rejection reason.
// Reads LTI_KEY and LTI_SECRET from .dev.vars so the signature matches wrangler dev.

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const userId = process.argv[2] || 'test-user-1';
const toolUrl = process.env.TOOL_URL || 'http://localhost:8787/launch';

const vars = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
}
const key = process.env.LTI_KEY || vars.LTI_KEY;
const secret = process.env.LTI_SECRET || vars.LTI_SECRET;
if (!key || !secret) {
  console.error('Set LTI_KEY and LTI_SECRET in .dev.vars (copy .dev.vars.example) or in the environment.');
  process.exit(1);
}

const pe = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

const params = {
  lti_message_type: 'basic-lti-launch-request',
  lti_version: 'LTI-1p0',
  resource_link_id: 'rl-1',
  user_id: userId,
  roles: 'Learner',
  context_id: process.env.CONTEXT_ID || 'course-42',
  oauth_consumer_key: key,
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  oauth_nonce: randomBytes(8).toString('hex'),
  oauth_version: '1.0',
};

const url = new URL(toolUrl);
const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
const normalized = Object.entries(params)
  .map(([k, v]) => [pe(k), pe(v)])
  .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : 1))
  .map(([k, v]) => `${k}=${v}`)
  .join('&');
const base = ['POST', pe(baseUrl), pe(normalized)].join('&');
params.oauth_signature = createHmac('sha1', pe(secret) + '&').update(base).digest('base64');

const res = await fetch(toolUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params),
});
console.log(`HTTP ${res.status}`);
const body = await res.text(); console.log(process.env.FULL ? body : body.slice(0, 600));
