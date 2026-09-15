// Shared helpers for the scripts: read .dev.vars and perform a signed LTI launch.
// Reuses the worker's own signing code (src/auth.js), which runs fine on Node 18+.

import { readFileSync, existsSync } from 'node:fs';
import { signedLaunch } from '../src/auth.js';

/** LTI key/secret from the environment or .dev.vars, plus the launch URL. */
export function config() {
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
  return { toolUrl: process.env.TOOL_URL || 'http://localhost:8787/launch', key, secret };
}

/** POST a signed launch for one user and return the raw fetch Response. */
export async function launch(toolUrl, opts) {
  const fields = await signedLaunch(toolUrl, opts);
  return fetch(toolUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

/** Launch and pull the session token out of the game page, for driving the API directly. */
export async function launchToken(toolUrl, opts) {
  const res = await launch(toolUrl, opts);
  const body = await res.text();
  if (!res.ok) throw new Error(`launch failed (${res.status}): ${body.slice(0, 200)}`);
  const m = body.match(/const TOKEN = "([^"]+)"/);
  if (!m) throw new Error('no session token found in the game page');
  return m[1];
}

/** Call one of the game's /api/ actions with a session token. */
export async function api(toolUrl, token, action, body) {
  const base = toolUrl.replace(/\/launch$/, '');
  const res = await fetch(`${base}/api/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${action}: ${data.error || res.status}`);
  return data;
}
