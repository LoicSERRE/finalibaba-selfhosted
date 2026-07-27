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
