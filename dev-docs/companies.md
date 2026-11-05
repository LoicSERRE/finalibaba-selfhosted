# Companies (SCI first)

Design for owning wealth through a company - a French SCI first, the same mechanism for a family holding or any other company later. Requested in [discussion #50](https://github.com/LoicSERRE/finalibaba-selfhosted/discussions/50). **Status: steps 1 to 4 built** - the engine (data model, valuation, access, manager actions, sync, the share in every net worth), its interface ("C" below), the associates' current accounts, démembrement and the discount, and the tax regime. Step 5 is next. It landed after the two security-audit batches, on an access layer that had been verified rather than assumed.

## What users actually need

From #50 and from how an SCI is really run:

1. **See the SCI as its own portfolio**: its buildings, its bank accounts (synced like any other), its SCPI, its loans - its own net worth, its own history.
2. **See their own wealth with their share of it**: "60 % of an SCI worth 180 000 EUR" counts as 108 000 EUR in their net worth, in its history, its allocation, its exports - never the SCI at 100 %, never twice.
3. **Associates who are not users**: a spouse who never logs in, a parent who keeps the usufruct. The cap table must hold people the instance does not know.
4. **Current accounts (CCA)**: money an associate lent the SCI is an asset for them and a debt for the SCI, entered once.
5. **Démembrement**: parts held in usufruct by one person and bare ownership by another - the usual family-transmission setup - each valued by the legal scale, changing as the usufructuary ages.
6. **Several associates on one instance**, each seeing the SCI read-only and their own share, and one manager who maintains it.

## An SCI, criterion by criterion

Every notion an SCI carries, and what this design does with it. "Later" items are designed for (nothing in step 1 blocks them); "out of scope" ones are deliberate.

| Notion | What it is | In Finalibaba | Step |
|---|---|---|---|
| Parts sociales | the capital is divided into a fixed number of parts (statutes) | `Company.totalParts`; holdings are counts of parts, percentages are derived, so they always add up | 1 |
| Associés | at least two, people (or companies) | `CompanyAssociate`: a name, optionally linked to a user of the instance | 1 |
| Gérant | runs the SCI, an associate or a third party | `Company.managerUserId`: the one user who maintains it in the app | 1 |
| Patrimoine de la SCI | buildings, cash, SCPI, other investments | ordinary accounts of the existing types, tagged with the company | 1 |
| Emprunts | the SCI borrows in its own name | ordinary LOAN accounts of the company, bank-synced or manual | 1 |
| Apports | what each associate brought in exchange for parts | not stored: it is history, the value is in the parts. A note on the associate if wanted | out of scope |
| Valorisation des parts | net asset value (ANR) per part, often with an illiquidity discount | ANR = company assets − liabilities − CCA; optional discount % on the company, applied to associates' shares only | 1 (ANR), 3 (discount) |
| Comptes courants d'associés | associates' loans to the SCI, repayable | one amount per associate, asset for them, liability for the company | 2 |
| Démembrement | usufruct / bare ownership of parts | a block of parts with an usufructuary and a bare owner, valued by art. 669 CGI | 3 |
| Usufruit temporaire | usufruct for a fixed term | 23 % per started 10-year period (art. 669 II) | 3, if asked |
| Régime fiscal IR / IS | transparent (income taxed at associates) or corporate tax | stored on the company; drives the latent tax shown on the company's gains (IS: corporate gain tax on the buildings' latent gain) | 1 (stored), 4 (used) |
| Revenus fonciers, déficit, 2072 | the yearly tax return of an IR SCI | out of scope: this is accounting, not wealth tracking | out of scope |
| Distribution des résultats | IR: share of result taxed even if not paid; IS: dividends | a dividend paid to an associate is an ordinary income on their account; nothing to model | - |
| Responsabilité des associés | unlimited, proportional to parts | informational only: the SCI's debts already reduce the associates' share through the ANR | - |
| Cession / donation de parts | parts change hands, with approval | edit the holdings; a dated history of holdings comes later so past net worth uses past shares | 5 |
| IFI | real estate held through an SCI is taxable at the associate's share | a later report built on the same share computation | later |
| SCI détenant une SCI | nested companies | refused: a company cannot be an associate in step 1 (cycles, and nobody has asked) | out of scope |

