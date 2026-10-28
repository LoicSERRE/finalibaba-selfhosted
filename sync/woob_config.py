"""
What a Woob module needs besides a login and a password, and how it gets it.

Issue #135: the Crédit Agricole module (`cragr`) declares a required `website`
field - which of the 39 regional banks to talk to - with no default. Only
`login` and `password` were ever handed to Woob, so the backend was refused at
load time with "Missing parameter website (Caisse Régionale)" before any
request reached the bank. It was not alone: auditing the 96 CapBank modules of
woob 3.7 found a dozen in the same position - Banque Populaire's region
(`cdetab`), ING's and BforBank's date of birth, CCF's security code, the API
keys of the crypto exchanges, the modules whose identifier is called
`username`. A list of exceptions would be stale on the next Woob release, so
the module's own CONFIG is the source of truth instead: the app asks for
whatever the module declares (GET /woob/modules/{module}/fields), stores the
extra values encrypted next to the password, and they come back here as a
plain dict.

Parameters reach Woob in memory through `load_backend(params=...)`. They used
to be written to `~/.config/woob/backends`, in clear, on the persistent
woob_session volume - the encrypted-at-rest database columns were decrypted
only to be copied to disk unencrypted, and a value containing a newline could
add keys of its own to that INI file. Nothing user-supplied touches that file
now, and purge_legacy_backends() removes what earlier versions left there.
"""

from __future__ import annotations

import datetime
import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

# Woob module names are lowercase identifiers. Anything else is refused before
# it reaches the repository lookup - it ends up in a URL path on the app side.
MODULE_NAME_RE = re.compile(r"^[a-z0-9_]{1,64}$")
# Config field ids, same shape. A stored key that does not look like one is not
# something a module declared.
FIELD_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
# Generous for any real credential, small enough that nobody stores a payload.
MAX_VALUE_LENGTH = 512
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

# Kept in their own encrypted columns (woobLogin/woobPassword), never in the
# extra config.
CREDENTIAL_IDS = ("login", "password")

# The backend names this service gives institutions (see sync_woob.run).
_INSTITUTION_SECTION = re.compile(r"^\[inst_[A-Za-z0-9_]*\]\s*$")
_BACKENDS_FILE = Path.home() / ".config" / "woob" / "backends"


class InvalidConfigValue(Exception):
    """A stored value Woob must not be handed. Carries the field id only -
    never the value, which may be a password."""

    def __init__(self, field_id: str):
        super().__init__(field_id)
        self.field_id = field_id


def is_valid_module_name(name) -> bool:
    return isinstance(name, str) and bool(MODULE_NAME_RE.match(name))


def _kind(value) -> str:
    from woob.tools.value import ValueBool, ValueDate

    if isinstance(value, ValueBool):
        return "bool"
    if isinstance(value, ValueDate):
        return "date"
    if value.choices:
        return "choice"
    if value.masked:
        return "secret"
    return "text"


def _default(value, kind: str):
    # A secret's default is never sent anywhere, even an empty one.
    if kind == "secret" or value.default is None:
        return None
    if kind == "bool":
        return "y" if value.default else "n"
    if isinstance(value.default, (str, int, float)):
        return str(value.default)
    return None


def describe_fields(config) -> list[dict]:
    """The fields a person may have to fill in for this module, in the order
    the module declares them. Transient fields (OTP codes, captcha answers,
    `resume`) are left out: they belong to the interactive setup, not to the
    stored configuration."""
    fields = []
    for field_id, value in config.items():
        if value.transient:
            continue
        kind = _kind(value)
        choices = []
        if kind == "choice":
            items = value.choices.items() if hasattr(value.choices, "items") else ((c, c) for c in value.choices)
            choices = [{"value": str(k), "label": str(v)} for k, v in items]
        fields.append(
            {
                "id": field_id,
                "label": str(value.label or field_id),
                "kind": kind,
                "required": bool(value.required),
                "default": _default(value, kind),
                "choices": choices,
                "regexp": value.regexp if isinstance(value.regexp, str) else None,
            }
        )
    return fields


