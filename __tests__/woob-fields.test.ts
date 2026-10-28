import { describe, expect, it } from "vitest";
import {
  MAX_WOOB_VALUE_LENGTH,
  declaresWoobCredential,
  extraWoobFields,
  isWoobModuleName,
  parseWoobFields,
  validateWoobCredentials,
  woobExtraFromFormData,
  type WoobField,
} from "@/lib/domain/woob-fields";

/**
 * Issue #135: a Woob module can need more than a login and a password - the
 * Crédit Agricole region, ING's date of birth, an exchange's API keys. These
 * are the rules a submitted form is held to before anything is stored; the
 * shapes mirror what sync/woob_config.py's describe_fields returns for the
 * real modules.
 */

const field = (over: Partial<WoobField> & Pick<WoobField, "id" | "kind">): WoobField => ({
  label: over.id,
  required: true,
  default: null,
  choices: [],
  regexp: null,
  ...over,
});

const CRAGR: WoobField[] = [
  field({
    id: "website",
    kind: "choice",
    label: "Caisse Régionale",
    choices: [
      { value: "www.ca-alpesprovence.fr", label: "Alpes Provence (www.ca-alpesprovence.fr)" },
      { value: "www.ca-sudrhonealpes.fr", label: "Sud Rhône Alpes (www.ca-sudrhonealpes.fr)" },
    ],
  }),
  field({ id: "login", kind: "text", regexp: "^\\d{11}$" }),
  field({ id: "password", kind: "secret", regexp: "^\\d{6}$" }),
];
const ING: WoobField[] = [
  field({ id: "login", kind: "text" }),
  field({ id: "password", kind: "secret" }),
  field({ id: "birthday", kind: "date", label: "Date de naissance" }),
  field({ id: "rotating", kind: "bool", required: false, default: "n" }),
];
const BINANCE: WoobField[] = [field({ id: "api_key", kind: "text" }), field({ id: "secret_key", kind: "secret" })];

const input = (login: string, password: string, extra: Record<string, string> = {}) => ({ login, password, extra });

describe("validateWoobCredentials", () => {
  it("accepts the Crédit Agricole case once the region is given", () => {
    const r = validateWoobCredentials(CRAGR, input("12345678901", "123456", { website: "www.ca-sudrhonealpes.fr" }));
    expect(r).toEqual({
      ok: true,
      value: { login: "12345678901", password: "123456", extra: { website: "www.ca-sudrhonealpes.fr" } },
    });
  });

  it("refuses it without the region, naming the field", () => {
    expect(validateWoobCredentials(CRAGR, input("12345678901", "123456"))).toEqual({
      ok: false,
      error: "missing_field",
      field: "website",
    });
  });

  it("refuses a region that is not one of the module's", () => {
    const r = validateWoobCredentials(CRAGR, input("12345678901", "123456", { website: "evil.example" }));
    expect(r).toMatchObject({ ok: false, error: "invalid_value", field: "website" });
  });

  it("accepts a module default that is not one of the choices", () => {
    const fields = [
      field({ id: "login", kind: "text" }),
      field({ id: "password", kind: "secret" }),
      field({ id: "auth_type", kind: "choice", required: false, default: "auto", choices: [{ value: "part", label: "P" }] }),
    ];
    expect(validateWoobCredentials(fields, input("l", "p", { auth_type: "auto" }))).toMatchObject({ ok: true });
    expect(validateWoobCredentials(fields, input("l", "p", { auth_type: "other" }))).toMatchObject({ ok: false });
  });

  it("applies the module's own regexp, to the login and password too", () => {
    expect(validateWoobCredentials(CRAGR, input("1234", "123456", { website: "www.ca-sudrhonealpes.fr" }))).toMatchObject({
      ok: false,
      error: "invalid_value",
      field: "login",
    });
    const bad = validateWoobCredentials(
      [...CRAGR, field({ id: "security_code", kind: "secret", regexp: "^\\d{5}$" })],
      input("12345678901", "123456", { website: "www.ca-sudrhonealpes.fr", security_code: "12ab5" }),
    );
    expect(bad).toMatchObject({ ok: false, error: "invalid_value", field: "security_code" });
  });

  it("refuses a field the module does not declare", () => {
    const r = validateWoobCredentials(CRAGR, input("12345678901", "123456", { website: "www.ca-sudrhonealpes.fr", _module: "x" }));
    expect(r).toMatchObject({ ok: false, error: "unknown_field", field: "_module" });
  });

  it("never lets the login or password be overridden through the extra fields", () => {
    const r = validateWoobCredentials(CRAGR, input("12345678901", "123456", { website: "www.ca-sudrhonealpes.fr", login: "x" }));
    expect(r).toMatchObject({ ok: false, error: "unknown_field", field: "login" });
  });

  it.each(["1990-02-30", "31/01/1990", "1990-1-31", "soon"])("refuses %s as a date of birth", (bad) => {
    expect(validateWoobCredentials(ING, input("l", "p", { birthday: bad }))).toMatchObject({
      ok: false,
      error: "invalid_value",
      field: "birthday",
    });
  });

  it("accepts a real date, and leaves an optional field to its default", () => {
    const r = validateWoobCredentials(ING, input("l", "p", { birthday: "1990-01-31", rotating: "" }));
    expect(r).toEqual({ ok: true, value: { login: "l", password: "p", extra: { birthday: "1990-01-31" } } });
  });

  it("accepts only y/n for a yes/no field", () => {
    expect(validateWoobCredentials(ING, input("l", "p", { birthday: "1990-01-31", rotating: "true" }))).toMatchObject({
      ok: false,
      field: "rotating",
    });
  });

  it.each(["line\nbreak", "tab\there", "nul\u0000", "x".repeat(MAX_WOOB_VALUE_LENGTH + 1)])(
    "refuses a control character or an oversized value (%#)",
    (bad) => {
      expect(validateWoobCredentials(ING, input("l", bad, { birthday: "1990-01-31" }))).toMatchObject({
        ok: false,
        error: "invalid_value",
        field: "password",
      });
    },
  );

  it("does not ask for a login a module does not declare", () => {
    const r = validateWoobCredentials(BINANCE, input("", "", { api_key: "k", secret_key: "s" }));
    expect(r).toEqual({ ok: true, value: { login: null, password: null, extra: { api_key: "k", secret_key: "s" } } });
  });

  it("still requires login and password a module declares", () => {
    expect(validateWoobCredentials(CRAGR, input("", "123456", { website: "www.ca-sudrhonealpes.fr" }))).toMatchObject({
      ok: false,
      error: "missing_credentials",
    });
  });

  it("falls back to login and password only when the field list is unknown, refusing anything else", () => {
    expect(validateWoobCredentials(null, input("u", "p"))).toEqual({ ok: true, value: { login: "u", password: "p", extra: {} } });
    expect(validateWoobCredentials(null, input("u", "p", { website: "x" }))).toEqual({ ok: false, error: "fields_unavailable" });
  });

  it("keeps a secret exactly as typed but trims the rest", () => {
    const r = validateWoobCredentials(
      [...BINANCE],
      input("", "", { api_key: "  k  ", secret_key: " s " }),
    );
    expect(r).toMatchObject({ ok: true, value: { extra: { api_key: "k", secret_key: " s " } } });
  });
});

