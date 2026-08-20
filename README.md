# Finalibaba - Self-Hosted

> Self-hosted personal wealth dashboard. Track net worth, investments, real estate, loans, and crypto in one place.
> Open-source alternative to Finary, with per-account tax treatment (French PEA/CTO defaults, or Exempt/Deferred/custom rate for ISA, Roth IRA, 401k, and other non-French wrappers).

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)

---

## Features

- **Net worth dashboard** - gross and net of latent taxes, monthly trend, allocation breakdown
- **All asset types** - bank accounts, investments (PEA / CTO / Crypto), real estate, automobiles, loans
- **Per-account tax treatment** - each investment/crypto account is Taxable (its own rate), Exempt (ISA, Roth IRA), or Deferred (PER, 401k) - not limited to the French PEA/CTO model
- **Budgets & categories** - categorize transactions, set monthly budget envelopes, bulk-categorize recurring spend
- **Recurring transactions** - auto-detected subscriptions and regular income, 90-day cash-flow projection, missed-payment alerts
- **Income tracking** - record dividends and interest received as real events, separate from balance snapshots
- **Multi-currency** - hold positions in USD, GBP, or CHF, converted to EUR automatically
- **Analytics** - savings rate, survival runway, sector exposure, passive income, CAGR per account, benchmark comparison (MSCI World / S&P 500 / CAC 40), portfolio rebalancing suggestions
- **Annual tax report** - realized gains, dividend income, and taxable events for the year, exportable
- **CSV import & backup/restore** - bulk-import transactions/balance history for accounts without auto-sync; one-command database export and restore
- **Automatic sync** (optional) - Trade Republic (18 EU countries, positions + full transaction history with real labels) · French banks via Woob · GoCardless (2,200+ EU/UK banks)
- **Public REST API** (optional) - read-only, revocable API keys for net worth, accounts, and recent transactions - build a Home Assistant sensor or a custom dashboard widget without sharing your app password
- **Read-only share links** - a token-gated `/shared/<token>` URL for an accountant or family member, with holdings and recent transactions as opt-in extras - no app password needed, works independently of built-in auth
- **Installable, works offline** - add it to your home screen on mobile or desktop; pages you've already visited stay viewable without a connection (when built-in auth is off - see the PWA section below for why)
- **Dark or light theme** - switchable in Settings, dark by default
- **English & French UI** - language auto-detected from browser, switchable in Settings
- **100% self-hosted** - your data stays on your server

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 · React 19 · TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL 16 · Prisma ORM |
| Auto-sync | Python · FastAPI · pytr · Woob |
| Charts | Recharts |
| Deployment | Docker · Docker Compose |

---

