/**
 * Well-known merchant patterns mapped to broad budgeting categories - the
 * cold-start complement to the self-learning engine, which always wins when it
 * has an answer. Extend as real gaps show up; no static list covers "any
 * merchant", and self-learning is what generalises.
 *
 * Broad categories on purpose (restaurants fold into Alimentation; gym,
 * telecom, insurance and streaming into Abonnements - grouped by "recurring
 * subscription-style payment", not by what it is for). Same taxonomy as
 * mcc-categories.ts. A FLAT map, not `{ categoryName, color, patterns }`
 * objects: the nested shape repeats itself seven times and Sonar's copy-paste
 * detector flags it as 80%+ duplication.
 *
 * **A known, unfixed false-positive class.** Trade Republic labels are German
 * and built from the traded instrument's name, so a French blue chip is the
 * SAME WORD as a real merchant here: `totalenergies`, `orange`, `engie`,
 * `veolia`, `axa`, `allianz`, `shell`, `esso`, `"bp "`, `"air france"` are each
 * both a merchant and a stock. "TotalEnergies - Kauf" and a fuel purchase are
 * indistinguishable by text. `"spar"` was removed after exactly this: it is a
 * substring of "Sparplan", so every recurring investment purchase was landing
 * in Alimentation. Confirm against real labels
 * (scripts/debug-categorization.sh) before touching these patterns.
 */export const MERCHANT_PATTERNS: Record<string, string> = {
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

  // The one entry here that is not spending. "zinsen" is Trade Republic's own
  // title for an interest payout, captured from a real API response - safe in a
  // way a brand name is not, because it is TR's structural vocabulary for the
  // KIND of event, not a company that could also be a purchase.
  zinsen: "Revenus",
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
  Revenus: "#14b8a6",
};

/**
 * First pattern that is a substring of the lowercased label wins. Plain
 * substring, never fuzzy: a bank label is boilerplate wrapped around one clear
 * merchant name, so fuzzy only adds false positives.
 */
export function matchMerchantCategory(label: string): { categoryName: string; color: string } | null {
  const normalized = label.toLowerCase();
  const match = Object.entries(MERCHANT_PATTERNS).find(([pattern]) => normalized.includes(pattern));
  if (!match) return null;
  const categoryName = match[1];
  return { categoryName, color: MERCHANT_CATEGORY_COLORS[categoryName] };
}
