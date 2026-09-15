import gameHtml from './game.html';
import { verifyLtiLaunch, signedLaunch, playerId, signToken, verifyToken } from './auth.js';
import { RULES, pickRule } from './rules.js';
import { gradeText } from './rule-patterns.js';
import { tallyRows } from './tally.js';

const TOKEN_TTL_SECONDS = 4 * 60 * 60; // a launch stays valid for 4 hours
const MAX_ATTEMPTS = 40;
const CONFIDENCE = new Set(['unsure', 'fairly', 'certain']);
const SELF_VERDICT = new Set(['same', 'different', 'skipped']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/launch') return await launch(request, env);
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) return await api(request, env, url.pathname.slice(5));
      if (request.method === 'GET' && url.pathname === '/') return landing();
      if (request.method === 'GET' && url.pathname === '/dev' && env.DEV_LAUNCHER === '1') return devLauncher(url, env);
      return text('Not found', 404);
    } catch (err) {
      console.error(err);
      return text('Something went wrong on our side. Please try again in a moment.', 500);
    }
  },
};

/* ---------- LTI launch ---------- */

async function launch(request, env) {
  const form = await request.formData();
  const check = await verifyLtiLaunch(request.url, form, env.LTI_KEY, env.LTI_SECRET);
  if (!check.ok) return text(`Launch rejected: ${check.reason}. Please open the game from Moodle.`, 403);

  // Replay protection: each nonce is accepted once.
  const nonce = form.get('oauth_nonce');
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare('INSERT INTO nonces (nonce, ts) VALUES (?, ?)').bind(nonce, now).run();
  } catch (err) {
    if (!/UNIQUE|PRIMARY KEY/i.test(String(err.message))) throw err; // e.g. tables missing: report as a server error
    return text('Launch rejected: replayed request. Please open the game from Moodle again.', 403);
  }

  const userId = form.get('user_id');
  const ctx = form.get('context_id') || 'default';
  if (!userId) return text('Launch rejected: Moodle did not send a user id.', 403);

  const pid = await playerId(userId, ctx, env.PLAYER_SALT);
  const rule = pickRule(env.RULE_POOL || 'ascending', pid);
  const role = launchRole(form.get('roles'));

  await env.DB.prepare(
    `INSERT INTO sessions (pid, ctx, role, rule, first_seen, launches) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(pid) DO UPDATE SET launches = launches + 1, role = excluded.role`,
  ).bind(pid, ctx, role, rule, now).run();

  const token = await signToken({ pid, ctx, exp: now + TOKEN_TTL_SECONDS }, env.SESSION_SECRET);
  const state = await playerState(env, pid);
  const page = gameHtml
    .replace('__TOKEN__', token)
    .replace('__STATE__', JSON.stringify(state).replace(/</g, '\\u003c'));

  return new Response(page, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Moodle sends roles such as "Instructor", "Learner" or "urn:lti:role:ims/lis/Instructor",
// comma separated when there are several. Anyone with a staff role is an instructor here.
function launchRole(roles) {
  return /instructor|teachingassistant|contentdeveloper|administrator|mentor|manager/i.test(roles || '') ? 'instructor' : 'learner';
}

/* ---------- Game API ---------- */

async function api(request, env, action) {
  const auth = request.headers.get('authorization') || '';
  const claims = await verifyToken(auth.replace(/^Bearer\s+/i, ''), env.SESSION_SECRET);
  if (!claims) return json({ error: 'Your session has expired. Please open the game from Moodle again.' }, 401);

  const body = await request.json().catch(() => ({}));
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE pid = ?').bind(claims.pid).first();
  if (!session) return json({ error: 'Unknown session. Please open the game from Moodle again.' }, 401);

  switch (action) {
    case 'attempt':
      return attempt(env, session, body);
    case 'finish':
      return finish(env, session, body);
    case 'verdict':
      return verdict(env, session, body);
    case 'stats':
      return json({ stats: await cohortStats(env, session.ctx, session.rule) });
    default:
      return json({ error: 'Unknown action' }, 404);
  }
}

function parseTriple(body) {
  const nums = ['a', 'b', 'c'].map((k) => Number(body[k]));
  if (nums.some((n) => !Number.isInteger(n) || Math.abs(n) > 1e9)) return null;
  return nums;
}

async function attempt(env, session, body) {
  const triple = parseTriple(body);
  if (!triple) return json({ error: 'Please enter three whole numbers.' }, 400);
  const [a, b, c] = triple;
  const fits = RULES[session.rule].test(a, b, c);

  // Practice mode, or already finished: evaluate without recording.
  if (body.practice || session.finished) return json({ fits, recorded: false });

  if (session.n_attempts >= MAX_ATTEMPTS) {
    return json({ error: `You have tested ${MAX_ATTEMPTS} sets. Time to write down your rule.` }, 400);
  }
  const n = session.n_attempts + 1;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts (pid, n, a, b, c, fits, ts) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      session.pid, n, a, b, c, fits ? 1 : 0, now,
    ),
    env.DB.prepare('UPDATE sessions SET n_attempts = ?, n_no = n_no + ? WHERE pid = ?').bind(
      n, fits ? 0 : 1, session.pid,
    ),
  ]);
  return json({ fits, recorded: true, n });
}

