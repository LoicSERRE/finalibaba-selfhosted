/**
 * A curated set of well-known merchant name patterns mapped to standard
 * budgeting category names - a complement to the self-learning engine in
 * auto-categorize.ts, not a replacement for it. Self-learned history
 * (this user's own confirmed categorization) always takes priority when it
 * exists and is confident; this dictionary only fills in when no such
 * history exists yet - solving the cold-start problem for a brand new
 * user (or for a merchant this user has genuinely never categorized
 * before), where the self-learning engine's only option is "nothing to
 * learn from yet, leave it uncategorized".
 *
 * Deliberately a small set of *broad* categories (Alimentation, Transport,
 * Abonnements, Logement, Santé, Shopping, Loisirs), not one per merchant
 * type - e.g. restaurants/fast food fold into Alimentation, and gym/
 * telecom/insurance/streaming all fold into Abonnements (grouped by "is
 * this a recurring subscription-style payment", not by what it's for).
 * Same taxonomy as lib/domain/mcc-categories.ts's MCC map.
 *
 * A flat `pattern -> categoryName` map, mirroring mcc-categories.ts's own
 * MCC_CATEGORIES shape, rather than an array of `{ categoryName, color,
 * patterns: [...] }` objects (an earlier draft) - that nested-array-per-
 * category shape repeats the same object structure 7 times with only the
 * string contents differing, which SonarQube's copy-paste detector treats
 * as duplicated code (normalized-literal token matching flagged 80%+
 * duplication in this file alone). The flat map has no such repeating
 * structure.
 *
 * No static list, however large, can genuinely cover "any merchant,
 * however obscure" - new businesses appear constantly and local/regional
 * shops are infinite in variety. This is deliberately broad (aiming for
 * the common, recognizable brands most self-hosted users' bank statements
 * will actually show) rather than an attempt at completeness - the
 * self-learning engine above is what actually generalizes to a genuinely
 * unknown merchant, once the user has categorized it once. Extend this
 * map as real gaps show up in practice.
 */
