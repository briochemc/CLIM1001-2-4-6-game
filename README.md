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

## Setup, once

You need Node.js 18 or newer and a free Cloudflare account. This has already been done for
the current deployment; it is written down so it can be redone from scratch.

### 1. Log in and create the database

```sh
npm install
npx wrangler login                 # opens a browser once
npx wrangler d1 create clim1001-246-game
```

The last command prints a `database_id`. Put it in `wrangler.toml` in place of the
placeholder. If you lose it, `npx wrangler d1 list` shows it again. Until this is done every
`--remote` command fails with "Invalid uuid".

### 2. Create the tables

```sh
npm run db:remote
```

This runs `schema.sql` against the remote database. It is safe to rerun: every statement is
`CREATE ... IF NOT EXISTS`. It asks for confirmation; add `-- --yes` to skip the prompt.

### 3. Set the secrets

The worker needs four secrets. Cloudflare stores them but never shows them again, so keep
your own copy of the two that Moodle also needs.

| Secret | What it is | Who else needs it |
|---|---|---|
| `LTI_KEY` | The consumer key, a short name such as `clim1001` | Moodle |
| `LTI_SECRET` | A long random string that signs every launch | Moodle |
| `SESSION_SECRET` | A long random string that signs the page's session token | nobody |
| `PLAYER_SALT` | A long random string that hashes Moodle user ids | nobody |

Set each one with `npx wrangler secret put NAME`, which prompts for the value, or pipe it in:

```sh
printf '%s' clim1001 | npx wrangler secret put LTI_KEY
openssl rand -base64 32 | tr -d '/+=' | npx wrangler secret put LTI_SECRET
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
openssl rand -base64 48 | npx wrangler secret put PLAYER_SALT
```

Write the key and the LTI secret down somewhere safe before piping them away. For the
current deployment they are in `.wrangler/moodle-secrets.txt`, which git ignores, and
`npm run moodle-secrets` prints them whenever a Moodle activity needs setting up. If the
file is lost, the same command explains how to set a fresh secret.

Changing `PLAYER_SALT` later breaks the link between existing sessions and returning
players, who would then start a fresh game. Changing `LTI_SECRET` requires updating Moodle.
The other two can be rotated freely.

### 4. Register a workers.dev subdomain and deploy

```sh
npm run deploy
```

The first time, wrangler asks to register a *workers.dev subdomain* for the account. This
name is per Cloudflare account, not per project: every worker deployed on the account gets
an address of the form `<worker-name>.<subdomain>.workers.dev`, so a general name is right.
The subdomain for this account is `briochemc`; the project-specific part is the worker name,
`clim1001-246-game` from `wrangler.toml`. The same choice can be made in the dashboard under
Workers & Pages, Overview.

`deploy` ends by printing the tool address, which for this deployment is
`https://clim1001-246-game.briochemc.workers.dev`. Every later code change is published
with the same command, in a few seconds, with no downtime.

### 5. Check the live worker before involving Moodle

Opening the address in a browser shows a one-line landing text; `/dev` gives "Not found",
because the dev launcher only exists locally. A signed launch can be sent from the terminal:

```sh
TOOL_URL=https://clim1001-246-game.briochemc.workers.dev/launch \
LTI_KEY=clim1001 LTI_SECRET=<the shared secret> \
npm run test-launch -- someone
```

`HTTP 200` followed by the page's HTML means signing, the database, and the secrets all
agree. This leaves one session in a course called `course-A`; delete it with the cleanup
query under *Looking at the data*, or ignore it, since real courses have other ids.

## Moodle configuration

In the course, add an activity of type **External tool**:

- Tool URL: `https://clim1001-246-game.briochemc.workers.dev/launch`
- Click **Show more...**: Consumer key = `LTI_KEY`, Shared secret = `LTI_SECRET`
- Launch container: **Embed, without blocks**
- Privacy: leave *Share launcher's name* and *Share launcher's email* unticked
- Grade: no grade needed; the tool never sends grades back

