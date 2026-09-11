/**
 * Merchant Category Code (ISO 18245) to a default category name - the sibling
 * of merchant-categories.ts's text dictionary, sharing its broad taxonomy.
 *
 * A more authoritative signal than label matching, because the card network
 * assigns it at merchant registration. Only GoCardless carries it, and only
 * when the bank fills it in; Woob, Trade Republic and CSV have no equivalent.
 *
 * Every code was checked against github.com/greggles/mcc-codes rather than
 * recalled - a wrong number here mis-categorises real transactions silently.
 * Where no clean code exists (gyms, online marketplaces), the entry is left out
 * rather than force-fit, and the text dictionary covers it by brand.
 *
 * Absent on purpose: 6011 (ATM) and 4829 (wire transfer) - a withdrawal is not
 * "spent" on a category, so unmapped is the honest answer.
 */
export const MCC_CATEGORIES: Record<string, string> = {
  // Alimentation - groceries, restaurants, fast food, bakeries, convenience
  "5411": "Alimentation", // Grocery Stores, Supermarkets
  "5499": "Alimentation", // Misc. Food Stores – Convenience Stores and Specialty Markets
  "5462": "Alimentation", // Bakeries
  "5300": "Alimentation", // Wholesale Clubs
  "5812": "Alimentation", // Eating places and Restaurants
  "5814": "Alimentation", // Fast Food Restaurants

  // Transport
  "5541": "Transport", // Service Stations
  "4121": "Transport", // Taxicabs and Limousines
  "4112": "Transport", // Passenger Railways
  "4511": "Transport", // Airlines, Air Carriers

  // Abonnements - anything recurring/subscription-style, regardless of domain
  "4899": "Abonnements", // Cable and other pay television
  "5968": "Abonnements", // Direct Marketing – Continuity/Subscription Merchant
  "4814": "Abonnements", // Telecommunication Services (phone/internet bills)
  "6300": "Abonnements", // Insurance Sales, Underwriting, and Premiums

  // Logement - utilities and home goods
  "4900": "Logement", // Electric, Gas, Sanitary and Water Utilities
  "5251": "Logement", // Hardware Stores
  "5712": "Logement", // Furniture, Home Furnishings, and Equipment Stores

  // Santé
  "5912": "Santé", // Drug Stores and Pharmacies
  "8011": "Santé", // Doctors and Physicians
  "8062": "Santé", // Hospitals

  // Shopping - general retail
  "5311": "Shopping", // Department Stores
  "5310": "Shopping", // Discount Stores
  "5732": "Shopping", // Electronic Sales
  "5734": "Shopping", // Computer Software Stores
  "4812": "Shopping", // Telecommunications Equipment (phone purchases, not bills)
  "5651": "Shopping", // Family Clothing Stores
  "5941": "Shopping", // Sporting Goods Stores
  "5942": "Shopping", // Book Stores
  "5192": "Shopping", // Books, Periodicals, and Newspapers
  "5733": "Shopping", // Music Stores, Musical Instruments
  "5735": "Shopping", // Record Shops
  "5945": "Shopping", // Hobby, Toy, and Game Shops
  "5995": "Shopping", // Pet Shops, Pet Foods, and Supplies Stores

  // Loisirs - one-off leisure/travel, as opposed to Abonnements' recurring version
  "7011": "Loisirs", // Lodging – Hotels, Motels, Resorts
  "7994": "Loisirs", // Video Game Arcades/Establishments
  "7996": "Loisirs", // Amusement Parks, Carnivals, Circuses
};

/** Category color for each name used above, shared with the text
 * dictionary's DEFAULT_MERCHANT_CATEGORIES - kept here too since this
 * module can resolve a category name to create with no text-dictionary
 * match involved at all (a pure MCC hit). */
export const MCC_CATEGORY_COLORS: Record<string, string> = {
  Alimentation: "#22c55e",
  Transport: "#3b82f6",
  Abonnements: "#a855f7",
  Logement: "#f59e0b",
  Santé: "#ef4444",
  Shopping: "#06b6d4",
  Loisirs: "#ec4899",
};

export function matchMccCategory(code: string | null | undefined): string | null {
  if (!code) return null;
  return MCC_CATEGORIES[code] ?? null;
}
