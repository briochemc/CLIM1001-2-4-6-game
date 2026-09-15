// Checks src/rule-patterns.js against wordings with known answers. Run it after
// editing the patterns: npm run check-patterns
//
// Add a line here whenever a real answer was graded wrongly, then fix the pattern.

import { gradeText } from '../src/rule-patterns.js';

const CASES = [
  // same rule, many phrasings
  ['Any three numbers in increasing order', 'same'],
  ['ascending', 'same'],
  ['The numbers just have to get bigger', 'same'],
  ['numbers go up', 'same'],
  ['each number is larger than the one before', 'same'],
  ['Each number must be bigger than the previous number.', 'same'],
  ['from smallest to largest', 'same'],
  ['a < b < c', 'same'],
  ['sorted', 'same'],
  ['They increase, by any amount', 'same'],
  ['an ascending sequence', 'same'],
  ['the pattern is that the numbers go up', 'same'],
  ["numbers rising, they don't have to be even", null], // negation next to a restriction: a person decides
  ['increasing by one or more', null],

  // stricter rules
  ['Each number is 2 more than the last', 'different'],
  ['Even numbers going up', 'different'],
  ['even numbers', 'different'],
  ['Numbers that go up by the same amount', 'different'],
  ['add two each time', 'different'],
  ['n, n+2, n+4', 'different'],
  ['increase by 2', 'different'],
  ['an arithmetic sequence', 'different'],
  ['consecutive even numbers', 'different'],
  ['the middle number is the average of the other two', 'different'],
  ['positive numbers in ascending order', 'different'],
  ['multiples of 2', 'different'],
  ['each number is double the previous', 'different'],
  ['three numbers less than 100 going up', 'different'],

  // nobody knows
  ['', null],
  ['no idea', null],
  ['numbers', null],
  ['the second number is bigger than the first', 'same'], // first two only, but reads as ascending; review by hand if it recurs
  ['in order', null],
];

let failed = 0;
for (const [text, want] of CASES) {
  const got = gradeText('ascending', text);
  const v = got ? got.verdict : null;
  const ok = v === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(want).padEnd(9)} ${got ? got.id.padEnd(20) : '-'.padEnd(20)} ${JSON.stringify(text)}`);
}
console.log(failed ? `\n${failed} wrong` : '\nall as expected');
process.exit(failed ? 1 : 0);
