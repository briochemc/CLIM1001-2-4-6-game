// Plays the game as a class of fake students, so the class stats have something to show.
//
//   npm run dev                          (in one terminal)
//   npm run seed -- course-A 12          (in another: course id, number of students)
//
// Each fake student tests a few sets, writes a rule, and answers the self-check.
// Roughly half only ever test sets that fit (the classic confirmation-bias pattern) and tend
// to be confidently wrong; the rest test at least one set that does not fit and mostly get
// the rule right. Some wordings are deliberately odd so that `npm run grade` has something
// to ask about. Results are deterministic for a given course id and student number, so
// running the seed twice adds nothing new: those students have already finished.
//
// Only talks to the /launch and /api endpoints, so it works against any deployment you
// set TOOL_URL to. Keep it pointed at localhost unless you mean to seed a real database.

import { launchToken, api, config } from './lti.mjs';

const { toolUrl, key, secret } = config();
const ctx = process.argv[2] || 'course-A';
const count = Number(process.argv[3] || 8);

// Small seeded generator so the same course always produces the same class.
function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const pick = (r, table) => {
  let x = r();
  for (const [value, weight] of table) if ((x -= weight) < 0) return value;
  return table[table.length - 1][0];
};

const CONFIRMER_SETS = [[4, 6, 8], [10, 12, 14], [1, 3, 5], [20, 22, 24], [100, 102, 104], [3, 6, 9], [5, 10, 15], [-2, 0, 2]];
const PROBING_SETS = [[1, 2, 3], [6, 4, 2], [5, 5, 5], [1, 10, 100], [3, 2, 1], [2, 4, 7], [-5, 0, 5], [10, 9, 8]];
const RULES_WRONG = ['Each number is 2 more than the last', 'Even numbers going up', 'Numbers that go up by the same amount', 'n, n+2, n+4'];
const RULES_RIGHT = ['Any three numbers in increasing order', 'The numbers just have to get bigger', 'Ascending order', 'each one larger than the one before'];
const RULES_ODD = ['in order', 'a pattern where things progress', "goes up but doesn't have to be even", 'no idea, something with the numbers'];

const stats = { done: 0, skipped: 0, auto: 0 };
for (let i = 1; i <= count; i++) {
  const userId = `seed-${i}`;
  const r = rng(`${ctx}/${userId}`);
  const token = await launchToken(toolUrl, { userId, ctx, consumerKey: key, secret });

  const probes = r() < 0.5;
  const sets = probes ? [...CONFIRMER_SETS.slice(0, 3), ...PROBING_SETS] : CONFIRMER_SETS;
  const nAttempts = 3 + Math.floor(r() * (sets.length - 2));
  const chosen = [...sets].sort(() => r() - 0.5).slice(0, nAttempts);

  let recorded = 0;
  try {
    for (const [a, b, c] of chosen) {
      const res = await api(toolUrl, token, 'attempt', { a, b, c });
      if (res.recorded) recorded++;
    }
    const wording = probes
      ? pick(r, [[RULES_RIGHT, 0.7], [RULES_WRONG, 0.15], [RULES_ODD, 0.15]])
      : pick(r, [[RULES_WRONG, 0.7], [RULES_RIGHT, 0.15], [RULES_ODD, 0.15]]);
    const confidence = probes
      ? pick(r, [['certain', 0.45], ['fairly', 0.4], ['unsure', 0.15]])
      : pick(r, [['certain', 0.55], ['fairly', 0.35], ['unsure', 0.1]]);
    // What they think of their own rule: mostly optimistic, sometimes skipped.
    const self = pick(r, [['same', 0.55], ['different', 0.25], ['skipped', 0.2]]);
    const fin = await api(toolUrl, token, 'finish', { rule_text: wording[Math.floor(r() * wording.length)], confidence });
    await api(toolUrl, token, 'verdict', { verdict: self });
    stats.done++;
    if (fin.verdict) stats.auto++;
    console.log(`${userId.padEnd(8)} ${probes ? 'probed ' : 'confirm'}  ${String(recorded).padStart(2)} sets  ${confidence.padEnd(7)} self:${self.padEnd(9)} checked:${fin.verdict || 'waiting'}`);
  } catch (e) {
    if (/already/.test(e.message)) { stats.skipped++; console.log(`${userId.padEnd(8)} already finished, left alone`); }
    else throw e;
  }
}

console.log(`\n${stats.done} students finished (${stats.auto} graded automatically), ${stats.skipped} were already done.`);
const last = await launchToken(toolUrl, { userId: 'seed-1', ctx, consumerKey: key, secret });
const { stats: s } = await api(toolUrl, last, 'stats');
console.log(`Class stats for ${ctx}:`, JSON.stringify(s, null, 2));
