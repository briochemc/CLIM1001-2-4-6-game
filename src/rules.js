// The hidden rules. Each must accept (2, 4, 6).
// Wason's original is "ascending". The others are alternatives you can add to
// RULE_POOL in wrangler.toml to reduce word-of-mouth leakage between students.

export const RULES = {
  ascending: {
    name: 'Any three numbers in increasing order',
    test: (a, b, c) => a < b && b < c,
  },
  distinct: {
    name: 'Any three different numbers',
    test: (a, b, c) => a !== b && b !== c && a !== c,
  },
  positive: {
    name: 'Any three positive numbers',
    test: (a, b, c) => a > 0 && b > 0 && c > 0,
  },
  lastLargest: {
    name: 'The last number is the largest',
    test: (a, b, c) => c > a && c > b,
  },
};

/** Deterministically assign a rule from the pool to a player id. */
export function pickRule(poolSpec, pid) {
  const pool = poolSpec.split(',').map((s) => s.trim()).filter((s) => RULES[s]);
  if (pool.length === 0) return 'ascending';
  if (pool.length === 1) return pool[0];
  const n = parseInt(pid.slice(0, 8), 16);
  return pool[n % pool.length];
}