## Principles (the part that keeps it maintainable)

1. **No new principal.** A company is never a `User`: no login, no session, no password, no API key, no invitation can ever target it. Every security mechanism of the app keeps reasoning about people only. (A login-less user was the first idea and was rejected for exactly this: every existing and future user feature would have to remember it exists, and forgetting once reopens the class of bug where one account reaches another's data.)
2. **Company accounts belong to the manager.** `Account.userId` stays required and stays the manager's, so every mutation guard (`assertAccountWritable`, `assertOwned`) works unchanged. `Account.companyId` says which company the account is part of.
3. **One scope resolver.** "Which accounts does this page show" is decided in `lib/auth-context.ts` only, as it is today. A company becomes a third scope beside "my portfolio" and "a portfolio granted to me". No page, action or route queries accounts by user or company on its own.
4. **One valuation module.** ANR, a holding's value, the usufruct scale and the discount live in `lib/domain/company.ts`, pure, unit-tested to the cent. Every consumer (dashboard, history, analytics, API, alerts, exports) calls it; none re-derives a share.
5. **The company is computed with the code that already computes a portfolio.** Its ANR is `computeDashboard` (and the history equivalent) over the company's account set, minus the CCA - not a second net-worth implementation that would drift.
6. **Deny or narrow, never widen.** An unknown company, a company the viewer has no part in, a stale scope cookie: the viewer falls back to their own portfolio, read-write only where it was already theirs.
7. **Every access path has a cross-user test** (user B tries it on user A's company and must fail), written with the feature, not after.

## Data model

```prisma
enum CompanyKind { SCI HOLDING OTHER }
enum CompanyTaxRegime { IR IS }

model Company {
  id               String           @id @default(cuid())
  name             String
  kind             CompanyKind      @default(SCI)
  taxRegime        CompanyTaxRegime @default(IR)
  totalParts       Int              // from the statutes; > 0
  discountPct      Float?           // illiquidity discount on associates' shares, 0-1 (step 3)
  managerUserId    String           // the one user who maintains it
  manager          User             @relation(fields: [managerUserId], references: [id], onDelete: Restrict)
  associates       CompanyAssociate[]
  holdings         CompanyHolding[]
  accounts         Account[]
  institutions     Institution[]
  createdAt        DateTime         @default(now())
}

/// A person in the cap table. Linked to a user when they use this instance,
/// a bare name otherwise (a spouse who never logs in, a parent).
model CompanyAssociate {
  id                  String   @id @default(cuid())
  companyId           String
  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  userId              String?  // SetNull when that user is deleted: the name stays, the cap table still adds up
  user                User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  name                String
  birthDate           DateTime? // needed only as an usufructuary (step 3)
  currentAccountCents BigInt   @default(0) // CCA, what the company owes them (step 2)
  @@unique([companyId, userId])
}

/// A block of parts: fully owned by one associate, or split between an
/// usufructuary and a bare owner (step 3).
model CompanyHolding {
  id              String  @id @default(cuid())
  companyId       String
  company         Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  parts           Int     // > 0
  fullOwnerId     String? // set for full ownership...
  usufructuaryId  String? // ...or these two for a démembrement
  bareOwnerId     String?
}
```

Plus `Account.companyId String?` and `Institution.companyId String?` (the company's own bank connection; the sync tags every account it creates under it).

**Invariants, enforced on every write and by a DB-backed test:**

- the holdings' parts add up to `totalParts` exactly;
- a holding is either `fullOwnerId` alone or `usufructuaryId` + `bareOwnerId` (two different associates), never a mix;
- an account's `companyId` and its institution's `companyId` agree; a company account's `userId` is the company's manager;
- the manager is a linked associate (a gérant who is a third party is a manager without parts: allowed, shown as such).

`onDelete: Restrict` on the manager is the deny-by-default answer to "the manager's user is deleted": the deletion is refused until management is handed over or the company deleted, rather than cascading the company's accounts away with the user.

## Access rules

| Who | Company page | Company accounts | Cap table, CCA, settings | Their share in their own net worth |
|---|---|---|---|---|
| Manager | read | read + write (they own them) | edit | yes, if they hold parts |
| Associate linked to a user | read-only | read-only | read-only | yes |
| Anyone else | not found (same answer as a company that does not exist) | not found | not found | - |

- An associate's read access comes from their `CompanyAssociate` row, checked on every request like a `PortfolioGrant`. Removing them from the cap table removes it at once.
- Derived artifacts (share links, API keys, alert rules, exports) stay personal in step 1: they carry the viewer's own portfolio and their *share* of each company, never a company's accounts. Company-scoped artifacts, if ever, are manager-only and a later decision.
- Handing over management: only to a linked associate, by the current manager; it moves `managerUserId`, the company's accounts' `userId` and its institutions' `userId` in one transaction (the sync then realigns ownership as it already does from the institution's owner).
- Mono-user mode (`AUTH_ENABLED` unset): everything resolves to the owner, who is the manager of every company; associates are names.

## Computations

```
ANR(company, date)        = net worth of the company's accounts at date (computeDashboard / history over that set)
                            − Σ associates' currentAccountCents
partValue(company, date)  = ANR / totalParts × (1 − discountPct)
usufructPct(age)          = art. 669 I CGI: < 21: 90 % · < 31: 80 · < 41: 70 · < 51: 60 · < 61: 50
                                             · < 71: 40 · < 81: 30 · < 91: 20 · otherwise 10
holdingValue for person P = Σ blocks: full owner P   → parts × partValue
                                      usufructuary P → parts × partValue × usufructPct(age of P at date)
                                      bare owner P   → parts × partValue × (1 − usufructPct(age of the usufructuary at date))
personal net worth        = own accounts (company accounts excluded) + Σ holdingValue + own CCA receivables
```

- **Excluding company accounts from personal scope happens once**, in `baseAccountIds`, so the manager's dashboard, analytics, exports, API, alerts and share links stop counting the company at 100 % without each being edited - and a test pins that a manager's net worth equals their own accounts plus their share, not plus the company.
- **Then the share is added where a net worth is computed.** Today that is: `lib/domain/dashboard.ts` and `dashboard-history.ts` (dashboard, shared links), `lib/domain/analytics*.ts` and `projection.ts`, `app/api/v1/net-worth*` and `accounts`, `lib/domain/alerts.ts` with `lib/services/alerts/custom-rules.ts` (net worth thresholds), `lib/domain/user-export.ts` and the markdown exports. Each receives the holdings from one loader and adds them through `lib/domain/company.ts`; a test lists these entry points and fails if a new net-worth consumer appears without the share.
- **Negative ANR** (an SCI that owes more than it holds) is shown as is; an associate's share can be negative - that is the economic reality of the loan they stand behind.
- **History** uses today's holdings for every past day until step 5 dates them; the company's own history is exact from day one.
- **Allocation**: shares appear as their own bucket ("Sociétés"), not spread into real estate / cash, because what the person owns is parts.
- **Latent tax** on the company's gains follows its regime (step 4); until then the company's holdings carry the same per-account tax treatment as anyone's.

## Bank sync

The company's bank is an ordinary institution owned by the manager with `companyId` set; Woob or GoCardless connects it like any other. `sync/db.py`'s `upsert_account` writes the institution's `companyId` on the accounts it creates and keeps it aligned on existing ones, exactly as it already does for `userId`. A Trade Republic company account (pytr can switch to one) is out of scope until someone asks.

Transfers between a personal account and a company account are not internal transfers (two patrimonies) and internal-transfer detection already cannot pair them, since it runs on the personal set. Linking such a transfer to the associate's CCA automatically is a later convenience; until then the user categorises it.

## Interface

- A **Sociétés** tab in Settings or an entry in the sidebar's portfolio switcher, listing the companies the viewer manages or holds parts in.
- The company's page reuses the dashboard and account pages with the company scope; a cap-table card (associates, parts, percentages, usufruct/bare ownership, CCA) and the company settings sit beside them.
- In the personal portfolio: one card per company in the accounts page (value of the share, % held, link to the company), and the "Sociétés" bucket on the dashboard.

## Steps

Each ships on its own, with its tests and its doc update.

1. **Company, cap table, share in net worth.** `Company`, `CompanyAssociate`, `CompanyHolding` (full ownership only), `Account/Institution.companyId`; scope resolver; ANR and share through every net-worth consumer; manager / associate / outsider access with cross-user tests; manager deletion refused; management hand-over.
2. **Current accounts (CCA).** The amount per associate, both sides of the balance sheet, in the ANR and the personal net worth.
3. **Démembrement and discount.** Usufructuary / bare-owner blocks, birth dates, art. 669 scale (age at each history date), optional discount.
4. **Tax regime used.** IS latent corporate tax on the company's gains; IR transparency stated.
5. **Dated holdings.** Cession and donation recorded with a date, so past net worth uses past shares.

## Security checklist for the implementation

Written as tests in the same PR as each step:

- user B cannot read A's company page, accounts, cap table, history, or any company route, by id or by scope cookie - same "not found" as a missing company;
- an associate cannot perform any company mutation (accounts, cap table, CCA, settings, hand-over) - every Server Action checks the manager, not the UI;
- a removed associate loses read access on the next request;
- a company never appears in user management, invitations, login, or token flows (it is not a user - the test is that the `User` table never gains a row);
- the manager's personal artifacts (share link, API, export) contain their share and never the company's accounts;
- invariants (parts sum, holding shape, account/institution/manager agreement) are rejected when violated, server-side.

## Decided during step 1

- **Where the companies live: from the person's accounts ("C").** Three mock-ups were compared - the company as a portfolio of the sidebar switcher, a "Sociétés" entry in the menu, and this one. A company is a card on the Accounts page (its value, the share held), created from the usual "Ajouter" button through a three-step guide (the company, its associates and parts, its accounts). Its own page reuses the dashboard pieces (ANR, the share, the part's value, the history, its accounts, its associates). "Ouvrir comme portefeuille" sets the company scope of the switcher for budgets and transactions. Why: a company is set up once and then looked at, so it belongs where a person's assets already are; no eighth menu entry (the mobile bar has seven) and no global mode to forget you are in.
- **Linking an associate to a user is an invitation**, as co-ownership became one in v2.23 (`dev-docs/multi-user-and-security.md`, "Both are invitations"). `CompanyAssociate.linkAcceptedAt` is null until that user accepts; until then they neither see the company nor get its share in their net worth. The manager linking themselves is accepted at once. Declining - or leaving later - unlinks the row and keeps the name and the parts, so the cap table still adds up.

## How step 1 is built

- **Three account sets in `lib/auth-context.ts`.** `baseAccountIds` is the personal set (company accounts left out): net worth and every derived artifact. `writableAccountIds` adds the companies the user manages: batch writes (categorizing, undo). `accountPools` splits the writable set by patrimony - personal, then one per company - for the passes that pair accounts (internal transfers, history-based categorization), so a transfer from a person to their SCI is never paired as internal.
- **One net-worth loader**, `lib/services/net-worth.ts`: `computePortfolio` loads the accounts and the person's company shares, `loadCompanyShares` values each company with `computeDashboard` over its own accounts. The dashboard, share links, `/api/v1/net-worth*` and the net-worth alert go through it; analytics passes the same shares to `computeAnalytics`. `__tests__/net-worth-consumers.test.ts` fails on a `computeDashboard` call anywhere else.
- **The company scope** is the viewing cookie with a `company:` prefix (`getViewContext`): writable for the manager, read-only for an accepted associate, the viewer's own portfolio for anyone else.
- **Mutations** (`lib/actions/companies.ts`) all start with `assertCompanyManager`. The cap table is saved as a whole in one transaction. An account under a bank connection moves with its institution (`setInstitutionCompany`), a manual one on its own (`setAccountCompany`); a co-owned account can do neither, and a company account cannot be co-owned. `deleteUser` refuses a manager (the FK is Restrict).
- **Sync**: `sync/db.py` gives a new account its institution's `companyId` and realigns it on every sync, like `userId`.

**The interface** (`components/companies/`, `app/companies/[id]/page.tsx`): the Accounts page lists the viewer's companies (`CompaniesSection`, from `lib/services/companies-read.ts`) and their pending links with Accept / Decline, and holds "Nouvelle société" (`CreateCompanyDialog`, three steps; the cap table editor is shared with the page). The company page re-checks the role itself and leaves the manager's tools - usernames, what can be attached, settings, hand-over, deletion - out of an associate's data, not just out of the markup. A company's account opens from its page (`companyAccountAccess` on the account page: write for the manager, read for an associate); it is never offered co-ownership. The switcher lists the companies (mono mode too), and in a company's scope the dashboard and Accounts page carry a banner with the way back; the add-account dialogs then send the company's id, which the server checks. The dashboard's account list adds a "Sociétés" group of shares (`withCompaniesGroup`), so it adds up to the net worth above it.

**Deliberate gaps, for later**: `/api/v1/accounts` lists the key owner's accounts only (a share is not an account; it is in `/net-worth`). The personal data export does not include companies yet. On a hand-over, the company's transactions keep the categories of the previous manager (they still display; the new manager re-categorizes with their own).

## Step 2: current accounts (CCA)

- `CompanyAssociate.currentAccountCents` (>= 0, whole cents, checked by `validateCapTable`): what the associate lent the company. Entered in the cap table editor beside the parts.
- **The company's value** (`netAssetValueCents`): computeDashboard over its accounts - where the lent money already sits - minus the sum of the current accounts, which the company owes back.
- **A person's figure** (`buildCompanyShare`): their share of that value plus their own current account, a receivable. Across all associates it adds back up to exactly the company's accounts: nothing is counted twice or lost (pinned by a test).
- History: today's current accounts applied to every past day, like today's holdings until step 5.
- **Visibility: every associate sees every current account** (decided at step 2). They are in the company's books, and the associates already see each other's parts.

## Step 3: démembrement and discount

- **Blocks**: a `CompanyHolding` is owned outright (`fullOwnerId`) or split between an `usufructuaryId` and a `bareOwnerId`, two different associates. A database CHECK constraint holds the shape (migration `20261105180000_company_dismemberment`) under the server's own check (`validateCapTable`, which also counts each block once in the total and wants every associate to hold something).
- **The scale** (`usufructPct`, art. 669 I CGI): 90 % under 21, then 10 points less per started decade, 10 % from 91. The usufruct counts for that share of the block and the bare ownership for the rest, so the two always add up to the whole block (pinned by a test). An usufructuary must have a birth date (`CompanyAssociate.birthDate`); the age is taken **at each history date**, so a bare ownership gains value on the usufructuary's birthdays. A stake (`Stake`, `stakeOfAssociate`) carries the birth dates its value depends on.
- **Discount** (`Company.discountPct`, 0 to under 1, a percentage in the settings): applied to the value of the parts, never to a current account, which is a receivable.
- **What is shown**: a person's share and its percentage are their **economic weight** (an usufruct of every part at 70 is 40 %, not 100 %); the cap table lists each associate's full, usufruct and bare-ownership parts, and its bar draws the weights. A part's value is shown before and after the discount. Birth dates, like usernames, are the manager's only.
- **Not done**: temporary usufruct (art. 669 II, 23 % per started 10-year period), "if asked".

## Step 4: the tax regime

- **IR**: the company is transparent - its gains are taxed at the associates', at rates that depend on each of them - so nothing is deducted at its level and its figures stay as computeDashboard makes them. The company page says so.
- **IS**: the company pays the tax itself. computeDashboard's per-account latent tax (a person's PEA/CTO rates) does not apply to it; **corporate tax on its whole latent gain** does (`companyNetWorthForRegime`), at 15 % up to 42 500 then 25 % (`corporateTaxCents` - the SME reduced rate, stated as such on the page since nothing here can check the conditions). One result: a loss on one asset offsets a gain on another.
- **The gain on a building** is measured from its **net book value** (`Account.bookValueCents`, cost less depreciation, from the balance sheet), not its purchase price: under IS buildings are depreciated, and the taxable gain is the sale price less that value. The manager enters it on the company page (`setBuildingBookValue`); a building without one is left out of the gain, and the page says so. Holdings count with their cost basis (`DashboardResult.investmentGainCents`).
- Today's tax is applied to every past day (`companyValueForRegime`), like the current accounts. Exported with the personal data (`bookValueCents`).

## Open questions

- Whether the discount should differ per associate (it sometimes does, for a minority stake).