## Quick start

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/LoicSERRE/finalibaba-selfhosted
cd finalibaba-selfhosted
cp .env.example .env
```

Edit `.env` - at minimum set:

```env
POSTGRES_PASSWORD=        # strong random password
NEXTAUTH_SECRET=          # openssl rand -base64 32
```

```bash
docker compose up -d
docker compose exec app pnpm exec prisma db seed  # optional - pre-populates common banks
```

Open [http://localhost:3000](http://localhost:3000). First boot takes a few minutes while the image builds.

---

## Account types

All types can be added and updated manually from the UI. Auto-sync is optional.

| Type | Description | Auto-sync |
|---|---|---|
| Checking / Savings | Bank accounts with balance history | Woob (FR banks) · Trade Republic (cash account) |
| Investment - PEA / CTO | Stock and ETF portfolios with live prices | Trade Republic |
| Crypto | Cryptocurrency wallets with live prices | Trade Republic |
| Real estate | Property with optional mortgage liability | - |
| Automobile | Vehicle with purchase price | - |
| Loan | Amortising loan with auto-computed remaining capital | - |
| Meal vouchers | Ticket Restaurant and similar | - |

---

## Automatic sync (optional)

All sync modules are **optional** - the app works fully without them. Leave credentials blank to disable a module.

### Trade Republic

Available in 18 EU countries: AT, BE, DE, EE, ES, FI, FR, GR, IE, IT, LT, LU, LV, NL, PL, PT, SI, SK.

Set `TR_PHONE` and `TR_PIN` in `.env`. First-time setup (interactive, required once):

```bash
docker compose exec -it sync python setup_tr.py
# Approve the notification in the TR app, then enter the 4-digit code
```

The session persists in a Docker volume. Renew it when it expires (every few weeks).

Syncs positions, cash balance, **and** the cash account's full transaction history (card payments, transfers, trades, dividends, interest - real merchant/description labels, not just amounts) - so budget categorization and recurring-transaction detection work for Trade Republic the same way they do for a Woob-synced bank. The first sync after connecting pulls your full available history; every sync after that only fetches what's new.

### French banks via Woob

Configure credentials per institution directly from **Settings → Institutions**. Supports any bank available in the [Woob](https://woob.tech) ecosystem.

If your bank requires a confirmation step on first connect (an app approval, or a code sent by SMS/email/app), a **Connecter** button appears next to that institution once the app detects it - no terminal needed, it walks you through whichever step your bank actually needs.

---

## Self-hosted alerts (optional)

Settings → Alertes can notify you (net worth threshold crossed, a loan nearly paid off, a sync failure) via push notification and email. By default that means the public [ntfy.sh](https://ntfy.sh) and your own Gmail/Outlook/other SMTP account - nothing below is required. If you'd rather run both yourself, this project ships two more **optional** Compose services, off by default:

```bash
docker compose --profile ntfy --profile mail up -d
```

### Push notifications (ntfy)

```bash
docker compose --profile ntfy up -d ntfy
```

Starts a private ntfy server on port `${NTFY_PORT:-8090}` with `auth-default-access: deny-all` - unlike the public server, nobody can read or publish to any topic without a token. One-time setup:

```bash
docker compose exec ntfy ntfy user add --role=admin youruser
docker compose exec ntfy ntfy token add youruser
# prints: token tk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx created for user youruser, never expires
```

In Settings → Alertes, set **URL du sujet ntfy** to `http://your-server:8090/<any-topic-name>` (or through your reverse proxy's HTTPS URL, see below) and **Jeton d'authentification ntfy** to the `tk_...` token above. Point your phone's ntfy app at the same server + topic + token to receive them.

#### Exposing ntfy to the internet

Your phone needs to reach `ntfy` from outside your home network to get notifications away from home - `mail` doesn't (it only makes outbound connections, no port forwarding needed for it at all). Two ways to do that, pick one:

- **Reverse proxy + port forward** (public exposure) - point a subdomain (e.g. `ntfy.yourdomain.com`) at this container's port through whichever reverse proxy you already use for the main app (Nginx Proxy Manager, Caddy, Traefik - see "Securing access" above), with a real TLS cert, and forward that port on your Freebox to your server. Once this is up, use the HTTPS URL (not `http://your-server:8090`) in both Settings and the phone app.
- **Tailscale/WireGuard instead of public exposure** (recommended if you already have one, or are willing to set one up) - add `ntfy` to your tailnet and use its Tailscale address/hostname. Your phone reaches it from anywhere exactly like the reverse-proxy option, but the container is never reachable from the public internet at all, which sidesteps everything below.

**If you go the public-exposure route, know what `deny-all` does and doesn't cover.** It stops anyone without a valid token from reading or publishing to any topic - that was the actual privacy problem with the public ntfy.sh (an easily-guessed topic name), and it's fixed. It does **not** make the server invisible: it's still a real internet-facing service, so ordinary hygiene applies - keep the image updated (`docker compose --profile ntfy pull ntfy && docker compose --profile ntfy up -d ntfy` periodically), always use the HTTPS URL through your reverse proxy rather than the bare `http://` port, and treat the admin account you created (`ntfy user add --role=admin`) like any other admin credential - it has full read/write access to every topic, the same way `AUTH_PASSWORD` gates this app itself. If you don't need it reachable by anyone but your own devices, the Tailscale option above removes this whole category of risk instead of mitigating it.

