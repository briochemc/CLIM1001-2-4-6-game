// Exercises the chart builders from src/game.html outside a browser and writes the
// result to a standalone HTML file you can open, so a chart change can be eyeballed
// without playing through the game.
//
//   npm run check-charts            # writes .wrangler/charts-preview.html

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const page = readFileSync(new URL('../src/game.html', import.meta.url), 'utf8');
const css = page.match(/<style>([\s\S]*?)<\/style>/)[1];
const block = page.match(/<script>\s*\/\/ Chart builders[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g, '');

globalThis.window = globalThis;
new Function(block)();
const { pie, bars, stacked } = globalThis.charts;

// A twelve-person class, with the shapes the real API produces.
const counts = { same: 5, different: 7 };
const conf = { certain: 4, fairly: 6, unsure: 2 };
const rows = [];
for (let k = 0; k <= 40; k++) rows.push({ k, people: 0, no: 0 });
for (const [k, people, no] of [[3, 2, 1], [4, 1, 0], [5, 2, 0], [6, 4, 5], [8, 1, 0], [11, 2, 9]]) rows[k] = { k, people, no };

const cases = {
  'pie, three groups': pie(counts),
  'pie, one group only': pie({ same: 7 }),
  'pie, tiny slice': pie({ same: 30, different: 1 }),
  'confidence bars': bars(conf),
  'confidence bars, empty': bars({}),
  'tests histogram': stacked(rows),
  'tests histogram, someone tested nothing': stacked(rows.map((r) => (r.k === 0 ? { k: 0, people: 1, no: 0 } : r))),
  'tests histogram, up to 40': stacked(rows.map((r) => (r.k === 40 ? { k: 40, people: 1, no: 3 } : r))),
};

let failed = 0;
for (const [name, svg] of Object.entries(cases)) {
  const ok = typeof svg === 'string' && svg.startsWith('<svg') && !/NaN|undefined/.test(svg);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}

mkdirSync('.wrangler', { recursive: true });
const out = `<!doctype html><meta charset="utf-8"><title>Chart preview</title><style>${css}
  .gallery { grid-template-columns: 1fr 1fr; grid-template-areas: none; }</style>
<body><main><h1>As laid out on the results page</h1>
<div class="charts">
  <figure class="fig-pie"><figcaption>Did their rule match Dr. Devil's?<small>Hover or tap a slice to see just that group in the other charts.</small></figcaption>${cases['pie, three groups']}</figure>
  <figure class="fig-conf"><figcaption>How sure were they?</figcaption>${cases['confidence bars']}</figure>
  <figure class="fig-tests"><figcaption>How many sets did they test, and how many of those fitted?</figcaption>${cases['tests histogram']}</figure>
</div>
<h1>Every case</h1><div class="charts gallery">${Object.entries(cases)
  .map(([name, svg]) => `<figure><figcaption>${name}</figcaption>${svg}</figure>`)
  .join('')}</div></main>`;
writeFileSync('.wrangler/charts-preview.html', out);
console.log(`\nPreview written to .wrangler/charts-preview.html`);
process.exit(failed ? 1 : 0);
