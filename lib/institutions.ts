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