### Email (self-hosted mail server)

Requires a domain you control (for the DNS records below) and works best from a real server, not a residential connection - see the caveat at the end of this section.

```bash
docker compose --profile mail up -d mail
docker compose exec mail setup email add alerts@yourdomain.com <a-password>
docker compose exec mail setup config dkim domain yourdomain.com
```

Then **recreate** the container (not just restart it - a plain restart doesn't reliably reload the new DKIM config, confirmed while building this):

```bash
docker compose --profile mail up -d --force-recreate mail
```

Get the DNS TXT record value to publish:

```bash
docker compose exec mail cat /tmp/docker-mailserver/opendkim/keys/yourdomain.com/mail.txt
```

Add these DNS records at your registrar (`yourdomain.com` is a placeholder throughout - the DKIM value is the exact output of the command above):

| Type | Name | Value |
|---|---|---|
| TXT | `yourdomain.com` | `v=spf1 a:mail.yourdomain.com -all` - uses `a:` (resolve the hostname each time) rather than a hardcoded `ip4:<address>`, since a homelab's assigned IP commonly isn't static; point `mail.yourdomain.com` at your current IP with the same dynamic DNS mechanism you likely already use to reach this server at all |
| TXT | `mail._domainkey.yourdomain.com` | the `p=...` value from the command above |
| TXT | `_dmarc.yourdomain.com` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.com` (monitoring only to start - tighten to `p=quarantine`/`p=reject` once you've confirmed mail actually arrives) |

In Settings → Alertes, choose **Serveur mail auto-hébergé** from the Fournisseur dropdown (fills in `mail`/port `25`) and leave **Utilisateur SMTP**/**Mot de passe SMTP** blank - the `app` container relays through `mail` via the trusted Docker network, not credentials (`PERMIT_DOCKER` in `docker-compose.yml`). Set **Adresse d'expédition** to the address you created above.

**Before relying on this**: residential ISPs very commonly block outbound port 25 (anti-spambot policy), and even where it's open, residential IP ranges sit on Spamhaus's PBL - Gmail/Outlook may spam-bin or drop mail from them regardless of correct DNS. Test first:

```bash
docker compose exec mail nc -zv smtp.gmail.com 25
```

If that fails to connect, your ISP is blocking outbound port 25 and this won't work no matter how correct the DNS is - use the Gmail/Outlook preset or a free transactional API instead. If it succeeds, publish the DNS records above and check your setup with [mail-tester.com](https://www.mail-tester.com) before trusting it for real alerts. Also check whether your ISP lets you set reverse-DNS (PTR) for your assigned IP to `mail.yourdomain.com` - it matters for deliverability and is usually configured through your ISP's account panel or support, not your domain's own DNS zone.

---

## CSV import

For checking/savings/meal-voucher accounts not covered by auto-sync (foreign banks, cash accounts, migrating from Excel or Finary…), open the account and use one of the two import buttons. Both preview rows before import - likely duplicates are flagged and unchecked by default, but you can still select them.

**Import transactions** - columns `date`, `label` (or `libellé`/`description`), `amount` (or `montant`). Amount positive = credit, negative = debit. Flags a row as a likely duplicate when its date, label, and amount all match an existing transaction.

**Import balance history** - columns `date`, `balance` (or `solde`/`montant`/`valeur`). One point per date; this backfills both the account's balance chart and the dashboard's net worth history. Flags a row as a likely duplicate when a balance is already recorded for that date.

Both accept dates as `YYYY-MM-DD` or `DD/MM/YYYY`.

---

## Public REST API

Read-only, versioned under `/api/v1/` - for a Home Assistant sensor, a custom dashboard, or anything else that wants programmatic access without your app password or a browser session.

1. **Settings → API → Créer une clé** - name it (e.g. "Home Assistant"), then copy the key. It's shown in full every time you view it (unlike a "shown once" token), so you can always come back and copy it again.
2. Call an endpoint with it as a bearer token:

```bash
curl -H "Authorization: Bearer fnlb_..." https://your-instance/api/v1/net-worth
```

| Endpoint | Returns |
|---|---|
| `GET /api/v1/net-worth` | Current net worth, gross assets, liabilities, latent tax, allocation breakdown |
| `GET /api/v1/net-worth/history` | Daily net worth series (for a graph) |
| `GET /api/v1/accounts` | Every account's current value |
| `GET /api/v1/transactions?limit=&accountId=` | Recent transactions (`limit` defaults to 20, capped at 100) |

Revoke a key any time from the same Settings section - it stops working immediately. Deliberately read-only and limited to these four endpoints for now (no transactions/budgets/holdings export) - a leaked key should only ever expose a glanceable summary, not a full financial history.

---

## Installable & offline

Open the app in a mobile or desktop browser and use "Add to Home Screen" / "Install" - it behaves like a native app (its own icon, no browser chrome).

Pages you've already visited stay viewable without a connection - but only when the [built-in password](#securing-access) is off (the default). With it on, offline viewing is disabled on purpose: falling back to a cached page on a network failure would bypass the session check that page normally goes through, so a session that expired or was revoked could otherwise still show real data. Switching themes (Réglages → Apparence, dark by default) or languages while genuinely offline can show a stale version until you're back online - it corrects itself on the next successful load.

---

## Securing access

By default the app is open - intended for local networks, VPNs, or a reverse proxy that handles authentication.

### Built-in password

```env
AUTH_ENABLED=true
AUTH_PASSWORD=your_password
```

For better security, use a bcrypt hash instead of a plaintext password:

```bash
# Generate a hash
htpasswd -bnBC 10 "" your_password | tr -d ':\n'
```

```env
AUTH_ENABLED=true
AUTH_PASSWORD_HASH=<generated hash>
```

### Two-factor authentication (2FA)

With `AUTH_ENABLED=true`, optionally enable TOTP-based 2FA from Settings → Two-factor authentication - scan the QR code with any authenticator app (Google Authenticator, Aegis, etc.), confirm with a code, and save the 8 one-time backup codes shown once. No extra env vars needed.

**Locked out** (lost your authenticator device and all backup codes)? Connect directly to the database and clear it, then restart:

```bash
docker compose exec db psql -U appuser -d finalibaba -c \
  "UPDATE \"UserSettings\" SET \"totpEnabled\" = false, \"totpSecret\" = NULL, \"totpBackupCodes\" = '{}' WHERE id = 'singleton';"
```

Same idea as resetting `AUTH_PASSWORD` - this app trusts whoever has shell access to your own server.

### Reverse proxy (recommended for internet-facing installs)

Any of these work out of the box:

- **Nginx Proxy Manager** - Basic Auth tab
- **Caddy** - `basicauth` directive
- **Traefik + Authelia / Authentik** - full SSO
- **Cloudflare Access** - zero-trust, free up to 50 users

### VPN (simplest)

Use **Tailscale**, WireGuard, or OpenVPN - no auth config needed.

---

## Updating

```bash
# Pull pre-built images (recommended)
docker compose pull && docker compose up -d

# Or rebuild from source
git pull && docker compose up -d --build
```

Migrations are applied automatically on startup.

---

## Backup & restore

Two equivalent ways to back up your data - a full `pg_dump` of the database, so schema and data always stay consistent.

**From the UI:** Settings → Backup & restore → *Download a backup* / *Restore*. Restoring is destructive and requires confirmation.

**From the command line** (scriptable, good for cron):

```bash
./scripts/backup.sh                          # writes backups/finalibaba_<timestamp>.sql.gz
./scripts/restore.sh backups/finalibaba_20260713_120000.sql.gz
```

`restore.sh` asks for confirmation before replacing all current data, and briefly stops the `app`/`sync` containers during the restore so nothing writes concurrently. Do this before every upgrade.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE) - free to self-host and modify. If you run a modified version as a network service, you must publish your changes under the same license.
