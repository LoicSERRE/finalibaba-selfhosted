/**
 * UI strings name the unit with "€" ("Montant (€)", "Min €" - 28 of them per
 * locale). On an instance kept in another base currency (v2.19) the symbol
 * is replaced once, where messages are loaded (i18n/request.ts), rather than
 * threaded through every label's call site. Every "€" in messages/*.json is
 * a unit label, which is what makes a plain replacement correct - a message
 * that ever needs the euro sign for something else must not use it bare.
 */

export type Messages = { [key: string]: string | Messages };

// Not generic: a type parameter hides the function from lizard
// (scripts/lizard-blind-spots.py).
export function withCurrencySymbol(messages: Messages, symbol: string): Messages {
  if (symbol === "€") return messages;
  return replaceIn(messages, symbol) as Messages;
}

function replaceIn(node: string | Messages, symbol: string): string | Messages {
  if (typeof node === "string") return node.replaceAll("€", symbol);
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, replaceIn(value, symbol)]));
}
