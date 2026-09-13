# Security Policy

## Supported versions

Only the latest release of Finalibaba Self-Hosted is actively maintained.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting instead:
👉 **[Report a vulnerability](https://github.com/LoicSERRE/finalibaba-selfhosted/security/advisories/new)**

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (or a proof-of-concept)
- Affected version(s)

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days for confirmed issues.

## Scope

Issues in scope:
- Authentication bypass when `AUTH_ENABLED=true`
- **Cross-user data access on a multi-user instance** - any way for one user to read or modify another's accounts, transactions, categories, goals, alert rules, settings or notification credentials. This includes calling a Server Action or API route directly with another user's ids rather than going through the UI
- **Privilege escalation** - a non-admin reaching an admin-only surface (user management, database backup/restore), or a read-only guest performing a write on a portfolio shared with them
- **Access outliving its grant** - a share link, API key or notification that keeps exposing data after the co-ownership or portfolio share it came from was revoked
- SQL injection or data exfiltration via the Next.js app or sync service
- Secrets exposure (env vars, credentials) in API responses or logs
- Container escape or privilege escalation in the Docker setup

Out of scope:
- Vulnerabilities requiring physical access to the host
- Issues in upstream dependencies not specific to this project
- The sync service HTTP API is intentionally internal (Docker network only, never expose port 8000 publicly)

## Security design notes

- The sync service (`sync/`) listens on port 8000 **inside the Docker network only**. Never expose it externally.
- `AUTH_ENABLED` is `false` by default - intended for trusted private networks. Enable it or place the app behind a VPN / reverse proxy with auth for any internet-exposed deployment.
- All secrets live in `.env` - never commit it.

### Multi-user boundaries (v2.0)

Multi-user only exists when `AUTH_ENABLED=true`. With it off there is exactly one implicit user and none of the boundaries below are reachable.

- **Enforcement lives in Server Actions and page queries, not in middleware.** Every user legitimately writes to their own data, so a blanket role check at the edge would be the wrong shape. Each mutating action resolves the caller from the session and verifies ownership itself; hiding a button is never treated as an access control.
- **Two distinct account sets.** The set used for *derived artifacts* - share links, API key responses, alert evaluation, exports - is strictly "accounts you own or co-own". A portfolio merely shared with you for reading is never in it, so a guest cannot mint a public link or an API key over someone else's data that would outlive the share.
- **Read-only means read-only server-side.** The portfolio switcher changes what pages read; it can never widen what an action may write. Its selection is a cookie, re-validated against a real share on every request, and a revoked or forged value falls back to your own data.
- **Not found vs. not yours are indistinguishable.** Ownership guards return an identical error for a missing row and for another user's row, so ids cannot be enumerated.
- **Database backup/restore is admin-only** and covers the whole instance, every user included. Treat admin on a multi-user instance as equivalent to shell access to the database.
- **Turning `AUTH_ENABLED` off on an instance that already has several users makes every visitor the instance owner.** There is no login to fail, so the app resolves anyone reaching it to the owner account - including its admin rights (whole-instance backup and restore, deleting users). The other users' portfolios are not exposed by this (they belong to different accounts, and nobody can authenticate as them any more) but they do become unreachable, and the owner's own data becomes readable by anyone on the network. That is the documented meaning of `AUTH_ENABLED=false`; it is called out here because the intuition "turning off login just hides the login screen" is wrong once more than one account exists.
- **Sessions can be ended without deleting the account** (Settings -> Security -> "sign out everywhere", or an admin acting on another user). A 30-day JWT cannot be recalled, so before v2.10.6 the only way to stop one was to delete the account, which cascades its whole portfolio.
- **Attempt limits survive a restart** (a table, not an in-memory map) and cover invitation redemption as well as login. They fail OPEN if the database is unreachable: failing closed would turn a blip into a total lockout, the admin who would fix it included.
- **An activity log** records logins, invitations, backup downloads and restores, bank configuration, user deletion and session revocation. An admin sees the instance; everyone else sees their own events. Writes never break the action they describe, so an attacker able to make writes fail can make them silent.
- **`script-src` uses a per-request nonce** rather than `'unsafe-inline'`. `style-src` still carries it, deliberately: a missed style nonce renders the app unstyled rather than inert, and injected CSS is a far smaller prize than injected script.
- **An admin can require TOTP for every user** on the instance. Off by default, so upgrading never locks anyone out.
- **The backup file can be passphrase-encrypted** on download, which is the only place the financial data itself is protected - it is the one artefact that leaves the machine. Forget the passphrase and the file is unrecoverable; nobody can help.
- **Credentials are encrypted at rest since v2.10.6; the financial data is not.** Bank logins and passwords, Trade Republic PINs, TOTP secrets, the SMTP password, the ntfy token, and the share-link / API-key / invitation tokens are AES-256-GCM with a key from `ENCRYPTION_KEY` (or derived from `NEXTAUTH_SECRET`). Account names, balances and transactions stay readable: the app sums and groups them in SQL, so encrypting them ends `/budgets`, net worth, and the alert checks that run at 4am with nobody logged in.

  This earlier sentence was here until v2.10.6 and is worth keeping visible, because the reasoning was wrong in a way that is easy to repeat: *"the threat model this app defends against is network exposure, not a compromised host. Encrypting those fields against an attacker who already has the database and the application key would buy very little."* That was written when the app was single-user, where "the host owner can read everything" meant "you can read your own data". Multi-user changed what the sentence means without anyone re-deriving it - the same words now say "you can read your invited users' bank passwords".

- **What the encryption does and does not do.** It protects a leaked backup, a stolen disk, a dump shared by mistake, and anyone reaching the database without the server's environment. It does NOT protect against whoever runs the instance: an unattended sync logs into a real bank with nobody present, so the server decrypts on its own, and anything it can do its operator can do. A key held only by the user would change that and would end unattended sync, alerting and server-side aggregation - a different application, not a setting.

- **Running an instance for people who are not you is a different proposition from self-hosting.** The operator can read every user's balances and transactions, which is structural rather than a gap to patch. Beyond the technical question, account aggregation offered to third parties is a regulated activity in the EU (PSD2 account information services), the operator becomes a GDPR controller for other people's financial data, and a user handing their bank credentials to a third party is usually in breach of their own bank's terms - which can matter to them if fraud is ever disputed. None of that is advice; it is the list of things to settle before opening an instance to anyone beyond the household this project's licence describes.
