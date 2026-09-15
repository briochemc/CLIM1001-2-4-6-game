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

This uses a local copy of the database under `.wrangler/state/`; the real one on Cloudflare
is never touched. `npm run db:reset-local` wipes it and starts again.

To play in a browser, open <http://localhost:8787/dev>, type any user id and course id, and
you are launched into the game as that student, exactly as Moodle would do it. The same
user id and course id resume the same player. The page only exists when `DEV_LAUNCHER=1` is
set in `.dev.vars`, so it is never reachable in production.

Class stats stay hidden until `MIN_COHORT` students have finished, so to see them, let a
class of fake students play first:

```sh
npm run seed -- course-A 12        # course id, number of students
```

Then launch yourself into `course-A` from the dev page, finish the game, and the results of
the twelve seeded students appear below yours. Seed a second course to check that the two
are kept apart. The seed script prints the raw stats it gets back from the API.

From the command line, `npm run test-launch -- alice` performs one launch and prints the
start of the page (`CONTEXT_ID=course-B` picks the course, `FULL=1` prints everything).

`npm run check-charts` renders the class-result charts with made-up numbers, including
edge cases, into `.wrangler/charts-preview.html`, so a change to them can be eyeballed
without playing through the game.

## Configuration

`wrangler.toml` has two plain variables:

- `MIN_COHORT` (default 5): class stats stay hidden until this many people have finished, so
  the second person to finish can't work out how the first one did.
- `RULE_POOL` (default `ascending`): a comma-separated list of rules from `src/rules.js`.
  With one rule everyone plays the same game and the stats are directly comparable. With
  several, each player is deterministically assigned one, which limits word-of-mouth leakage.

## Checking the rules students write

Whether a student's rule matches is decided by a person, not by the student. When a
student submits a rule, the worker first tries the patterns in `src/rule-patterns.js`:
phrasings of the real rule ("increasing", "each bigger than the last", "a < b < c") and
the classic stricter rules ("even", "by two", "same interval", "positive"). A recognised
answer is graded on the spot and the class charts include it immediately. Anything else
waits for you. Students also say what they think of their own rule, but that is optional,
kept separately, and never shown as a result.

Once a day, or whenever you like:

```sh
npm run grade
```

This re-runs the patterns over every finished session (so a pattern you added today also
grades last week's answers), lists what still matches nothing, and asks you to grade each
one: `s` for the same rule, `d` for a different rule, Enter to leave it for later. It then
writes the verdicts back and rebuilds the class tally. `npm run grade -- --list` only
reports; `--show-auto` also prints every pattern-graded answer so you can spot mistakes;
`--local` targets the local dev database.

When several hand-graded answers say the same thing, add a pattern for it to
`src/rule-patterns.js`, add the wording to `scripts/check-patterns.mjs`, run
`npm run check-patterns`, commit, and `npm run deploy` so new students get the instant
result too. The pattern file in git is the record of every grading decision.

The class charts are always over checked answers only, and the page says "checked so far:
41 of 58" so students know why theirs may not be in yet.

## Looking at the data

```sh
npx wrangler d1 execute clim1001-246-game --remote --command \
  "SELECT ctx, verdict, self_verdict, COUNT(*) FROM sessions WHERE finished IS NOT NULL GROUP BY 1, 2, 3"
```

The `attempts` table holds every set each player tested, in order, if you want to look at
strategies in more detail. Export with `--command "SELECT * FROM attempts" --json`.

## Free-tier headroom

A session is about 15 requests and a dozen database writes. The Workers free plan allows
100,000 requests and 100,000 D1 row writes per day, so a thousand students in one day use
around 15% of either. Class stats are read from the small `tally` table rather than by
scanning sessions, which keeps daily row reads far below the 5 million limit.
