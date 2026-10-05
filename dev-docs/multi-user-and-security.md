# Multi-user, authentication & security

### Multi-user architecture (v2.0)

The app was single-user by design until v2.0. Everything below exists so that stays true for anyone who wants it - **an instance with `AUTH_ENABLED` unset behaves exactly as it did before**, no login, no user management UI, no per-user anything visible.

**One always-present owner, never a nullable user.** The v2 migration creates a fixed-id row (`OWNER_USER_ID = "user-owner"`, `lib/domain/users.ts`) with no credentials and backfills every pre-existing row to it. `getViewer()` (`lib/auth-context.ts`) resolves to that row without a session in mono mode. This is the single decision the whole design rests on: there is no `userId | null` branching anywhere, no "is multi-user enabled" check inside a query, and switching an existing instance to multi-user later attaches its history to the admin **by construction** - the bootstrap screen only sets credentials on a row that already owns everything. `lib/domain/users.ts` exists as its own module solely to break the `lib/auth.ts` ↔ `lib/auth-context.ts` import cycle.

**Two account sets, deliberately distinct** - the distinction that prevents privilege escalation, not a convenience:

- `baseAccountIds(userId)` = own ∪ co-owned. The **only** set allowed to back a derived artifact: share-link content, API-key responses, alert evaluation, internal-transfer detection, exports, net worth. Never includes a portfolio merely granted for reading, so a read-only guest can't mint a public link or an API key over the grantor's data - one that would keep working after the grant was revoked, since those tokens carry no grant check of their own.
- `viewAccountIds(userId, viewedGrantorId?)` = the above, or the grantor's set when a real `PortfolioGrant` exists. Request-scoped page reads only. A stale/revoked grant falls back to "own" silently rather than erroring - the switcher's selection is caller-supplied state, not a claim.

**A deleted account must never resolve to another one.** `getViewer()`'s owner fallback is only reachable with **no** live session. It used to be reachable with a session too: a member's account deleted while they had a tab open failed the id lookup, fell through, and came back as the owner with `role: "ADMIN"`. Reported from a real instance ("quand l'admin supprime ce compte, au refresh je suis connecté au compte admin"), and reproduced live before fixing - the deleted member's cookie rendered the owner's Settings page including the admin-only backup section, which dumps and restores the whole database. A session naming a user who no longer exists now raises `DeletedSessionUserError`; `app/layout.tsx` is the only caller allowed to catch it, and renders `SessionEnded`, which signs the browser out. Deliberately not a redirect: the layout renders on `/login` too, so redirecting there would loop. `__tests__/auth-context.test.ts` pins it, including that the owner row is never even looked up - that second query was the escalation.

The bug class is worth naming, because it is not "we forgot a check": **a failed identity lookup that falls through to a more privileged identity.** A sweep for the same shape across every other resolution path found none - `resolveUser` (no username means the owner, but a password still has to match, and a non-owner with no hash is rejected outright), `getTotpEnabled` (returns a bare boolean, grants nothing), `authenticateApiKey` and the share-link lookup (both deny on a miss), `viewAccountIds`/`getViewContext` (a stale grant falls back to the viewer's *own* set, which is narrower), and `removeAccountCoOwner`, the one remaining `"use server"` export taking a `userId`, which is gated on `assertAccountOwner` and only ever removes access. Every one of those falls in the safe direction. The rule to apply when adding another: **a lookup that fails must deny or narrow, never widen** - and if a fallback exists at all, it must be unreachable from the authenticated path.

**Owner state must never reach another user's experience, and the sweep for it is written down.** Two bugs shared one shape - the owner's row answering a question asked about somebody else: `getViewer()`'s fallback handing back the owner's identity, and the login form deciding whether to ask for a 2FA code from a `totpEnabled` fetched for the owner. Every remaining `OWNER_USER_ID` reference was then audited one by one, and all of them are correct **because the owner is genuinely the subject**, not a stand-in: `resolveUser`'s no-username path and `user.id !== OWNER_USER_ID` (the env password authenticates the owner and only the owner), `token.userId ??=` (a pre-v2 JWT), `assertOwnsEnvSync` and `autoTriggerSync` (`.env` bank credentials are the owner's, decision D3), `bootstrapOwner` and "the owner cannot be deleted", and `/api/realtime/notify`'s default (its one caller, `sync_tr_realtime.py`, listens for the env connection alone). `getTotpEnabled()` was **deleted** rather than left: it had no callers once the login form stopped guessing, and keeping a helper whose default is "answer for the owner" is keeping the next instance of this bug within reach. The rule: *if a function can be asked about a user, it must not have an owner-shaped default.*

**Guards, not hidden buttons.** `assertAccountWritable` / `assertOwned` / `assertTransactionsWritable` (`lib/auth-context.ts`) mirror the pre-existing `assert*Eligible` family and exist for the same stated reason: a Server Action is directly invocable regardless of what the UI renders. `assertOwned` throws an identical `"Not found."` for a missing row and for someone else's row - a distinguishing error would confirm the existence of another user's data to anyone enumerating ids. `assertTransactionsWritable` compares against the **distinct** id count, so a duplicated id can't pad a forged batch up to passing.

**A userId parameter on a `"use server"` export is an impersonation primitive.** Every export of such a module is directly invocable from the browser with attacker-chosen arguments. Two real instances were found and fixed while doing this:

- `getUserSettingsFor(userId)` was exported and returns the row holding `smtpPassword`/`ntfyAuthToken` in **plaintext** - it would have handed any authenticated user every other user's alert credentials. Now un-exported.
- `autoCategorizeTransactions` needed a userId to work per user, so the engine moved to `lib/services/auto-categorize-runner.ts` (a plain module) and the action file kept only a thin session-resolving wrapper. The two internal cron routes import the engine directly and loop over users themselves.

A scripted check for this shape is worth re-running whenever an action file gains a parameter - it's an easy mistake to make and an invisible one to review.

**Cron routes loop per user.** `/api/alerts/check` and `/api/transactions/auto-categorize` each iterate `prisma.user.findMany()`; in mono mode that's exactly one iteration over the owner. Alerts must be per-user or a notification would quote a net worth its recipient can't see anywhere in their own app. `/api/investments/snapshot-balances` deliberately stays one instance-wide pass - it recomputes each account's balance from that account's own holdings, reads no per-user config, and addresses no notification to anyone, so a per-user loop would be the same work split into more queries.

**Internal-transfer detection had to stop being global.** `lib/domain/internal-transfers.ts`'s header states the assumption it was built on: every account in the database belongs to the same person, so any same-amount cross-account pair is safe to treat as a transfer. That's false in multi-user, and a global pass becomes a cross-user false-positive generator - user A's €500 debit and user B's unrelated €500 credit two days apart would be paired and both silently excluded from their owners' budgets and income. The pass now pools `baseAccountIds(runner)`. Safe to run from several users' passes over a co-owned account: the write only ever sets the flag to `true` (monotonic), so two passes can't thrash a row.

