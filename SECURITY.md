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
- **Anyone with shell or database access to the host can read everything.** Several credentials are stored in plaintext by design (SMTP password, ntfy token, share-link and API-key tokens, TOTP secrets, Woob bank passwords) - the threat model this app defends against is network exposure, not a compromised host. Encrypting those fields against an attacker who already has the database and the application key would buy very little.
