import { randomBytes } from "node:crypto";

// Same 256-bit entropy convention as lib/domain/share-links.ts's
// generateShareToken() - unguessable by construction, no rate limiting
// needed the way lib/auth.ts's login path does. The "fnlb_" prefix is
// purely cosmetic/recognizability (so a pasted value is identifiable as a
// Finalibaba API key at a glance, and so automated secret-scanners that key
// off a recognizable prefix have something to match) - it plays no role in
// validation, which only ever compares the full token against the DB.
export function generateApiKeyToken(): string {
  return `fnlb_${randomBytes(32).toString("base64url")}`;
}
