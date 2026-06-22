# Contributing

Contributions are welcome — bug reports, documentation improvements, and code PRs.

## Reporting a bug

Open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- Your Docker version and OS
- The relevant section of your `.env` (redact all credentials and passwords)
- Logs: `docker compose logs app` and `docker compose logs sync`

## Submitting a pull request

1. Fork the repo and create a branch from `main`
2. Keep changes focused — one feature or fix per PR
3. Commit messages in English, imperative mood (`add X`, `fix Y`, not `added X`)
4. Test with `docker compose up -d --build` before submitting

## Note on bank scrapers

The sync modules for LCL, Trade Republic and Swile (`sync/`) rely on undocumented private APIs and are inherently fragile. PRs fixing broken scrapers are welcome, but:
- They may break again without notice when banks update their APIs
- We cannot guarantee long-term maintenance of scraper-based integrations
- PRs that introduce new scrapers must include a clear note on their stability

## Architecture

See [CLAUDE.md](CLAUDE.md) for a full description of the codebase structure.