**Per-browser stores are namespaced too**, since neither is reachable by a server-side check: the service worker's runtime cache (`public/sw.js`, keyed by a `u=` registration param - a different value is a different worker URL, so it installs and its `activate` handler evicts every other bucket) and the app-lock unlock flag in `sessionStorage`.

**Same physical bank account, two users** (`app/api/gocardless/callback/route.ts`): `Account.gocardlessAccountId` is globally unique, so the upsert would silently rewrite the first user's row and append a balance snapshot to it. The callback now skips a conflicting account and redirects with `?gc=already-connected`, pointing the user at co-ownership instead. Attribution comes from `institution.userId`, never the session - this is a redirect back from the bank and can legitimately arrive without a cookie, which is also why the ownership check for starting a connection lives in `app/api/gocardless/connect/route.ts` instead.

**Two sharing mechanisms, deliberately not one** (`lib/actions/sharing.ts`):

- **Co-ownership** (`AccountCoOwner`) is per **account** and grants **write**. A joint Livret A appears in both portfolios pointing at the same rows - either person can categorize a transaction on it. It works by putting the account inside `baseAccountIds`, so every existing guard admits it with no special case. Managed from the account header (`components/account-detail/co-owners-dialog.tsx`), offered only to the account's **direct** owner: a co-owner cannot add further co-owners, which keeps `Account.userId` the single answer to "who decides who sees this" (`assertAccountOwner`, deliberately *not* `assertAccountWritable`, which also passes for co-owners).
- **Co-ownership moved from a bottom-of-page card into the header (v2.4).** It shipped as a section below the transactions table, which renders up to 200 rows - so on any account with real history you scrolled past all of them to reach it, and if you did not already know the feature existed you never would. Reported as exactly that. The trigger now sits beside the rename control, where account-level actions already live, and carries the co-owner **count** rather than a bare icon: the header answers "is this shared, and with how many people" without opening anything, which a buried section could never do. `coOwners` is passed as `undefined` rather than `[]` for a non-owner, so the control is absent instead of being a button whose only outcome is an authorization error.

**A portfolio grant** (`PortfolioGrant`) is per **person** and grants **read** over everything the grantor owns - the "my partner sees my accounts but touches nothing" case. Managed in Settings, and never consulted by a mutation.

**H4 - removing a co-owner needs an explicit cleanup, because no FK cascade will ever fire.** The account survives, so the removed person's `AlertRule`s and `Goal`s pointing at it would simply keep existing against something they can no longer see - and an alert rule in that state is worse than dead: `checkCustomAlertRules` would still evaluate it and push them a notification quoting a balance they have no way to look at. `removeAccountCoOwner` deletes exactly their own rows for that account, in one transaction with the co-owner row itself; the account owner's own rules and the removed person's unrelated goals are untouched.

**The portfolio switcher (H6) changes what pages READ, never what actions may WRITE.** `getViewContext()` (`lib/auth-context.ts`) is the single entry point for a read surface and returns `{ viewer, ownerId, accountIds, readOnly }`. `ownerId` is the part that makes it correct rather than half-working: `accountIds` covers everything hanging off an account, but a page also reads entities owned by a *person* - categories, goals, the `UserSettings` row feeding analytics - and rendering the grantor's transactions against the viewer's own categories would show every row uncategorized, which reads as broken data rather than a permission boundary. Mutations never call this; they resolve their writable set from `getWritableContext`/`baseAccountIds`, which know nothing about the cookie.

The selection lives in a `viewing_portfolio` cookie, re-validated against a real `PortfolioGrant` on **every** read. A revoked or forged value falls back to the viewer's own portfolio in full read-write mode rather than erroring - a stale cookie is an everyday state (revoked while a tab sat open), not an attack to shout about. Verified live: with the grant deleted and the cookie still present, all of the grantor's data disappears on the very next request.

**Scope of the switcher, chosen rather than drifted into**: it covers `/` , `/accounts` (list + detail), `/analytics` and `/transactions` - the "see my partner's finances" surfaces. `/budgets`, `/income`, `/recurring` and `/settings` always show your own data; they're personal management surfaces, and a guest browsing someone's budget envelopes isn't the use case this was built for.

`readOnly` is threaded into the components that render mutation affordances (`RealEstateTab`/`LoanTab`/`AutomobileTab`, `AccountHeader`, `HoldingsTable`, `InvestmentFormsSection`, `TransactionsTable`, `TransactionCategoryCell`, and `canImportCsv` at the page level). This is **not** the access control - every one of those Server Actions guards ownership itself - it exists so a guest is never shown a button whose only possible outcome is an error. `TransactionCategoryCell` degrades to a static category chip, the same treatment `/budgets/[categoryId]` already gives split rows. The Settings backup section is likewise hidden for non-admins, matching the admin check the route itself gained in Lot B.

**Testing note**: probing rendered HTML for UI strings gives false positives - `NextIntlClientProvider` ships the entire messages JSON inside a `<script>` tag, so *every* label "appears" on *every* page. Assertions about what a guest can see must strip `<script>` blocks first and compare against markers that exist only in real data (an account name, a transaction label), never against a translated string.

**Local multi-user dev setup**: `SEED_MULTIUSER_PASSWORD=<8+ chars> pnpm run db:seed:multiuser`, on top of `db:seed:demo`. Additive (wipes nothing, idempotent) - creates a `member` account with its own two accounts, co-owns one of the owner's savings accounts, and grants the member read access to the owner's portfolio, so the switcher/co-owner panel/read-only mode can be exercised without hand-writing SQL. Deliberately **not** folded into `seed-demo.ts`: `docker-compose.demo.yml` runs the public demo with `AUTH_ENABLED=false`, where a second user has no login, no switcher and no user list - their accounts would be correctly invisible everywhere, which is confusing to seed and worse to debug. The demo stays single-user on purpose. The script refuses to run without the env var rather than shipping a default password.

**Accepted, documented constraints**: `.env` sync credentials (`LCL_LOGIN`/`TR_PHONE`) stay the owner's, so a second user cannot env-sync LCL or Trade Republic. **Corrected in v2.1 for Trade Republic specifically** - the "and since Woob has no Trade Republic module, a second user cannot sync Trade Republic at all" that used to follow here is no longer true: any user can now add their own from Settings, see "Per-user Trade Republic" below. LCL still has no per-user path of its own, but is reachable per-user through the generic Woob picker, so the remaining constraint is a redundant special case rather than a block on anyone. The *data* is unaffected either way: an env-synced account is co-ownable and grant-viewable exactly like a manual one. `sync/` needed **zero code changes for v2.0** - `Account.userId` and `SyncLog.userId` carry a permanent DB-level default of the owner precisely because `sync/db.py` INSERTs those two tables via raw SQL with explicit column lists that know nothing about the column. That default is scaffolding for the sidecar only: every app-side `create` passes `userId` explicitly, and `__tests__/institutions-actions.test.ts` asserts it does. **v2.1 made that "zero changes" claim false and it was not noticed until a user reported it** - once anyone could sync their own bank, relying on an owner-shaped default put a member's accounts on the admin. See "Per-user Trade Republic" below.

