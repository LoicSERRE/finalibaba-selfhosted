/**
 * The one path every Woob config write goes through (issue #135).
 *
 * Asks the sync service what the module declares, checks the submitted values
 * against that, and returns the Institution columns ready to write, encrypted.
 * A plain module rather than a "use server" file: it is called by
 * createInstitution and setWoobConfig, never by a client.
 */
import { encryptSecret } from "@/lib/domain/crypto-at-rest";
import {
  isWoobModuleName,
  parseWoobFields,
  validateWoobCredentials,
  type WoobCredentialError,
  type WoobCredentialInput,
  type WoobField,
} from "@/lib/domain/woob-fields";

// Internal Docker Compose service-to-service traffic on a private bridge
// network, never exposed externally - same reasoning as lib/actions/sync.ts.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const SYNC_URL = process.env.SYNC_SERVICE_URL ?? "http://sync:8000";
// Describing a module may install it first; a few seconds is plenty, and the
// form must not hang on a sync service that is down.
const FIELDS_TIMEOUT_MS = 15_000;

/**
 * The fields this module declares, or null when the sync service cannot say:
 * unreachable (local dev without it), the module unknown, or one it cannot
 * load. The module name is checked before it becomes part of a URL.
 */
export async function fetchWoobModuleFields(module: string): Promise<WoobField[] | null> {
  if (!isWoobModuleName(module)) return null;
  try {
    const res = await fetch(`${SYNC_URL}/woob/modules/${module}/fields`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FIELDS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseWoobFields(await res.json());
  } catch {
    return null;
  }
}

export type WoobColumns = {
  woobModule: string;
  woobLogin: string | null;
  woobPassword: string | null;
  woobConfig: string | null;
};

export type PreparedWoobColumns =
  | { ok: true; columns: WoobColumns }
  | { ok: false; error: WoobCredentialError; field?: string };

/** The Institution columns for this module and these values, or why not. */
export async function prepareWoobColumns(module: string, input: WoobCredentialInput): Promise<PreparedWoobColumns> {
  if (!isWoobModuleName(module)) return { ok: false, error: "invalid_module" };
  const checked = validateWoobCredentials(await fetchWoobModuleFields(module), input);
  if (!checked.ok) return checked;
  const { login, password, extra } = checked.value;
  return {
    ok: true,
    columns: {
      woobModule: module,
      // Encrypted at rest: these are somebody else's bank credentials, and
      // before v2.10.5 one SELECT returned every invited user's in clear.
      woobLogin: login === null ? null : encryptSecret(login),
      woobPassword: password === null ? null : encryptSecret(password),
      // As a whole, not per field: which of them are secrets depends on the
      // module, and a date of birth is personal data either way.
      woobConfig: Object.keys(extra).length > 0 ? encryptSecret(JSON.stringify(extra)) : null,
    },
  };
}
