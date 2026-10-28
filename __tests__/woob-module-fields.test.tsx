// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { WoobField } from "@/lib/domain/woob-fields";

/**
 * Issue #135: the form asks for whatever the Woob module declares - the
 * Crédit Agricole region as a select, ING's date of birth as a date. These
 * pin the inputs the Server Action reads (`woobConfig.<id>`), and that the
 * field list follows the picked module without ever showing a stale one.
 */

// Echoes interpolation values, so a message that lost its {field} shows it.
const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock("next-intl", () => ({ useTranslations: () => translate }));

const getWoobModuleFields = vi.fn<(module: string) => Promise<WoobField[] | null>>();
vi.mock("@/lib/actions/sync", () => ({ getWoobModuleFields: (m: string) => getWoobModuleFields(m) }));

import { WoobExtraFields, useWoobErrorMessage, useWoobModuleFields } from "@/components/settings/woob-module-fields";

const field = (over: Partial<WoobField> & Pick<WoobField, "id" | "kind">): WoobField => ({
  label: over.id,
  required: true,
  default: null,
  choices: [],
  regexp: null,
  ...over,
});

const REGION = field({
  id: "website",
  kind: "choice",
  label: "Caisse Régionale",
  choices: [
    { value: "www.ca-alpesprovence.fr", label: "Alpes Provence" },
    { value: "www.ca-sudrhonealpes.fr", label: "Sud Rhône Alpes" },
  ],
});

afterEach(() => {
  cleanup();
  getWoobModuleFields.mockReset();
});

describe("WoobExtraFields", () => {
  it("keeps a module default that is not one of the choices instead of the first entry", () => {
    // Caisse d'Epargne's auth_type: default "", choices part/pp/pro/ent.
    render(
      <WoobExtraFields
        idPrefix="t"
        fields={[
          field({
            id: "auth_type",
            kind: "choice",
            label: "Type de compte",
            required: false,
            default: "",
            choices: [{ value: "part", label: "Particulier" }, { value: "pro", label: "Professionnel" }],
          }),
        ]}
      />,
    );
    const select = screen.getByLabelText("Type de compte") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe("moduleDefault");
  });

  it("renders the region as a required select the user has to pick from", () => {
    render(<WoobExtraFields fields={[REGION]} idPrefix="t" />);
    const select = screen.getByLabelText("Caisse Régionale") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.name).toBe("woobConfig.website");
    expect(select.required).toBe(true);
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.value)).toEqual(["", "www.ca-alpesprovence.fr", "www.ca-sudrhonealpes.fr"]);
  });

  it("renders a date, a secret, a yes/no and a defaulted choice with the right inputs", () => {
    render(
      <WoobExtraFields
        idPrefix="t"
        fields={[
          field({ id: "birthday", kind: "date", label: "Date de naissance" }),
          field({ id: "security_code", kind: "secret", label: "Code de sécurité" }),
          field({ id: "rotating", kind: "bool", label: "Renouveler", required: false, default: "n" }),
          field({ ...REGION, id: "website", required: false, default: "www.ca-sudrhonealpes.fr" }),
        ]}
      />,
    );
    const date = screen.getByLabelText("Date de naissance") as HTMLInputElement;
    expect([date.type, date.name, date.required]).toEqual(["date", "woobConfig.birthday", true]);
    const secret = screen.getByLabelText("Code de sécurité") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.autocomplete).toBe("off");
    expect((screen.getByLabelText("Renouveler") as HTMLSelectElement).value).toBe("n");
    // A default means no "choose" placeholder and nothing left to require.
    const region = screen.getByLabelText("Caisse Régionale") as HTMLSelectElement;
    expect(region.value).toBe("www.ca-sudrhonealpes.fr");
    expect(region.required).toBe(false);
    expect([...region.options].some((o) => o.value === "")).toBe(false);
  });
});

function Probe({ module }: Readonly<{ module: string | null }>) {
  const { fields, loading } = useWoobModuleFields(module);
  return <output data-testid="probe">{loading ? "loading" : JSON.stringify(fields?.map((f) => f.id) ?? null)}</output>;
}

describe("useWoobModuleFields", () => {
  it("loads the picked module's fields", async () => {
    getWoobModuleFields.mockResolvedValue([REGION]);
    render(<Probe module="cragr" />);
    expect(screen.getByTestId("probe").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe('["website"]'));
    expect(getWoobModuleFields).toHaveBeenCalledWith("cragr");
  });

  it("asks for nothing when there is no valid module", () => {
    render(<Probe module="Not A Module" />);
    expect(screen.getByTestId("probe").textContent).toBe("null");
    expect(getWoobModuleFields).not.toHaveBeenCalled();
  });

  it("never shows the previous module's fields after a switch", async () => {
    let releaseFirst: (v: WoobField[]) => void = () => {};
    getWoobModuleFields
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce([field({ id: "birthday", kind: "date" })]);
    const { rerender } = render(<Probe module="cragr" />);
    await waitFor(() => expect(getWoobModuleFields).toHaveBeenCalledTimes(1));
    rerender(<Probe module="ing" />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe('["birthday"]'));
    // The first request answers late: it must not overwrite the second.
    releaseFirst([REGION]);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("probe").textContent).toBe('["birthday"]');
  });

  it("shows nothing of the previous module while the next one loads", async () => {
    getWoobModuleFields.mockResolvedValueOnce([REGION]).mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = render(<Probe module="cragr" />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe('["website"]'));
    rerender(<Probe module="ing" />);
    // The region select must not linger under ING while its fields load.
    expect(screen.getByTestId("probe").textContent).toBe("loading");
  });

  it("falls back to null when the sync service cannot answer", async () => {
    getWoobModuleFields.mockRejectedValue(new Error("down"));
    render(<Probe module="cragr" />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("null"));
  });
});

describe("useWoobErrorMessage", () => {
  function Message() {
    const message = useWoobErrorMessage();
    return <p>{message("missing_field", "website", [REGION])}</p>;
  }

  it("names the field by the module's own label", () => {
    render(<Message />);
    expect(screen.getByText('missing_field:{"field":"Caisse Régionale"}')).toBeTruthy();
  });
});