#### The friends-and-family path, exercised end to end (v2.10.5)

Before inviting real people onto a real instance, the whole member journey was
driven against a throwaway database rather than read: migrations replayed from
zero (no drift), an owner seeded with a deliberately distinctive account, then
a friend invited, redeemed, logged in and browsed. **10/10 in a real browser.**

What it establishes, and each half matters:

- **Isolation holds** - none of the owner's account name, transaction label or
  balance appears on `/`, `/accounts`, `/transactions`, `/analytics`,
  `/settings` or any `api/v1` route, checked against the hydrated DOM *and*
  against the raw HTML including the RSC payload, since data handed to a client
  component travels inside a `<script>` that a naive strip would hide.
- **And the app is not merely broken for them** - the control that makes the
  first half mean anything. The member's own account and transaction do appear,
  2 to 8 times per page. A leak test that only asserts absence passes equally
  well on an app that renders nothing.
- `GET` and `POST /api/backup` both answer `403` to a MEMBER, and Settings
  offers them neither that section nor user management.

**Re-run in full at the v2.10.6 tag, because the original predates everything
it now has to survive.** The walkthrough landed as commit 11 of that version
and the encryption, session revocation, persistent rate limiting, audit log and
CSP nonce are commits 12-19 - so the version that made the strongest security
claims had never had its isolation re-checked against the code making them.
Against a fresh database, migrations replayed from zero, no schema drift:
**0 owner markers across 8 pages** (hydrated DOM and RSC payload), positive
control on 7, `/api/backup` 403 on both verbs, a per-request CSP nonce that
changes between two requests with `'unsafe-inline'` genuinely gone from
`script-src` and zero console violations, and **a share link and an API key
minted before encryption still resolving on their original tokens** while the
stored ciphertext presented as a bearer token is refused. The invitation half
was re-run on its own (8/8): single-use enforced against a real second
redemption attempt, MEMBER role, empty portfolio, expired and used both
refused.

**Two lessons from doing it, both this version's recurring shape.** The first
attempt reported two invitation failures that were races in the *test* - it
waited on a load state rather than on the row appearing, and re-read a URL
Next could answer from its router cache; the fix is a fresh browser context per
navigation and waiting on the real effect. And the production build this all
ran against **failed** while reporting success, because `pnpm run build | tail -4`
discarded the exit code and a stray script at the repo root broke the
type-check. `set -o pipefail`, or read the code rather than the last four
lines.

**Two methodological traps were hit and are worth not repeating.** Searching
rendered HTML for UI strings said every invite token was valid, expired ones
included: `NextIntlClientProvider` ships the whole messages JSON inline, so
every label appears on every page - this file already warns about it and the
warning still had to be re-learned. Assert on a structural fact (a
`input[type=password]` count) or on a marker that exists in no translation.
And the settings `<h2>`s come out of the raw HTML in the wrong order, which
looks exactly like a broken page order: `app/settings/loading.tsx` creates a
Suspense boundary, so async sections stream late and React repositions them.
The rendered order is correct (tax 4th, appearance 16th). **Read the hydrated
DOM, never the wire format, for anything about what a person sees.**

#### Security audit (post-v2.0)

Ran as its own phase after the multi-user build, per `ROADMAP.md`'s sequencing. Findings below are split into what it **fixed** and what remains **open with a stated reason**. Everything was verified against a running instance, not read-only reasoning.

**Fixed by the audit:**

1. **The invitation flow was completely unreachable** (`proxy.ts`). `/invite/[token]` was not in the middleware's auth-exempt list, so on an `AUTH_ENABLED=true` instance every invitee was redirected to `/login` - a page they cannot get past, since not having an account is the entire premise. The multi-user build's own tests never caught it because they created users directly in the database. Fixed by exempting `invite(?:\/.*)?$` with the same anchoring as `api/v1` (verified: a valid token renders the form, a bogus one is a uniform `notFound()`, and `/invite999` still goes through auth). The redemption path itself was then confirmed end-to-end: single-use enforced, role `MEMBER`, empty portfolio, token consumed.

2. **Username enumeration by timing** (`lib/auth.ts`). `resolveUser` returned immediately for an unknown username but paid for a bcrypt comparison on a real one - **measured at a 64ms gap** over localhost, far above the noise floor. The rate limiter bounds how fast that can be probed but doesn't close it: a timing probe only needs a response, not a success. Fixed by comparing against `UNMATCHED_USER_HASH` (hashed from fresh random bytes at module load) on every non-matching path. Re-measured after the fix: −5ms, i.e. noise.

3. **Upstream error bodies forwarded to the client** (`app/api/gocardless/institutions/route.ts`). `String(e)` returned whatever GoCardless said - and `lib/services/gocardless.ts` builds its messages from that API's raw response body, including the auth-failure path. This repo already decided against that pattern for `pg_dump`/`psql` stderr (commit `1ae43c0`); this route was the one place it wasn't applied. Now logs server-side and returns a generic message.

**Verified sound, recorded so the next pass doesn't re-derive it:**

- **Role is never taken from the token.** `getViewer()` re-reads it from the database on every request, so `token.role` is decorative and a forged or stale one cannot escalate. `role` is written in exactly two places, both hardcoded (`bootstrapOwner` → ADMIN on the owner row only, `acceptInvitation` → MEMBER).
- **Cross-origin Server Actions are rejected by the framework** (confirmed live: same-origin resolves the action, cross-origin aborts with "Invalid Server Actions request" before it runs).
- **No raw SQL anywhere** in `lib/`/`app/` (no `$queryRawUnsafe`/`$executeRaw*`); `pg_dump`/`psql` are spawned with an argument array, never a shell string, and their connection string comes from `DATABASE_URL`, not user input.
- **No XSS sinks** (`dangerouslySetInnerHTML`/`innerHTML` appear nowhere).
- **Nothing logs a credential**; the backup route's own rule (swallow stderr, return a generic message) is upheld.
- **Every bearer-token route rejects an absent or wrong secret** (401 on all four), `/api/realtime/stream` correctly stays behind the session, and the H5 separation holds through **both** derived-artifact paths - a guest holding a live portfolio grant gets an empty response from their own API key *and* from a share link they minted.

**Still open, with reasons** - these are deliberate, not oversights:

