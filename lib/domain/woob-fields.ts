/**
 * What a Woob module asks for, and whether a submitted form gives it that.
 *
 * Issue #135: Crédit Agricole's module needs the regional bank (`website`),
 * Banque Populaire's its region, ING and BforBank a date of birth, a few
 * exchanges API keys instead of a login. The sync service reads that list from
 * the module's own CONFIG (sync/woob_config.py, GET /woob/modules/{m}/fields),
 * so a new Woob release needs no change here. This file only decides whether a
 * submitted form matches it - pure, so the same rules run in tests, and the
 * Server Action is the one that enforces them.
 */

export type WoobFieldKind = "text" | "secret" | "choice" | "date" | "bool";

export type WoobField = {
  id: string;
  label: string;
  kind: WoobFieldKind;
  required: boolean;
  /** Never set for a secret. "y"/"n" for a bool. */
  default: string | null;
  choices: { value: string; label: string }[];
  /** Python syntax; checked here only when JavaScript reads it the same way. */
  regexp: string | null;
};

export const WOOB_MODULE_RE = /^[a-z0-9_]{1,64}$/;
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const KINDS: readonly WoobFieldKind[] = ["text", "secret", "choice", "date", "bool"];
/** Mirrors sync/woob_config.py's MAX_VALUE_LENGTH. */
export const MAX_WOOB_VALUE_LENGTH = 512;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stored in woobLogin/woobPassword, never in the extra config. */
export const WOOB_CREDENTIAL_IDS = ["login", "password"] as const;

export function isWoobModuleName(value: unknown): value is string {
  return typeof value === "string" && WOOB_MODULE_RE.test(value);
}

/** The fields shown besides login and password. */
export function extraWoobFields(fields: readonly WoobField[]): WoobField[] {
  return fields.filter((f) => !(WOOB_CREDENTIAL_IDS as readonly string[]).includes(f.id));
}

/** Whether the form should ask for `login` (or `password`). With no field
 *  list - the sync service unreachable - both, as before issue #135. */
export function declaresWoobCredential(fields: readonly WoobField[] | null, id: "login" | "password"): boolean {
  return fields === null || fields.some((f) => f.id === id);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseField(raw: unknown): WoobField | null {
  if (!isRecord(raw)) return null;
  const { id, label, kind, required, choices, regexp } = raw;
  if (typeof id !== "string" || !FIELD_ID_RE.test(id)) return null;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return null;
  const parsedChoices = Array.isArray(choices)
    ? choices.filter(
        (c): c is { value: string; label: string } =>
          isRecord(c) && typeof c.value === "string" && typeof c.label === "string",
      )
    : [];
  return {
    id,
    label: typeof label === "string" && label ? label : id,
    kind: kind as WoobFieldKind,
    required: required === true,
    default: kind !== "secret" && typeof raw.default === "string" ? raw.default : null,
    choices: parsedChoices.map((c) => ({ value: c.value, label: c.label })),
    regexp: typeof regexp === "string" ? regexp : null,
  };
}

/** The sync service's answer, checked field by field: it is trusted, but a
 *  malformed entry must not become a form input or a validation rule. */
export function parseWoobFields(payload: unknown): WoobField[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.fields)) return null;
  const fields: WoobField[] = [];
  for (const raw of payload.fields) {
    const field = parseField(raw);
    if (field) fields.push(field);
  }
  return fields;
}

export type WoobCredentialError =
  | "invalid_module"
  | "missing_credentials"
  | "invalid_value"
  | "missing_field"
  | "unknown_field"
  | "fields_unavailable";

export type WoobCredentialInput = {
  login: string;
  password: string;
  /** Field id to value, as submitted. Empty values are dropped. */
  extra: Record<string, string>;
};

export type ValidWoobCredentials = {
  login: string | null;
  password: string | null;
  extra: Record<string, string>;
};

type Result =
  | { ok: true; value: ValidWoobCredentials }
  | { ok: false; error: WoobCredentialError; field?: string };

