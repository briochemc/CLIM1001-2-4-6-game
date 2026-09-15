// Simulates Moodle launching the tool, so you can test without Moodle.
//
//   npm run dev                       (in one terminal)
//   npm run test-launch -- alice      (in another; the argument is a fake user id)
//
// Prints the HTML the game would return, or the rejection reason.
// Reads LTI_KEY and LTI_SECRET from .dev.vars so the signature matches wrangler dev.
// Set CONTEXT_ID to pretend the launch comes from a different course.

import { launch, config } from './lti.mjs';

const { toolUrl, key, secret } = config();
const userId = process.argv[2] || 'test-user-1';
const ctx = process.env.CONTEXT_ID || 'course-A';

const res = await launch(toolUrl, { userId, ctx, consumerKey: key, secret });
console.log(`HTTP ${res.status}`);
const body = await res.text();
console.log(process.env.FULL ? body : body.slice(0, 600));