1. **GoCardless callback has no CSRF/state binding.** `app/api/gocardless/callback/route.ts` recovers the institution from a `?ref=` query param the caller controls. Attribution comes from `institution.userId` rather than the session (the redirect legitimately arrives without a cookie), so it cannot mis-assign accounts to the wrong user - the H7 conflict check also refuses an account already connected by someone else. What remains unproven is whether a crafted callback can drive an *unwanted* import against an institution whose requisition id is already set. Starting a connection is now ownership-checked (`connect/route.ts`), which is the practical mitigation; a real `state` nonce round-tripped through the requisition would be the proper fix.

2. **Backup/restore is a full-instance takeover primitive.** `GET` dumps every user's data, `POST` replaces the entire database *including the `User` table* - so a restore can silently install arbitrary credentials. It is admin-gated (`requireAdmin`) and hidden from non-admins in Settings, which is proportionate for this app's model (admin ≈ shell access). **Confirmed by the audit**: hitting either verb directly as a MEMBER returns `403 {"error":"Admin access required."}`, and unauthenticated requests are redirected by the middleware before reaching the handler. Left open only in the sense that the primitive itself remains instance-wide by design.

3. **Plaintext credential inventory** - deliberate, per this repo's stated threat model (network exposure, not a compromised host), but it should be a conscious audit finding rather than a discovery: `UserSettings.smtpPassword`, `UserSettings.ntfyAuthToken`, `User.totpSecret`, `Institution.woobPassword`, `ShareLink.token`, `ApiKey.token`, `Invitation.token`. The multi-user change raises the stakes on the first two specifically, since one user reading another's row now means reading *someone else's* mail credentials - which is exactly why `getUserSettingsFor` was un-exported (see above). Re-run a check that no `"use server"` export takes a `userId` parameter.

4. **Rate limiting is per (IP, username), still in-memory.** `lib/auth.ts` was keyed by IP alone before v2.0; keying it by username too stops one account's failed attempts from locking out everyone behind the same NAT. It remains a single-process in-memory map (lost on restart, not shared across replicas) and there is no rate limit at all on invitation redemption or on the username-resolution path in `lib/actions/sharing.ts` - the latter returns a distinct "no such user" error, which is a deliberate usability call for an invitation-driven flow but is a username oracle.

5. **App-lock derives its WebAuthn user handle from the real user id** (`webAuthnUserId(viewer.id)`), replacing the pre-v2 hardcoded constant, and every ceremony plus `AppLockCredential` row is scoped by `userId`. **Confirmed by the audit**: the handle is a plain `TextEncoder` encoding of the user id, so it is deterministic and stable for a given user - a re-registration can't silently orphan an existing authenticator. Nothing open; recorded so the next pass doesn't re-derive it.

6. **`refreshAccountBalance` is an unguarded `"use server"` export.** Called server-to-server by the snapshot cron, which has no session. It is a pure recompute (derives an account's balance from that account's own holdings, writes nothing caller-controlled), so invoking it against another user's account can neither disclose nor corrupt anything - but it is directly invocable and worth a second opinion.

7. **Not verified under concurrency.** All isolation testing was sequential. Two simultaneous requests racing on co-ownership removal vs. an alert-rule write, or on invitation redemption, were not exercised. `acceptInvitation` consumes its token inside the same transaction as the user creation specifically to survive a double-open, which is the one race that was reasoned about.

### Encryption at rest, and what it does not cover (v2.10.6)

Prompted by a direct question before inviting real people onto a real instance:
*"j'ai pas envie de pouvoir récupérer le compte de mes utilisateurs simplement
en faisant une requête à la bdd"*. The answer at the time was that you could:
`SELECT "woobLogin", "woobPassword" FROM "Institution"` returned every invited
user's bank credentials in clear text.

**The audit had found it and accepted it, which is the part worth studying.**
It is finding 3 under "Still open, with reasons" below - listed, named, and
waved through on a threat model written when the app was single-user, where
"the host owner can read everything" meant "you can read your own data".
Multi-user changed what that sentence means and nobody re-derived it, so the
same words came to say "you can read your invited users' bank passwords". The
audit even noticed the stakes had risen, named `smtpPassword`/`ntfyAuthToken`
specifically, and concluded the fix was un-exporting `getUserSettingsFor` -
closing the app-level path and leaving the database-level one wide open.
`Institution.trPin` was not in the inventory at all: v2.1 added it afterwards
and nothing re-ran the list. **An accepted finding needs its acceptance
re-derived whenever the architecture moves, not carried forward as prose.**

**What is encrypted** (`lib/domain/crypto-at-rest.ts`, mirrored in
`sync/crypto_at_rest.py`): `Institution.woobLogin`/`woobPassword`/`trPhone`/
`trPin`, `User.totpSecret`, `UserSettings.smtpPassword`/`ntfyAuthToken`, and
the three bearer tokens (`ShareLink`, `ApiKey`, `Invitation`). AES-256-GCM,
random 12-byte IV, `enc:v1:<iv>:<ciphertext+tag>`.

**What is NOT, and why it is not a gap to close.** Account names, balances and
transaction labels stay readable. The app sums and groups them in SQL - 15
aggregations across 4 files, plus filters and ordering in 5 more - and
`/api/alerts/check` computes each user's net worth at 4am with nobody logged
in. Encrypting them means loading every transaction into Node per render and
ending unattended alerting outright. Worth stating plainly when someone asks
for "everything encrypted": the request is reasonable and the answer is that it
would be a different application.

**And the honest ceiling.** The key lives in the environment, on the same
machine, because the sync sidecar logs into a real bank at 4am with nobody
present. Anything the server can do, whoever holds the server can do. This
protects a leaked backup, a stolen disk, a dump shared by mistake, and anyone
reaching the database without the environment. It does not protect a user from
the person running their instance, and no amount of further encryption would
while unattended sync exists.

**The prefix is load-bearing.** A read that finds no `enc:v1:` returns the
value untouched, which is what lets an instance keep working mid-migration and
makes re-running the backfill a no-op. A wrong key RAISES rather than returning
null - null would reach `sync_woob.py` as "this institution has no password
configured" and the bank would silently stop syncing, which is the failure
shape this file keeps recording.

**The key is `ENCRYPTION_KEY`, or derived from `NEXTAUTH_SECRET` by HKDF when
that is unset.** The fallback is what keeps this from being a new mandatory
variable that breaks every existing instance on upgrade. HKDF rather than the
raw secret, so a leak of the session-signing key is not also a leak of every
credential. **The cost, which `.env.example` states**: rotating
`NEXTAUTH_SECRET` then makes every stored credential unreadable.

**Two languages must agree byte for byte**, and that is the real risk here: a
format mismatch fails at 3am against a real bank, not at build time. Both
directions are tested against values produced by the OTHER runtime rather than
against a copied literal, and the tests were confirmed to watch it - diverging
the HKDF info, the IV size or the prefix fails 1, 2 and 3 of them.