function cleanValue(value: string): string | null {
  if (value.length > MAX_WOOB_VALUE_LENGTH || CONTROL_CHARS.test(value)) return null;
  return value;
}

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The module's own regexp, when JavaScript can read it. One it cannot is
 *  left to Woob, which checks every value again when it loads the backend. */
function matchesRegexp(field: WoobField, value: string): boolean {
  if (!field.regexp) return true;
  let re: RegExp;
  try {
    re = new RegExp(field.regexp);
  } catch {
    return true;
  }
  return re.test(value);
}

function checkExtra(field: WoobField, value: string): boolean {
  switch (field.kind) {
    case "choice":
      // The module's own default is valid even outside the list - Woob
      // accepts a value equal to the default without checking it.
      return value === field.default || field.choices.some((c) => c.value === value);
    case "bool":
      return value === "y" || value === "n";
    case "date":
      return isCalendarDate(value);
    default:
      return matchesRegexp(field, value);
  }
}

function checkCredential(fields: readonly WoobField[] | null, id: "login" | "password", raw: string) {
  if (!declaresWoobCredential(fields, id)) return { ok: true as const, value: null };
  if (!raw) return { ok: false as const, error: "missing_credentials" as const, field: id };
  // The module's format ("Identifiant à 11 chiffres") is checked now rather
  // than reported by the next sync, half an hour later.
  const declared = fields?.find((f) => f.id === id);
  if (cleanValue(raw) === null || (declared && !matchesRegexp(declared, raw))) {
    return { ok: false as const, error: "invalid_value" as const, field: id };
  }
  return { ok: true as const, value: raw };
}

type ExtrasResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: WoobCredentialError; field?: string };

function checkExtras(fields: readonly WoobField[], extra: Record<string, string>): ExtrasResult {
  const declared = new Map(extraWoobFields(fields).map((f) => [f.id, f]));
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(extra)) {
    const field = declared.get(id);
    if (!field) return { ok: false, error: "unknown_field", field: id };
    const value = field.kind === "secret" ? raw : raw.trim();
    if (!value) continue;
    if (cleanValue(value) === null || !checkExtra(field, value)) return { ok: false, error: "invalid_value", field: id };
    out[id] = value;
  }
  for (const field of declared.values()) {
    if (field.required && field.default === null && !(field.id in out)) {
      return { ok: false, error: "missing_field", field: field.id };
    }
  }
  return { ok: true, value: out };
}

/**
 * Whether a submitted Woob form is complete and well-formed for this module.
 * `fields` null means the sync service could not say what the module needs:
 * only a login and a password are accepted then, as before issue #135, and
 * any extra value is refused rather than stored unchecked.
 */
export function validateWoobCredentials(fields: readonly WoobField[] | null, input: WoobCredentialInput): Result {
  const login = checkCredential(fields, "login", input.login.trim());
  if (!login.ok) return login;
  const password = checkCredential(fields, "password", input.password);
  if (!password.ok) return password;

  const submitted = Object.entries(input.extra).filter(([, v]) => v !== "");
  if (fields === null) {
    return submitted.length > 0
      ? { ok: false, error: "fields_unavailable" }
      : { ok: true, value: { login: login.value, password: password.value, extra: {} } };
  }
  const extra = checkExtras(fields, Object.fromEntries(submitted));
  if (!extra.ok) return extra;
  return { ok: true, value: { login: login.value, password: password.value, extra: extra.value } };
}

/** Form inputs for the extra fields are named `woobConfig.<field id>`. */
export const WOOB_EXTRA_PREFIX = "woobConfig.";

/** Pulls the extra fields out of a submitted form. */
export function woobExtraFromFormData(formData: FormData): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(WOOB_EXTRA_PREFIX) && typeof value === "string") extra[key.slice(WOOB_EXTRA_PREFIX.length)] = value;
  }
  return extra;
}