export const MERCHANT_PATTERNS: Record<string, string> = {
  // Alimentation - supermarkets / grocery
  carrefour: "Alimentation",
  leclerc: "Alimentation",
  monoprix: "Alimentation",
  "monop'": "Alimentation",
  franprix: "Alimentation",
  lidl: "Alimentation",
  auchan: "Alimentation",
  intermarche: "Alimentation",
  casino: "Alimentation",
  "super u": "Alimentation",
  "systeme u": "Alimentation",
  picard: "Alimentation",
  biocoop: "Alimentation",
  naturalia: "Alimentation",
  "grand frais": "Alimentation",
  aldi: "Alimentation",
  netto: "Alimentation",
  cora: "Alimentation",
  spar: "Alimentation",
  g20: "Alimentation",
  proxi: "Alimentation",
  "leader price": "Alimentation",
  // Alimentation - restaurants / fast food / delivery (folded in, not a separate category)
  mcdonald: "Alimentation",
  "burger king": "Alimentation",
  kfc: "Alimentation",
  deliveroo: "Alimentation",
  "uber eats": "Alimentation",
  ubereats: "Alimentation",
  "just eat": "Alimentation",
  quick: "Alimentation",
  subway: "Alimentation",
  starbucks: "Alimentation",
  "domino's pizza": "Alimentation",
  "dominos pizza": "Alimentation",
  "five guys": "Alimentation",
  "pizza hut": "Alimentation",
  "o'tacos": "Alimentation",
  "columbus cafe": "Alimentation",
  "brioche doree": "Alimentation",
  flunch: "Alimentation",
  courtepaille: "Alimentation",
  "buffalo grill": "Alimentation",
  "leon de bruxelles": "Alimentation",
  "planet sushi": "Alimentation",
  "sushi shop": "Alimentation",

  // Transport
  sncf: "Transport",
  ratp: "Transport",
  uber: "Transport",
  bolt: "Transport",
  blablacar: "Transport",
  totalenergies: "Transport",
  "total energies": "Transport",
  esso: "Transport",
  shell: "Transport",
  "bp ": "Transport",
  avia: "Transport",
  "vinci autoroutes": "Transport",
  flixbus: "Transport",
  trainline: "Transport",
  "air france": "Transport",
  ryanair: "Transport",
  easyjet: "Transport",
  transavia: "Transport",
  aprr: "Transport",
  sanef: "Transport",
  ouigo: "Transport",
  keolis: "Transport",
  izly: "Transport", // campus transit/canteen card, common for students

  // Abonnements - streaming / digital subscriptions
  netflix: "Abonnements",
  spotify: "Abonnements",
  "amazon prime": "Abonnements",
  "disney+": "Abonnements",
  disneyplus: "Abonnements",
  deezer: "Abonnements",
  "canal+": "Abonnements",
  "youtube premium": "Abonnements",
  "apple.com/bill": "Abonnements",
  "playstation network": "Abonnements",
  xbox: "Abonnements",
  icloud: "Abonnements",
  "microsoft 365": "Abonnements",
  adobe: "Abonnements",
  dropbox: "Abonnements",
  "google one": "Abonnements",
  nordvpn: "Abonnements",
  twitch: "Abonnements",
  // Abonnements - telecom
  orange: "Abonnements",
  sfr: "Abonnements",
  "bouygues telecom": "Abonnements",
  "free mobile": "Abonnements",
  "free telecom": "Abonnements",
  // Abonnements - gym / fitness (no clean MCC exists, so this is the only signal for it)
  "basic fit": "Abonnements",
  keepcool: "Abonnements",
  "fitness park": "Abonnements",
  neoness: "Abonnements",
  "on air fitness": "Abonnements",
  "l'orange bleue": "Abonnements",
  vitagym: "Abonnements",
  // Abonnements - insurance / mutuelle
  maaf: "Abonnements",
  macif: "Abonnements",
  maif: "Abonnements",
  axa: "Abonnements",
  allianz: "Abonnements",
  groupama: "Abonnements",
  matmut: "Abonnements",
  gmf: "Abonnements",

  // Logement
  edf: "Logement",
  engie: "Logement",
  veolia: "Logement",
  suez: "Logement",
  "leroy merlin": "Logement",
  castorama: "Logement",
  "brico depot": "Logement",
  conforama: "Logement",
  ikea: "Logement",
  "maisons du monde": "Logement",
  botanic: "Logement",
  truffaut: "Logement",

  // Santé
  pharmacie: "Santé",
  ameli: "Santé",
  mutuelle: "Santé",
  doctolib: "Santé",
  "cabinet dentaire": "Santé",
  opticien: "Santé",
  krys: "Santé",
  "optic 2000": "Santé",
  afflelou: "Santé",

  // Shopping
  "amazon.fr": "Shopping",
  "amazon.de": "Shopping",
  "amazon.co.uk": "Shopping",
  fnac: "Shopping",
  darty: "Shopping",
  zalando: "Shopping",
  cdiscount: "Shopping",
  vinted: "Shopping",
  leboncoin: "Shopping",
  decathlon: "Shopping",
  zara: "Shopping",
  uniqlo: "Shopping",
  sephora: "Shopping",
  "h&m": "Shopping",
  celio: "Shopping",
  kiabi: "Shopping",
  "la redoute": "Shopping",
  "galeries lafayette": "Shopping",
  printemps: "Shopping",
  boulanger: "Shopping",
  rakuten: "Shopping",
  ebay: "Shopping",
  aliexpress: "Shopping",
  temu: "Shopping",
  shein: "Shopping",
  "nature et decouvertes": "Shopping",
  cultura: "Shopping",
  "gibert joseph": "Shopping",
  gemo: "Shopping",

  // Loisirs
  ugc: "Loisirs",
  pathe: "Loisirs",
  gaumont: "Loisirs",
  "disneyland paris": "Loisirs",
  "parc asterix": "Loisirs",
  ticketmaster: "Loisirs",
  "fnac spectacles": "Loisirs",
  "booking.com": "Loisirs",
  airbnb: "Loisirs",
  expedia: "Loisirs",
  steam: "Loisirs",
  "playstation store": "Loisirs",
  "nintendo eshop": "Loisirs",
  "epic games": "Loisirs",
  "europa park": "Loisirs",
  futuroscope: "Loisirs",
  "zoo de": "Loisirs",
  aquarium: "Loisirs",
};

/** Category color for each name used above, shared with the MCC
 * dictionary's MCC_CATEGORY_COLORS - kept here too since this module can
 * resolve a category name to create with no MCC match involved at all
 * (a pure text-dictionary hit). */
export const MERCHANT_CATEGORY_COLORS: Record<string, string> = {
  Alimentation: "#22c55e",
  Transport: "#3b82f6",
  Abonnements: "#a855f7",
  Logement: "#f59e0b",
  Santé: "#ef4444",
  Shopping: "#06b6d4",
  Loisirs: "#ec4899",
};

/**
 * Matches a transaction label against the dictionary above - the first
 * pattern that's a substring of the (lowercased) label wins. A plain
 * substring match, not fuzzy/scored: real bank labels are typically
 * boilerplate ("CB ", a date, a city) wrapped around one clear merchant
 * name, so a substring match is enough without the false-positive risk a
 * fuzzy match would add.
 */
export function matchMerchantCategory(label: string): { categoryName: string; color: string } | null {
  const normalized = label.toLowerCase();
  const match = Object.entries(MERCHANT_PATTERNS).find(([pattern]) => normalized.includes(pattern));
  if (!match) return null;
  const categoryName = match[1];
  return { categoryName, color: MERCHANT_CATEGORY_COLORS[categoryName] };
}