**The backfill runs at startup** (`instrumentation.ts`), not from a script.
"Deploy, then remember to run this" is a migration that eventually does not get
run, and until it does the credentials are still in clear in every backup. It
is also what caught a real mistake: the manual command first documented used
`tsx`, a devDependency the production image installs with `--prod` and
therefore does not have - it could never have run on a real deployment.
Non-fatal on error, deliberately: an unencrypted value reads back fine, so
refusing to boot would turn "no better protected than yesterday" into "your
instance is down".

**The three tokens needed a second column.** They are looked up BY value and a
random IV means the ciphertext differs every time, so `tokenHash` (SHA-256)
carries the lookup while the ciphertext stays reversible for a UI that shows
both again rather than once. A plain digest rather than bcrypt: 256 random bits
have no dictionary to slow anyone down against, and a per-row salt would defeat
the single-query lookup the column exists for.

**The backup FILE has its own, optional, passphrase encryption**
(`lib/domain/backup-encryption.ts`) - see "Backup & restore" below. It is the
one artefact that leaves the machine, so it is the one place the financial data
CAN be protected without touching a query.

### Security hardening (v2.10.6)

Four things, three of which the post-v2.0 audit left open.

**Sessions can be ended without deleting the account.** A 30-day JWT cannot be
recalled, so until now the only way to stop one was `deleteUser`, which
cascades the whole portfolio: "my phone was stolen" had no answer that did not
also destroy years of transactions. `User.sessionsRevokedAt` is compared
against the token's ISSUE time in `getViewer`, on the query it already makes.
Changing a password revokes too, or the change protects nothing for a month. A
token predating the feature counts as revoked rather than trusted - honouring
an unstampable token would make revocation a no-op for exactly the sessions it
aims at.

**The rate limiter counts in a table** (`lib/services/rate-limit.ts`). The
in-memory map reset on every restart, which the audit noted and accepted; on an
internet-exposed instance that is a hole rather than a footnote, since
`restart: unless-stopped` makes a crash loop cheap to cause. Extended to
invitation redemption, which had none. **Fails OPEN on a database error**,
deliberately: failing closed turns a blip into a total lockout including the
admin who would fix it, and the path it guards still needs a correct password.

**An audit log** (`lib/services/audit-log.ts`), because everything else in this
app prevents actions and nothing recorded them - a compromise left no trace.
`actorId` is NOT a foreign key on purpose: deleting a user must not erase what
they did, which is when the log matters most. Writes never break the action they
describe, which does mean an attacker who can make writes fail can make them
silent; stated rather than discovered. The UI shows the raw dotted action key,
never a translated sentence - these are compared across versions and searched
for, and a localised label makes a log unreadable to anyone helping from
outside.

**`script-src` carries a per-request nonce** instead of `'unsafe-inline'`. Once
a nonce is present browsers IGNORE `'unsafe-inline'` in that directive, so this
removes the blanket permission rather than adding an allowance. `style-src`
keeps it as a stated gap: a missed style nonce renders the app unstyled rather
than inert, and injected CSS is a far smaller prize. No `'strict-dynamic'` - it
would make supporting browsers ignore the Google host entries a bank's
reCAPTCHA needs.

**And the delicate part had a cost nobody found until a user did (v2.11.1).**
Routing the auth decision through a wrapper - so a permitted request could be
re-issued carrying the nonce - asked `authResult instanceof NextResponse` to
tell a refusal from a permission. **next-auth bundles its own copy of
`next/server`**, so the `NextResponse` it constructs is a different class
object, `instanceof` answered **false** for a genuine `307` to `/login`, the
code fell through to `NextResponse.next()`, and the refusal became an
authorisation. From v2.10.6 to v2.11.0 every authenticated page rendered for a
request carrying no session at all.

`getViewer()`'s owner fallback is what made that a data leak rather than an
empty page: it is reachable exactly when there is no session, which is the case
it exists for. With the gate open, "no session" stopped meaning "an anonymous
visitor on /login" and started meaning "the instance owner, role ADMIN".

**What found it was a probe, not a reading.** The logged line was
`ctor=NextResponse isNextResponse=false status=307 location=/login` - the
constructor name was right and the identity check was still wrong, which is not
something reading the code suggests. `isAuthDenial` duck-types on what the
response SAYS instead, and `__tests__/proxy-auth-denial.test.ts` builds its
refusal from a deliberately FOREIGN class: a test using the real `NextResponse`
passes against the broken code, which is why the obvious test would have been
worthless. **An `instanceof` against a class that crosses a package boundary is
a coin flip; ask the object what it is, not who made it.**

**The delicate part was the matcher, not the nonce.** The CSP has to reach
`/shared` and `/invite`, which the auth matcher deliberately skips - so those
two had no CSP at all. The exemption list moved out of `config.matcher` into a
tested `isAuthGated`, same alternatives, now one per line so each anchor is
visible rather than buried in a 300-character lookahead. All 27 existing
assertions still pass unchanged.

**`refreshAccountBalance` moved to a plain module** (`lib/services/account-
balance.ts`). It was exported from a `"use server"` file and therefore remotely
invocable - finding 6, left open because it cannot be ownership-guarded (the
cron calls it with no session). Taking it off the remote surface is the fix
that needed no guard, the same move `autoCategorizeTransactions` made.

**Two defects found by driving it rather than reading it.** The revoked-session
screen said "this account no longer exists", which is false and alarming for
somebody who just clicked "sign out everywhere". And the two-factor gate
blocked `/settings` too, so a user told to go and set up TOTP was sent
somewhere the gate would not let them go - a dead end whose own code comment
claimed the opposite of what the code did.

### Authentication

**Disabled by default** (`AUTH_ENABLED` unset or anything other than `"true"`). Self-hosted = private network, network-level trust is sufficient.

Enabled via `AUTH_ENABLED=true` + `AUTH_PASSWORD` (plaintext) or `AUTH_PASSWORD_HASH` (bcrypt). When enabled: NextAuth Credentials provider, JWT session 30d, rate-limit 5 attempts/15min/IP. Display name via `AUTH_USER_NAME` (defaults to `"owner"`).

