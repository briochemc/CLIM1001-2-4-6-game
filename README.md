# CLIM1001 2-4-6 game

A small in-class version of Wason's 2-4-6 rule-discovery task, built as an LTI 1.1 tool for
Moodle and hosted on Cloudflare Workers with a D1 database.

Students click the activity in Moodle, test sets of three numbers, write down the rule they
think they have found, say how confident they are, and are then shown the real rule and how
the rest of the class did. Nothing identifying is stored: Moodle's opaque `user_id` is hashed
with a secret before it ever reaches the database, and no names or emails are requested.

## How it fits together

```
Moodle (External tool activity)
   |  signed LTI 1.1 launch (POST /launch)
   v
Cloudflare Worker  src/index.js      verifies the signature, serves src/game.html
   |                                  with a short-lived signed token baked in
   v
D1 database        schema.sql        sessions, attempts, tally (running class counts)
```

The game page calls `/api/attempt`, `/api/finish`, `/api/verdict` and `/api/stats` with the
token in an `Authorization` header. No cookies are used, so it works inside the Moodle iframe
in every browser.

Only a player's first completed session in a course is counted. Later launches show their
result and the class stats, with an explicitly labelled practice mode that records nothing.
A player is identified by the hash of course and user together, so someone enrolled in two
courses that both use the tool gets a separate game, and a separate count, in each.

## Setup

You need Node.js 18 or newer and a free Cloudflare account.

```sh
npm install
npx wrangler login                 # opens a browser once
npx wrangler d1 create clim1001-246-game
```

Copy the `database_id` that the last command prints into `wrangler.toml`, then:

```sh
npm run db:remote                  # creates the tables
npx wrangler secret put LTI_KEY        # e.g. clim1001
npx wrangler secret put LTI_SECRET     # a long random string; also goes in Moodle
npx wrangler secret put SESSION_SECRET # a long random string
npx wrangler secret put PLAYER_SALT    # a long random string
npm run deploy
```

`deploy` prints the tool's address, something like `https://clim1001-246-game.<you>.workers.dev`.
Generate the random strings with `openssl rand -base64 32` or similar.

## Moodle configuration

In the course, add an activity of type **External tool**:

- Tool URL: `https://clim1001-246-game.<you>.workers.dev/launch`
- Click **Show more...**: Consumer key = the `LTI_KEY` you set, Shared secret = the `LTI_SECRET`
- Launch container: **Embed, without blocks**
- Privacy: leave *Share launcher's name* and *Share launcher's email* unticked
- Grade: no grade needed; the tool never sends grades back

## Local development

```sh
cp .dev.vars.example .dev.vars     # edit the values if you like
npm run db:local
npm run dev                        # tool runs at http://localhost:8787
```

In a second terminal, simulate Moodle launching the tool for a fake user:

```sh
npm run test-launch -- alice
```

To play the game in a browser during development, save the HTML that the script prints
(`FULL=1 npm run test-launch -- alice > /tmp/game.html`) and open it. The page talks to the
dev server at `/api/...`, so serve it from the same origin or just test the API directly.

## Configuration

`wrangler.toml` has two plain variables:

- `MIN_COHORT` (default 5): class stats stay hidden until this many people have finished, so
  the second person to finish can't work out how the first one did.
- `RULE_POOL` (default `ascending`): a comma-separated list of rules from `src/rules.js`.
  With one rule everyone plays the same game and the stats are directly comparable. With
  several, each player is deterministically assigned one, which limits word-of-mouth leakage.

## Looking at the data

```sh
npx wrangler d1 execute clim1001-246-game --remote --command \
  "SELECT confidence, verdict, COUNT(*) FROM sessions WHERE verdict IS NOT NULL GROUP BY 1, 2"
```

The `attempts` table holds every set each player tested, in order, if you want to look at
strategies in more detail. Export with `--command "SELECT * FROM attempts" --json`.

## Free-tier headroom

A session is about 15 requests and a dozen database writes. The Workers free plan allows
100,000 requests and 100,000 D1 row writes per day, so a thousand students in one day use
around 15% of either. Class stats are read from the small `tally` table rather than by
scanning sessions, which keeps daily row reads far below the 5 million limit.
