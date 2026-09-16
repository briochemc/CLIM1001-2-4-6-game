// Prints the consumer key and shared secret to enter in Moodle.
//
//   npm run moodle-secrets
//
// Cloudflare stores secrets write-only, so the values come from the local copy written
// when they were set (.wrangler/moodle-secrets.txt, ignored by git). Without that file
// the only option is to set a new secret, in Cloudflare and in every Moodle activity.

import { readFileSync, existsSync } from 'node:fs';

const file = '.wrangler/moodle-secrets.txt';
if (existsSync(file)) {
  process.stdout.write(readFileSync(file, 'utf8'));
} else {
  console.error(`No ${file} on this machine.

Cloudflare cannot show a secret once it is set. To start again with a new one:

  openssl rand -base64 32 | tr -d '/+=' | tee .wrangler/moodle-secrets.txt | npx wrangler secret put LTI_SECRET

then edit ${file} to add the two lines "Consumer key: clim1001" and "Shared secret: <value>",
and update the shared secret in every Moodle activity that uses the tool.`);
  process.exit(1);
}