**Every expected TOTP failure is returned, never thrown** (`lib/actions/totp.ts`'s `TotpFailure`). Next replaces a thrown Server Action error with an opaque digest in production, so "Invalid code" reached the user in development and nothing at all once deployed - which is how a report of "2FA does not work at all" arrived with no way to tell a wrong code from a broken flow. The flow itself was verified end to end against a real database at the time (QR, secret, live code, eight backup codes, `totpEnabled` set), so what was broken was the reporting, not the feature. Failures carry stable keys (`invalid_code`/`not_enabled`/`no_pending_setup`) rather than sentences, so the UI translates them. Same treatment as `lib/actions/sync.ts`; worth applying to any other action whose message is meant for a human.

**Read `totpEnabled` from `User`, never from `UserSettings`.** v2.0 moved TOTP onto `User` and left the old column behind as vestigial, but `app/settings/page.tsx` kept reading `userSettings.totpEnabled` - which nothing writes any more, so it is permanently `false`. Enabling 2FA therefore worked (login asked for the code, because `authorize()` reads `User`) while Settings showed "Désactivée" forever. Reported from a real instance, and the only read site that was missed; a vestigial column is fine to leave in place but every reader of it has to move at the same time.

**The login form's code step REPLACES the credential step**, and only appears when the server says so. Two earlier attempts were wrong in different ways: the first revealed a third field below the other two (not how any app people already use asks for a second factor), the second replaced them correctly but decided *whether* to ask from a `totpEnabled` prop fetched for the **instance owner** before anyone had typed a username - so on a multi-user instance a member without 2FA was asked for a code that does not exist.

`authorize()` now throws `TOTP_REQUIRED` (`lib/domain/auth-constants.ts`) once the password is verified and the account still needs a code; NextAuth v4 turns a thrown authorize error into `?error=<message>`, which `signIn(..., { redirect: false })` returns as `result.error`. **Not a username oracle**: it is only reachable with a correct password, so it tells someone holding valid credentials what they are about to find out anyway, and everyone else nothing - a wrong password still returns null, indistinguishable from an unknown account. Verified against a production build: no 2FA signs straight in with no code screen, a wrong password never reveals one, and a correct password moves to the code alone.

The constant lives in `lib/domain/auth-constants.ts` rather than `lib/auth.ts` because that module pulls in Prisma and bcrypt, so a client component cannot import from it - and a string two sides must agree on should not be written twice.

**Optional TOTP 2FA** on top of the password, toggled from Settings (`components/settings/two-factor-section.tsx` + `lib/actions/totp.ts`), never via env var - state lives on `User` (`totpEnabled`, `totpSecret`, `totpBackupCodes`), one row per user since v2.0. The identically-named `UserSettings` columns are vestigial and nothing writes them; reading those instead is a real bug this repo has already shipped once (see "Read `totpEnabled` from `User`" above). `lib/domain/totp.ts` holds the pure crypto (secret/URI generation via `otplib`, `verifyTotpCode` with 30s clock-drift tolerance, bcrypt-hashed one-time backup codes). `lib/auth.ts`'s `authorize()` checks `totpEnabled` after the password succeeds and accepts either a live 6-digit code or a backup code (consuming it from `totpBackupCodes` on use) - `components/auth/login-form.tsx` switches to the code step only when `authorize()` throws `TOTP_REQUIRED` (see "The login form's code step REPLACES the credential step" above) - the old server-fetched `totpEnabled` prop is gone. `regenerateBackupCodes`/`disableTotp` require a **live** TOTP code, never a backup code, so a single backup code can't mint itself replacements or turn off 2FA outright.

`proxy.ts` is the Next.js middleware (at the repo root). It reads `process.env.AUTH_ENABLED` in the `authorized` callback and bypasses NextAuth when it isn't `"true"`. If the upstream `proxy.ts` ever diverges, do **not** blindly overwrite this file.

`components/layout/sidebar-wrapper.tsx` is a **server component** (no `"use client"`) - reads `AUTH_ENABLED`, passes `showLogout` prop to `sidebar-dynamic.tsx`.
`components/layout/sidebar-dynamic.tsx` is a **client component** (`"use client"`) - handles `dynamic({ ssr: false })` (required to be in a client component in Next.js 16). This file does not exist in the upstream repo.
Both files are selfhosted-specific and must never be overwritten by the sync script.

For users who want security without built-in auth: document Nginx Proxy Manager, Caddy basicauth, Traefik + Authelia, Cloudflare Access, or VPN (Tailscale).

### App-lock (WebAuthn)

Settings → "Verrouillage de l'appli" (`components/settings/app-lock-section.tsx` + `lib/actions/app-lock.ts`, `@simplewebauthn/server`/`@simplewebauthn/browser`) - a fast local unlock for an already-installed, already-trusted PWA via the device's own biometric/PIN authenticator, matching what Finary/Trade Republic's native apps offer. **Deliberately independent of `AUTH_ENABLED`** (same precedent as read-only share links below) - the primary use case is a private-network instance with `AUTH_ENABLED` off, where a quick device-local unlock is still wanted without standing up a full password login.

**Not a network/security boundary the way `AUTH_ENABLED`'s server-side NextAuth session is.** `components/layout/app-lock-gate.tsx` (mounted in `app/layout.tsx`, wrapping the sidebar + `<main>`) is a client-side overlay: Next has no server-side concept of "this browser tab is currently locked", so the real page content is still server-rendered and sent in the initial RSC payload regardless of lock state - the gate only hides it behind a full-screen overlay until a WebAuthn ceremony succeeds. This is an intentional, proportionate match to what was actually asked for, not an oversight - Trade Republic's own app-lock works identically (a local UI gate in front of data the app already has cached, not a re-fetch-behind-auth boundary). It protects against "someone picks up my unlocked phone and opens the installed PWA", not network interception (the reverse proxy/TLS's job, see "Security headers" above) or local devtools access (which could clear the unlock state directly, the same way it could defeat a native app's lock screen only with more effort). Unlock state lives in `sessionStorage` (re-locks when the browser/PWA is fully closed and reopened), not a cookie - the point is a per-open unlock, not a second login session.

**Data model**: `AppLockCredential` - one row per registered authenticator (a device's Touch ID/Windows Hello/Android biometric gets its own key pair), so a user with the PWA installed on both a phone and a laptop registers two independently-revocable rows. `credentialId`/`publicKey`/`counter` are the standard WebAuthn verification triple (COSE public key + signature counter for replay detection) - `publicKey` is never a secret to protect the way `totpSecret` is, it can't authenticate on its own without the matching private key that never leaves the device's secure hardware. `UserSettings.appLockEnabled` gates whether the gate ever shows the lock screen at all; `appLockChallenge` is transient per-ceremony state (registration or authentication, never both at once for a single-user app) - same single-reusable-slot, safe-to-overwrite-an-abandoned-attempt trust model `totpSecret` already has during TOTP setup. Removing the last registered credential (`removeAppLockCredential`) auto-disables app-lock in the same transaction - a device-less "enabled" state would leave the lock screen with nothing to authenticate against, an unrecoverable dead end short of shell access to the DB (the same recovery story `totpSecret`/`AUTH_PASSWORD` already document).

**The lock is per device, not per account** (fixed after a real report). `User.appLockEnabled` is one flag, but an `AppLockCredential` belongs to a single device, and gating the lock screen on the flag alone was a dead end: enabling app-lock on a laptop locked the phone too, the phone had no credential to unlock with, and Settings - where it would register one - sits behind that very lock. `lib/domain/app-lock-device.ts` keeps a per-user localStorage marker set at registration; `AppLockGate` locks only a browser that carries it, so an unregistered device is simply not locked and can reach Settings to register itself. The marker is a plain localStorage flag rather than anything the server vouches for, which adds no weakness that was not already stated: the unlock state it guards already lives in `sessionStorage`, clearable by the same devtools. As a safety valve, a failed ceremony on a device that *is* marked offers to register it again, for the case where its credential was revoked elsewhere or its authenticator reset.

**The lock screen asks for the biometric on mount**, one attempt per mount, failing quietly so a browser that refuses a ceremony without a user gesture leaves the button waiting rather than a red message nobody asked for. An earlier version deliberately waited for a tap, reasoning that an unprompted native dialog is jarring; in practice the extra tap is the jarring part, since the lock screen has no other purpose, and every native app-lock people compare it to opens Face ID on launch.

**No `excludeCredentials`, deliberately.** Its only job was stopping the same authenticator being registered twice, which costs a duplicate row the user can see and delete. What it cost instead was a registration that never completed: the list carries no `transports` (they are not stored), so a browser cannot tell whether an excluded credential is local or on another device and has to go and find out - and on a machine with a phone already registered, that is where a second device stopped. Reported twice, and **not reproducible here even against a production build with a second virtual authenticator** (1.1s both times). A visible duplicate is a far better failure than a spinner that never ends.

**App-lock's own failures are returned, not thrown** (`AppLockFailure`). This is the surface where the redaction hurt most: the lock screen's entire job is explaining why it will not let you in, and every one of its messages - unknown device, unlock refused, no pending ceremony - reached the developer console and never the screen. Keys, translated by both consumers.

**The registration hang was a browser extension**, reported back by the user after the fact: an ad blocker (or similar) was suppressing the Windows Hello dialog, so the ceremony never completed and nothing in this codebase could have fixed it. Worth recording because two releases were spent looking for it server-side, and because the `withTimeout` floor below is exactly what makes that class of cause visible instead of presenting as a dead spinner.

**The unlock re-locks after two minutes in the background** (`RELOCK_AFTER_MS`). Before this the unlock lasted the whole browser session, and an installed PWA is resumed far more often than it is cold-started - so in practice it almost never asked again, which makes the lock decorative. Measured on `visibilitychange` rather than a timer, so a tab the browser throttles still locks correctly.

**Every step of the registration flow is wrapped in `withTimeout`** (`lib/utils/with-timeout.ts`), 20s for the two Server Actions and 120s for the browser ceremony, each with its own message. This is not a fix for the hang - the cause is still unproven - it is a floor under it: a stall now names the step it stalled on and leaves the dialog usable, instead of forcing a full page reload. Deliberately does not cancel the underlying work, since a Server Action cannot be aborted and a ceremony belongs to the browser; a late result is ignored.

**Registration pins `authenticatorAttachment: "platform"`.** App-lock is the device's own biometric, not a portable passkey, and leaving the attachment unset let Chrome offer the cross-device options too (a phone by QR, a security key). With a phone already registered, a second device sat on that chooser instead of going to Windows Hello - reported as "registering a second device spins forever". Pinning it also makes `excludeCredentials` resolve without probing, since another device's platform credential cannot be present locally. **Honest limit**: this was not reproduced. A CDP virtual authenticator registers a second device successfully with *or* without the pin, so that test does not discriminate - the reasoning is sound and the setting is right for the feature either way, but the fix is unverified against the real failure. An explicit `timeout` was added alongside as a floor, so an abandoned ceremony fails visibly rather than spinning.

**RP ID/origin derivation** (`getRpConfig()` in `lib/actions/app-lock.ts`) - WebAuthn requires the `rpID`/origin passed to `generateRegistrationOptions`/`verifyRegistrationResponse` etc. to exactly match the domain the browser actually used, or every ceremony fails. Reuses `APP_URL` when set (same "the app's public URL when behind a reverse proxy" config GoCardless's OAuth callback already reads), otherwise derives it from the incoming request's `host`/`x-forwarded-proto` headers - same fallback shape as `app/api/gocardless/connect/route.ts`'s own `process.env.APP_URL ?? \`${req.nextUrl.protocol}//${req.nextUrl.host}\`` , just read via `next/headers`' `headers()` since a Server Action has no `req` object to read directly. This is also why app-lock only actually works over HTTPS or `localhost` specifically - WebAuthn requires a secure context by spec, and a bare LAN IP over plain HTTP (this app's own documented default access pattern, see "Security headers" above) is not one; `components/settings/app-lock-section.tsx` and the lock screen itself both feature-detect via `@simplewebauthn/browser`'s `browserSupportsWebAuthn()` and show a clear "not available" message rather than a silent failure when it isn't.

The WebAuthn user handle is `webAuthnUserId(viewer.id)` (`lib/actions/app-lock.ts`), a plain `TextEncoder` encoding of the real user id - deterministic and stable per user, so re-registering can't orphan an existing credential. It replaced a hardcoded `USER_ID` constant in v2.0: WebAuthn uses this handle to namespace resident keys and dedupe registrations for "the same user" on one authenticator, which a fixed constant satisfied only while the app had exactly one.

### Read-only share links

Settings → "Liens de partage" (`components/settings/share-links-section.tsx` +
`lib/actions/share-links.ts`) generates a `/shared/[token]` URL that renders
the net-worth dashboard read-only, to hand to an advisor or family member
without giving them write access - or the app password at all. This is
**deliberately independent of `AUTH_ENABLED`**: the primary use case is
exposing one view externally (e.g. via a reverse proxy) while `AUTH_ENABLED`
stays off for the trusted private network, matching "Authentication" above's
default trust model. `ShareLink` (`prisma/schema.prisma`) stores the token in
**plaintext** - same trust model as `UserSettings.totpSecret`/
`Institution.woobPassword` (the DB isn't hardened against server compromise,
so hashing this one field buys little), and unlike TOTP backup codes it needs
to be re-copyable later, not shown once. Unguessability comes from entropy
instead: `lib/domain/share-links.ts`'s `generateShareToken()` is 256 random
bits (`randomBytes(32).toString("base64url")`) - no rate limiting needed,
unlike the login password (low-entropy, human-memorable, why that path has
one).

**Bare routes** (`lib/domain/bare-routes.ts`) - `/login`, `/invite/*` and
`/shared/*` render without the app shell, and the predicate is shared by the
three client components that need it: the sidebar's null return, `MainContent`'s
padding (both the mobile-nav clearance and the page gutter, neither of which
means anything with no nav rendered), and `AutoSync`'s own guard. The last is
the one that matters beyond looks: `AutoSync` already skipped `/shared/*` so an
anonymous visitor could not trigger a real bank sync by opening a page, and the
login screen needed exactly the same treatment for exactly the same reason - it
was firing a sync, and showing the "Synchronisation en cours" badge, to someone
who had not authenticated. Found by screenshotting the page rather than reading
it. The sidebar is `dynamic({ ssr: false })`, so its absence cannot be checked
in server HTML at all; a curl-based assertion passes whether or not the fix
works.

`proxy.ts`'s middleware `matcher` excludes `shared` from ever reaching
`withAuth`, the same category as `api/auth`/`api/health` - the token lookup
inside `app/shared/[token]/page.tsx` is the page's own, independent gate
(`notFound()` uniformly for "doesn't exist" and "expired", no signal to an
anonymous visitor about which). That page sets `robots: { index: false,
follow: false }` since the URL may be reachable from the public internet.

The dashboard's JSX was extracted into `components/dashboard/dashboard-view.tsx`
(a pure presentational component, `interactive` prop) so `app/page.tsx` and
`app/shared/[token]/page.tsx` can't drift out of sync while rendering the same
data two different ways - the only interactive element either page has is the
per-account `Link` into `/accounts/[id]`, which the shared route must never
expose. Beyond that, isolating a share-link visitor from the real app is
handled inside the two client components that already call `usePathname()`
for their own reasons, rather than a route-group restructure: `sidebar.tsx`
returns `null` on `/shared/*` (no nav back into the editable app), and
`auto-sync.tsx` skips calling `autoTriggerSync()` there (an anonymous visitor
must never trigger a real bank sync just by opening the page - the one actual
correctness bug a naive version of this feature would have shipped with).

**Never call `date.toLocaleDateString()` with no locale in a client component.** It resolves the locale from the runtime, which is `en-US` in the Node container and the user's own in the browser, so a server-rendered `8/31/2026` re-renders as `31/08/2026` and React throws a text-mismatch hydration error (#418) on every load. Reported from a real instance; the Settings page alone had eleven such calls across five components. `formatDateShort(date, intlLocale)` in `lib/utils/format.ts` is the one way to format a date in a client component, with the locale from `localeToIntl(useLocale())` - which comes from `NextIntlClientProvider` and is therefore identical on both sides by construction. Confirmed after the fix: the server now emits French-formatted dates and a `fr-FR` browser logs zero hydration errors.

### Security headers

Set via `next.config.ts`'s `headers()` - CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and `poweredByHeader: false`. The CSP's `img-src` allows `google.com` **and** `*.gstatic.com` - `lib/domain/institutions.ts`'s favicon URLs are requested from `google.com/s2/favicons` but that endpoint actually serves the image via a redirect to `*.gstatic.com`, which only showed up testing with a real browser (Playwright), not by reading the URL. **Superseded in v2.10.6**: the CSP is now built per request by `buildContentSecurityPolicy(nonce)` (`lib/domain/content-security-policy.ts`) and set from `proxy.ts`. `script-src` carries a nonce instead of `'unsafe-inline'`; only `style-src` keeps `'unsafe-inline'` (see "Security hardening (v2.10.6)" above).

**No `Strict-Transport-Security` header, deliberately.** This app is routinely reached over plain HTTP on a private LAN/VPN (see "Authentication" above - `AUTH_ENABLED` defaults to off because network-level trust is the expected setup). HSTS is browser-cached and self-reinforcing: a browser that ever received it over plain HTTP would refuse all future plain-HTTP connections to that host until manually cleared. Reverse proxies that terminate real TLS (Nginx Proxy Manager, Caddy, Traefik) should set HSTS themselves at that layer, where "this connection is actually HTTPS" is actually true.

### Public REST API

Read-only, versioned under `app/api/v1/` (`GET /net-worth`, `/net-worth/history`, `/accounts`, `/transactions`) - for external tools (Home Assistant, a custom dashboard/widget) that want programmatic access without giving them the app password or a NextAuth session. Every route reuses `computeDashboard()` (or, for transactions, the exact same `isInternalTransfer: false` query the read-only share view's transactions section already uses) rather than a separate derivation - the API must never disagree with what the dashboard/share view themselves show for the same data. `DashboardHistoryPoint` gained an `isoDate` field (`lib/domain/dashboard.ts`) specifically for the history endpoint - the existing `date` field is locale-formatted for UI display ("20 août"), not something a JSON API consumer can parse; `isoDate` is computed from the exact same `historyRaw` entry as `date`, not a second lookup, so the two can never disagree on which day a point belongs to.

**Scope deliberately stops at these four endpoints** - transactions/budgets/holdings/analytics were considered and rejected for v1 after weighing it directly: the stated use cases (a Home Assistant sensor, a dashboard widget) are all "glanceable summary" consumers, and the marginal usefulness of exposing full budget/holdings/analytics detail for that use case is small next to the marginal *risk* - a leaked API key exposing "net worth + accounts + recent transaction labels" is bad, but a leaked key additionally exposing full spending-category breakdowns, dividend income, and investment performance is a materially bigger blast radius for a use case that doesn't actually need it (nobody puts their full transaction ledger in a home-dashboard tile). Same "demand-driven" reasoning already applied to Interactive Brokers/Plaid in `ROADMAP.md` - more endpoints are additive and can follow the same pattern if real usage asks for them, not built speculatively now.

**Auth**: a dedicated `ApiKey` model (Settings → API - `components/settings/api-keys-section.tsx`, mirroring `share-links-section.tsx`'s create/list/revoke shape closely), never the shared `NEXTAUTH_SECRET` bearer token `app/api/alerts/check/route.ts` uses for the sync→app call - that secret must stay strictly internal (leaking it is session-forgery-level), whereas an API key is meant to be handed to a third-party tool and individually revocable without killing every logged-in session. `lib/services/api-auth.ts`'s `authenticateApiKey()` is the shared gate every `app/api/v1/*` route calls itself (`Authorization: Bearer <token>` looked up against `ApiKey.token`) - `token` is plaintext, same trust model as `ShareLink.token`/`UserSettings.totpSecret`/`Institution.woobPassword` (see "Read-only share links" above for why hashing this one field buys little against this app's actual threat model), and stays re-copyable in the UI rather than a GitHub-style "shown once" ceremony, again matching `ShareLink`'s own precedent exactly. `generateApiKeyToken()` (`lib/domain/api-keys.ts`) prefixes the 256-bit random token with `fnlb_` - purely cosmetic recognizability, plays no role in validation.

`proxy.ts`'s matcher excludes `api/v1` from the NextAuth check (same category as `api/alerts`/`api/transactions` - an external tool has no browser session to present) using `api\/v1(?:\/.*)?$`, not a bare `api/v1` alternative - the `(?:\/.*)?$` shape matches `/api/v1` and every real subpath (`/api/v1/net-worth`) while still rejecting a bare-prefix collision like `/api/v1999`, applying the same anchoring lesson the PWA routes above already needed (confirmed live the same way: an unanchored version let a nonexistent path bypass auth).
