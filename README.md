# Finalibaba - Self-Hosted

> Self-hosted personal wealth dashboard. Track net worth, investments, real estate, loans, and crypto in one place.
> Open-source alternative to Finary, with built-in French tax calculations (PEA · CTO · Crypto).

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)

---

## Features

- **Net worth dashboard** - gross and net of latent taxes, monthly trend, allocation breakdown
- **All asset types** - bank accounts, investments (PEA / CTO / Crypto), real estate, automobiles, loans
- **French tax calculations** - latent taxes: PEA 17.2%, CTO 31.4%, Crypto 31.4% (user-configurable)
- **Analytics** - savings rate, survival runway, sector exposure, passive income, CAGR per account
- **Automatic sync** (optional) - Trade Republic (18 EU countries) · French banks via Woob · GoCardless (2,200+ EU/UK banks)
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
docker compose exec app npx prisma db seed  # optional - pre-populates common banks
```

Open [http://localhost:3000](http://localhost:3000). First boot takes a few minutes while the image builds.

---

## Account types

All types can be added and updated manually from the UI. Auto-sync is optional.

| Type | Description | Auto-sync |
|---|---|---|
| Checking / Savings | Bank accounts with balance history | Woob (FR banks) |
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

### French banks via Woob

Configure credentials per institution directly from **Settings → Institutions**. Supports any bank available in the [Woob](https://woob.tech) ecosystem.

---

## CSV import

For checking/savings/meal-voucher accounts not covered by auto-sync (foreign banks, cash accounts, migrating from Excel or Finary…), open the account and use one of the two import buttons. Both preview rows before import - likely duplicates are flagged and unchecked by default, but you can still select them.

**Import transactions** - columns `date`, `label` (or `libellé`/`description`), `amount` (or `montant`). Amount positive = credit, negative = debit. Flags a row as a likely duplicate when its date, label, and amount all match an existing transaction.

**Import balance history** - columns `date`, `balance` (or `solde`/`montant`/`valeur`). One point per date; this backfills both the account's balance chart and the dashboard's net worth history. Flags a row as a likely duplicate when a balance is already recorded for that date.

Both accept dates as `YYYY-MM-DD` or `DD/MM/YYYY`.

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
