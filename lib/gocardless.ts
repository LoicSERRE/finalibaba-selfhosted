const BASE = "https://bankaccountdata.gocardless.com/api/v2";

// In-memory token cache — survives between requests in the same process
let tokenCache: { access: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.access;
  }

  const res = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoCardless auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  tokenCache = { access: data.access, expiresAt: Date.now() + data.access_expires * 1000 };
  return data.access;
}

async function gcFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GoCardless ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface GCRequisition {
  id: string;
  link: string;
  accounts: string[];
  status: string;
}

export interface GCAccountDetails {
  account: {
    iban?: string;
    currency: string;
    ownerName?: string;
    name?: string;
    product?: string;
    cashAccountType?: string; // CACC=current, SVGS=savings, LLSV=livret
  };
}

export interface GCBalance {
  balanceAmount: { amount: string; currency: string };
  balanceType: string; // closingBooked | interimAvailable | …
}

export interface GCBalances {
  balances: GCBalance[];
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface GCInstitution {
  id: string;
  name: string;
  logo: string;
  countries: string[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

export async function searchInstitutions(country: string, search?: string): Promise<GCInstitution[]> {
  const params = new URLSearchParams({ country });
  if (search) params.set("search", search);
  return gcFetch<GCInstitution[]>(`/institutions/?${params}`);
}

export async function createRequisition(
  gcInstitutionId: string,
  reference: string,
  redirectUrl: string
): Promise<GCRequisition> {
  return gcFetch("/requisitions/", {
    method: "POST",
    body: JSON.stringify({
      redirect: redirectUrl,
      institution_id: gcInstitutionId,
      reference,
      user_language: "FR",
    }),
  });
}

export async function getRequisition(requisitionId: string): Promise<GCRequisition> {
  return gcFetch(`/requisitions/${requisitionId}/`);
}

export async function getAccountDetails(gcAccountId: string): Promise<GCAccountDetails> {
  return gcFetch(`/accounts/${gcAccountId}/details/`);
}

export async function getAccountBalances(gcAccountId: string): Promise<GCBalances> {
  return gcFetch(`/accounts/${gcAccountId}/balances/`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pick the most relevant balance (closingBooked preferred, fallback to first) */
export function pickBalance(balances: GCBalance[]): bigint {
  const preferred = balances.find((b) => b.balanceType === "closingBooked") ?? balances[0];
  if (!preferred) return BigInt(0);
  return BigInt(Math.round(parseFloat(preferred.balanceAmount.amount) * 100));
}

/** Map GoCardless cashAccountType to our AccountType */
export function toAccountType(cashAccountType?: string): "CHECKING" | "SAVINGS" {
  if (!cashAccountType) return "CHECKING";
  const savings = ["SVGS", "LLSV", "NREX", "ONDP"];
  return savings.includes(cashAccountType) ? "SAVINGS" : "CHECKING";
}