describe("module names", () => {
  it.each(["cragr", "banquepopulaire", "bnp_porc2"])("accepts %s", (name) => expect(isWoobModuleName(name)).toBe(true));
  it.each(["", "../health", "cragr/fields", "CRAGR", "a b", "x".repeat(65), 42])("refuses %s", (name) =>
    expect(isWoobModuleName(name)).toBe(false),
  );
});

describe("parseWoobFields", () => {
  it("keeps well-formed fields and drops the rest", () => {
    const parsed = parseWoobFields({
      fields: [
        { id: "website", label: "Caisse Régionale", kind: "choice", required: true, default: null, choices: [{ value: "a", label: "A" }, { bad: 1 }] },
        { id: "Bad-Id", kind: "text" },
        { id: "x", kind: "html" },
        "nope",
        { id: "pin", kind: "secret", required: true, default: "0000" },
      ],
    });
    expect(parsed?.map((f) => f.id)).toEqual(["website", "pin"]);
    expect(parsed?.[0].choices).toEqual([{ value: "a", label: "A" }]);
    expect(parsed?.[1].default).toBeNull();
  });

  it("is null for anything that is not a field list", () => {
    expect(parseWoobFields(null)).toBeNull();
    expect(parseWoobFields({ error: "unknown_module" })).toBeNull();
  });
});

describe("form helpers", () => {
  it("splits the credentials from the extra fields", () => {
    expect(extraWoobFields(CRAGR).map((f) => f.id)).toEqual(["website"]);
    expect(declaresWoobCredential(BINANCE, "login")).toBe(false);
    expect(declaresWoobCredential(null, "login")).toBe(true);
  });

  it("reads only the woobConfig.* entries of a form", () => {
    const fd = new FormData();
    fd.set("name", "Crédit Agricole");
    fd.set("woobLogin", "12345678901");
    fd.set("woobConfig.website", "www.ca-sudrhonealpes.fr");
    expect(woobExtraFromFormData(fd)).toEqual({ website: "www.ca-sudrhonealpes.fr" });
  });
});