def parse_stored(raw) -> dict[str, str]:
    """Institution.woobConfig, already decrypted, as a dict. Anything that is
    not a flat string-to-string object is ignored rather than half-used - and
    reported without its content, which may hold a secret."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        log.warning("woobConfig is not valid JSON - ignored")
        return {}
    if not isinstance(data, dict) or not all(
        isinstance(k, str) and FIELD_ID_RE.match(k) and isinstance(v, str) for k, v in data.items()
    ):
        log.warning("woobConfig is not a flat object of field ids to strings - ignored")
        return {}
    return data


def credentials(row) -> tuple:
    """(module, login, password, extra) from a decrypted Institution row that
    selected the four woob* columns - the argument list sync_woob.run takes
    after the institution's id and name, built in one place for each of the
    paths that read a row."""
    return row["woobModule"], row["woobLogin"], row["woobPassword"], parse_stored(row["woobConfig"])


def _check(field_id: str, value, declared_as) -> None:
    if not isinstance(value, str) or len(value) > MAX_VALUE_LENGTH or _CONTROL_CHARS.search(value):
        raise InvalidConfigValue(field_id)
    if value and _kind(declared_as) == "date":
        # Checked here rather than left to Woob: in woob 3.7 an impossible
        # date (30 February) does not raise ConfigError but a TypeError from
        # ValueDate's own error message, which formats a tuple with `%`.
        try:
            datetime.date.fromisoformat(value)
        except ValueError:
            raise InvalidConfigValue(field_id) from None


def build_params(config, login, password, extra: dict | None) -> dict[str, str]:
    """What load_backend receives: the credentials the module declares, and
    the stored extra values it still declares. A key the module no longer
    knows (renamed upstream) is dropped and logged by name - Woob would ignore
    it anyway, and refusing the whole backend over it would break a working
    bank on a module update."""
    declared = {field_id for field_id, value in config.items() if not value.transient}
    params: dict[str, str] = {}
    for field_id, value in (("login", login), ("password", password)):
        if field_id in declared and value is not None:
            params[field_id] = value
    for field_id, value in (extra or {}).items():
        if field_id in CREDENTIAL_IDS or field_id not in declared:
            log.warning("stored Woob config key %r is not declared by the module - ignored", field_id)
            continue
        params[field_id] = value
    for field_id, value in params.items():
        _check(field_id, value, config[field_id])
    return params


def _labels(config, field_ids) -> list[str]:
    labels = []
    for field_id in field_ids:
        value = config.get(field_id) if hasattr(config, "get") else None
        labels.append(str(getattr(value, "label", None) or field_id))
    return labels


def explain(config, field_ids) -> str:
    """The sentence shown to the user for a configuration Woob refused. Names
    the fields by the module's own labels and nothing else: Woob's own message
    can quote the rejected value, which may be a password."""
    labels = _labels(config, field_ids)
    what = f" : {', '.join(labels)}" if labels else ""
    return (
        f"La configuration de cette banque est incomplète ou invalide{what}. "
        "Ouvre Réglages, puis « Synchro configurée » sur cette institution, "
        "pour la compléter."
    )


def purge_legacy_backends(path: Path = _BACKENDS_FILE) -> int:
    """Remove the per-institution sections earlier versions wrote to Woob's
    backends file, credentials in clear. Sections this service did not name
    (`[lcl]`, written by the .env-configured LCL sync) are left alone. Returns
    how many sections were removed, so the caller can log it."""
    if not path.exists():
        return 0
    kept, removed, skipping = [], 0, False
    for line in path.read_text().splitlines(keepends=True):
        if line.startswith("["):
            skipping = bool(_INSTITUTION_SECTION.match(line))
            removed += skipping
        if not skipping:
            kept.append(line)
    if removed:
        path.write_text("".join(kept))
        path.chmod(0o600)
    return removed
