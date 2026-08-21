const DOMAINS: Record<string, string> = {
  "lcl": "lcl.fr",
  "bnp paribas": "bnpparibas.fr",
  "société générale": "societegenerale.fr",
  "societe generale": "societegenerale.fr",
  "crédit agricole": "credit-agricole.fr",
  "credit agricole": "credit-agricole.fr",
  "boursorama": "boursorama.com",
  "trade republic": "traderepublic.com",
  "fortuneo": "fortuneo.fr",
  "bourse direct": "boursedirect.fr",
  "edenred": "edenred.fr",
  "coinbase": "coinbase.com",
  "binance": "binance.com",
  "kraken": "kraken.com",
  "revolut": "revolut.com",
  "n26": "n26.com",
  "hello bank": "hellobank.fr",
  "orange bank": "orangebank.fr",
  "ing": "ing.fr",
  "caisse d'épargne": "caisse-epargne.fr",
  "caisse depargne": "caisse-epargne.fr",
  "la banque postale": "labanquepostale.fr",
  "bforbank": "bforbank.com",
  "monabanq": "monabanq.com",
  "linxea": "linxea.com",
  "degiro": "degiro.fr",
  "interactive brokers": "interactivebrokers.com",
  "saxo bank": "home.saxo",
  "etoro": "etoro.com",
};

export function getInstitutionDomain(name: string): string | null {
  return DOMAINS[name.toLowerCase()] ?? null;
}

export function getInstitutionLogoUrl(name: string): string | null {
  const domain = getInstitutionDomain(name);
  return domain ? `https://www.google.com/s2/favicons?sz=256&domain=${domain}` : null;
}

// Threshold for ConfigureWoobDialog's migration-history-depth warning - see
// getMigrationHistoryDepth (lib/actions/institutions.ts) for the real
// production incident this fixes. Not user-configurable, same convention as
// lib/domain/loan.ts's isLoanNearlyPaidOff fixed 5%: a few days' gap (the
// Woob sync simply started slightly after the last .env sync ran) isn't
// worth alarming over, but a gap measured in months means real history is
// about to be permanently destroyed.
export const HISTORY_DEPTH_WARNING_DAYS = 60;

// Returns how many days of history migrating would destroy, or null when
// the gap is within HISTORY_DEPTH_WARNING_DAYS (or either side has no
// history yet, in which case there's nothing meaningful to compare).
export function historyDepthLossDays(legacyOldest: Date | null, woobOldest: Date | null): number | null {
  if (!legacyOldest || !woobOldest) return null;
  const days = Math.round((woobOldest.getTime() - legacyOldest.getTime()) / (24 * 60 * 60 * 1000));
  return days > HISTORY_DEPTH_WARNING_DAYS ? days : null;
}