async function finish(env, session, body) {
  if (session.finished) return json({ error: 'You have already submitted a rule.' }, 400);
  const ruleText = String(body.rule_text || '').trim().slice(0, 500);
  const confidence = String(body.confidence || '');
  if (!ruleText) return json({ error: 'Please write down what you think the rule is.' }, 400);
  if (!CONFIDENCE.has(confidence)) return json({ error: 'Please say how sure you are.' }, 400);

  const now = Math.floor(Date.now() / 1000);

  // Grade straight away when the wording is recognised; otherwise a person will
  // (scripts/grade.mjs), and the class tally catches up then.
  const auto = gradeText(session.rule, ruleText);
  const graded = { ...session, finished: now, rule_text: ruleText, confidence, verdict: auto?.verdict || null };

  const stmts = [
    env.DB.prepare('UPDATE sessions SET finished = ?, rule_text = ?, confidence = ?, verdict = ?, graded_by = ?, graded_at = ? WHERE pid = ?')
      .bind(now, ruleText, confidence, graded.verdict, auto ? `auto:${auto.id}` : null, auto ? now : null, session.pid),
    ...tallyRows(graded).map(([k, n]) =>
      env.DB.prepare(
        `INSERT INTO tally (ctx, rule, key, n) VALUES (?, ?, ?, ?)
         ON CONFLICT(ctx, rule, key) DO UPDATE SET n = n + excluded.n`,
      ).bind(session.ctx, session.rule, k, n),
    ),
  ];
  await env.DB.batch(stmts);
  return json({ rule_name: RULES[session.rule].name, verdict: graded.verdict });
}

// The player's own opinion of whether their rule matched. Optional and kept apart from
// the checked verdict, so the two can be compared later.
async function verdict(env, session, body) {
  if (!session.finished) return json({ error: 'Please submit your rule first.' }, 400);
  if (session.self_verdict) return json({ error: 'You have already answered this.' }, 400);
  const v = String(body.verdict || '');
  if (!SELF_VERDICT.has(v)) return json({ error: 'Please choose an answer.' }, 400);

  await env.DB.prepare('UPDATE sessions SET self_verdict = ? WHERE pid = ?').bind(v, session.pid).run();
  return json({ stats: await cohortStats(env, session.ctx, session.rule) });
}

/* ---------- Helpers ---------- */

async function playerState(env, pid) {
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE pid = ?').bind(pid).first();
  const { results } = await env.DB.prepare('SELECT a, b, c, fits FROM attempts WHERE pid = ? ORDER BY n').bind(pid).all();
  const state = {
    stage: session.self_verdict ? 'done' : session.finished ? 'reveal' : 'playing',
    attempts: results.map((r) => ({ a: r.a, b: r.b, c: r.c, fits: !!r.fits })),
    n_no: session.n_no,
    max_attempts: MAX_ATTEMPTS,
    rule_name: session.finished ? RULES[session.rule].name : null,
    rule_text: session.rule_text,
    confidence: session.confidence,
    verdict: session.verdict, // as checked; null while waiting for a person
    self_verdict: session.self_verdict,
    role: session.role,
  };
  if (state.stage === 'done') state.stats = await cohortStats(env, session.ctx, session.rule);
  return state;
}

// Class stats are over checked sessions only. `finished` says how many are waiting.
async function cohortStats(env, ctx, rule) {
  const min = Number(env.MIN_COHORT || 5);
  const { results } = await env.DB.prepare('SELECT key, n FROM tally WHERE ctx = ? AND rule = ?').bind(ctx, rule).all();
  const t = Object.fromEntries(results.map((r) => [r.key, r.n]));
  const graded = t.graded || 0;
  const finished = t.finished || 0;
  if (graded < min) return { graded, finished, min_cohort: min, available: false };
  return { graded, finished, min_cohort: min, available: true, counts: t };
}

function landing() {
  return text(
    'This is the CLIM1001 2-4-6 game. It only runs when opened from Moodle, so there is nothing to see here.',
    200,
  );
}

/* ---------- Local development only ---------- */

// Stands in for Moodle: pick a user and a course, and the browser is sent through a
// signed launch exactly as Moodle would do it. Only reachable when DEV_LAUNCHER=1 is set,
// which .dev.vars does and production never should.
async function devLauncher(url, env) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const userId = url.searchParams.get('user');
  const ctx = url.searchParams.get('ctx') || 'course-A';
  const roles = url.searchParams.get('instructor') ? 'Instructor' : 'Learner';

  if (!userId) {
    return html(`<!doctype html><meta charset="utf-8"><title>Dev launcher</title>
<body style="font: 16px system-ui; max-width: 30rem; margin: 3rem auto">
<h1>Pretend to be a Moodle student</h1>
<form>
  <p><label>User id <input name="user" value="alice" required></label></p>
  <p><label>Course id <input name="ctx" value="${esc(ctx)}"></label></p>
  <p><label><input type="checkbox" name="instructor" value="1"> Launch as an instructor (plays, but is not counted)</label></p>
  <p><button>Launch the game</button></p>
</form>
<p style="color:#666">Same user id + course id = same player, so reopening resumes where they left off.</p>`);
  }

  const launchUrl = `${url.origin}/launch`;
  const fields = await signedLaunch(launchUrl, { userId, ctx, roles, consumerKey: env.LTI_KEY, secret: env.LTI_SECRET });
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('\n');
  return html(`<!doctype html><meta charset="utf-8"><title>Launching…</title>
<form id="f" method="post" action="${esc(launchUrl)}">${inputs}<noscript><button>Continue</button></noscript></form>
<script>document.getElementById('f').submit()</script>`);
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