The same tool can be added to any number of courses with the same key and secret. Each
course gets its own class statistics, because Moodle sends a different `context_id` per
course.

Moodle also sends the launcher's role. Anyone with a staff role in the course (teacher,
non-editing teacher, manager) is recorded as an instructor: they can play, the page tells
them so, and their session is counted separately from the students'. Students only ever
see student numbers. Instructors see the same by default, with a switch above the charts
to show staff only or everyone, and they see the charts even before the course has reached
`MIN_COHORT` checked answers. So instructors can try the activity in the real course
without polluting the numbers. The role is stored in `sessions.role`; staff counts live in
the tally under keys prefixed `staff|`.

### Giving the game the full window, with links to the neighbouring activities

Embedded, Moodle gives the tool whatever height is left of the browser window below its own
header, and the game has to scroll inside that frame. Core Moodle offers no way for a tool
to ask for more height, and no setting for it. The way around it is to let the game take
over the window, and to give students links back into the course from inside the game.

1. Edit the External tool activity and set **Launch container** to **Existing window**.
   (Phones and tablets always get this, whatever the setting.)
2. Collect the addresses. On any activity page in the course, right-click Moodle's
   *previous activity* and *next activity* buttons and copy the link, or open the activity
   and copy the address bar. They look like
   `https://moodle.example.edu/mod/lesson/view.php?id=9119456&forceview=1`. The
   `forceview=1` part is something Moodle adds to its own navigation buttons and is fine to
   keep.
3. Still in the activity settings, click **Show more...** and fill **Custom parameters**,
   one per line:

   ```
   prev_url=https://moodle.example.edu/mod/lesson/view.php?id=9119456&forceview=1
   next_url=https://moodle.example.edu/mod/lesson/view.php?id=9119457&forceview=1
   course_url=https://moodle.example.edu/course/view.php?id=101857
   ```

4. Save, and open the activity. A footer under the game shows *← Previous activity*,
   *Back to the course* and *Next activity →* on every screen, next to the existing
   *Play again for fun* button on the results screen.

| Parameter | Effect |
|---|---|
| `prev_url`, `next_url` | Adds the link. Leave the line out and that link is not shown. |
| `course_url` | Optional. Without it, *Back to the course* uses the return address Moodle sends with every launch, which leads to the course home page. |
| `prev_label`, `next_label`, `course_label` | Optional wording, up to 60 characters, e.g. `next_label=Week 3 quiz` shows *Week 3 quiz →*. |

Things to know:

- The footer appears only when the game has the whole window. In an embedded activity
  nothing changes, because Moodle's own navigation is already around the frame. So the
  same tool can be embedded in one course and full-window in another.
- The parameters belong to the activity, so each course, and each copy of the activity,
  sets its own.
- Moodle sends them inside the signed launch, so students cannot change where the links
  go, and the tool only accepts ordinary `http(s)` addresses.
- **The addresses are fixed text.** When activities are moved or replaced, or the course is
  copied for a new year, Moodle gives activities new id numbers. Check these lines at every
  rollover, or the links lead to last year's pages.

To try it locally, tick *Send previous / next / course links* on the dev launcher page. It
uses `DEV_PREV_URL`, `DEV_NEXT_URL` and `DEV_COURSE_URL` from `.dev.vars` if they are set
(see `.dev.vars.example`), which keeps real course addresses out of the repository. From
the command line, `PREV_URL=... NEXT_URL=... COURSE_URL=... npm run test-launch -- alice`
does the same. The dev launcher opens the game in a full window, so the footer shows.

## Day-to-day operations

| Task | Command |
|---|---|
| Publish a code change | `npm run deploy` |
| Show the key and secret for a new Moodle activity | `npm run moodle-secrets` |
| Grade the rules students wrote | `npm run grade` (see below) |
| See how many finished, per course | `npx wrangler d1 execute clim1001-246-game --remote --command "SELECT ctx, COUNT(*), SUM(verdict IS NOT NULL) AS checked FROM sessions WHERE finished IS NOT NULL GROUP BY ctx"` |
| Remove one course's data | see *Looking at the data* |
| Reset or rotate the Moodle secret | see *Resetting the shared secret* |

Class stats stay hidden until `MIN_COHORT` checked answers exist in a course, so the first
few students in each course see "results appear once ..." rather than a chart.

### Resetting the shared secret

Cloudflare stores secrets write-only, so the shared secret cannot be read back from any
machine. If it is not in the password manager and not in `.wrangler/moodle-secrets.txt` on
the machine at hand, set a new one. It takes a minute and touches no data; launches fail
with "bad signature" only between the two steps, so do them together.

1. On any machine logged in with `npx wrangler login`, generate and upload a new secret.
   `tee` shows the value on screen once so it can be copied:

   ```sh
   openssl rand -base64 32 | tr -d '/+=' | tee /dev/stderr | npx wrangler secret put LTI_SECRET
   ```

2. Put the value in the password manager, and in `.wrangler/moodle-secrets.txt` on that
   machine as `Shared secret: <value>` (with `Consumer key: clim1001` above it) so
   `npm run moodle-secrets` works there too.

3. In Moodle, edit every External tool activity that points at the tool and paste the new
   value into Shared secret under *Show more...*. Each activity holds its own copy, so a
   tool used in three courses means three edits. The consumer key stays `clim1001`.

Only `LTI_SECRET` ever needs this. `SESSION_SECRET` can be rotated the same way with no
other change (players mid-game are asked to reopen the activity). `PLAYER_SALT` should
not be rotated while a course is running: returning players would no longer match their
earlier session and would start a fresh game.

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
one: `s` for the same rule, `d` for a different rule, Enter to leave it for later. Under each
answer it shows the sets that student tested, with ✓ or ✗ for whether each fitted, which is
often the best clue to what a terse answer such as `<<<` meant. It then
writes the verdicts back and rebuilds the class tally. `npm run grade -- --list` only
reports; `--show-auto` also prints every pattern-graded answer so you can spot mistakes;
`--local` targets the local dev database.

Pattern grades can be checked by eye too. `npm run grade -- --review` walks through every
pattern-graded answer nobody has looked at yet, with the tests under it: Enter agrees, `s`
or `d` corrects, `q` stops (what was reviewed so far is kept, so it can be done in
sittings). `--review-all` walks through every checked answer, reviewed before or not.
Each session records how its verdict came about in `sessions.graded_by`:

| `graded_by` | Meaning |
|---|---|
| `auto:<pattern>` | the pattern decided; nobody has looked |
| `checked:<pattern>` | the pattern decided; a person agreed |
| `corrected:<pattern>` | the pattern decided; a person overrode it |
| `manual` | no pattern matched; a person decided |

Only `auto:` sessions are re-run through the patterns, so a review is never undone by a
later pattern change. The summary at the end of every run gives the four counts, and
`npm run grade -- --export` writes every answer with its state, wording and tests to
`.wrangler/answers.md` for reading in one go.

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

Player ids are salted hashes, so the course id (`ctx`) is the only readable handle on the
data. To remove one course entirely, for instance after testing against the live worker,
delete from all three tables, then let the next `npm run grade` rebuild the tally:

```sh
npx wrangler d1 execute clim1001-246-game --remote --command \
  "DELETE FROM attempts WHERE pid IN (SELECT pid FROM sessions WHERE ctx = 'course-A');
   DELETE FROM sessions WHERE ctx = 'course-A';
   DELETE FROM tally WHERE ctx = 'course-A'"
```

When trying things against the live worker, use a course id that starts with `test-` so a
single `WHERE ctx LIKE 'test-%'` finds everything to remove later. Normal development does
not need this: `npm run dev` uses a local copy of the database that never touches the real
one.

## Free-tier headroom

A session is about 15 requests and a dozen database writes. The Workers free plan allows
100,000 requests and 100,000 D1 row writes per day, so a thousand students in one day use
around 15% of either. Class stats are read from the small `tally` table rather than by
scanning sessions, which keeps daily row reads far below the 5 million limit.
