#!/bin/bash
# Settles one question that cannot be answered without a real account: does a
# captcha bank actually VERIFY the captcha on its own server, or is the widget
# only a gate in the browser?
#
# Why it matters. A bank's reCAPTCHA site key usually restricts which domains
# may render it (Amundi's does), so a self-hosted instance on your own domain
# gets "Domaine non valide pour la clé de site reCAPTCHA" and cannot produce a
# real token at all. If the bank never checks the token, that restriction is
# irrelevant and the sync can work from anywhere. If the bank does check it,
# nothing short of solving it on an origin the key accepts will work.
#
# Probing with a fake account cannot answer this: the login endpoint returns a
# bare "403 Forbidden" for a bad password AND (apparently) for a bad captcha,
# with no message, and Woob's own module collapses both into "wrong password"
# because - in its own words - there is no other way to tell. Only credentials
# that WOULD succeed can separate the two: if the login gets through with a
# placeholder captcha, the captcha was never checked.
#
# READ THIS BEFORE RUNNING. This performs one real login attempt with the
# credentials already stored for that institution. Amundi temporarily blocks an
# account after 3 consecutive failures, and this uses one of them if the captcha
# turns out to be enforced. It is a single attempt, never a retry loop, and it
# stops immediately if the bank reports the account is already blocked. Do not
# run it repeatedly to "see if it works this time".
#
# Nothing is written: no accounts, no transactions, no SyncLog rows.
#
# Usage: ./scripts/probe-captcha-bank.sh <institution-name>
#   e.g. ./scripts/probe-captcha-bank.sh Amundi

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Usage: $0 <institution-name>   (the name as shown in Settings, e.g. Amundi)" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env first." >&2
  exit 1
fi

INSTITUTION_NAME="$1"

echo "This runs ONE real login attempt for \"$INSTITUTION_NAME\" using the"
echo "credentials already saved in Finalibaba, sending a placeholder instead of"
echo "a solved captcha."
echo
echo "If the bank does verify the captcha, this consumes one of the 3 attempts"
echo "before the account is temporarily blocked. Do not re-run it on a whim."
echo
read -r -p "Type the institution name again to confirm: " CONFIRM
if [ "$CONFIRM" != "$INSTITUTION_NAME" ]; then
  echo "Aborted." >&2
  exit 1
fi

docker compose exec -T sync python - "$INSTITUTION_NAME" <<'PY'
import sys

from db import get_conn

name = sys.argv[1]

conn = get_conn()
cur = conn.cursor()
cur.execute(
    'SELECT id, "woobModule", "woobLogin", "woobPassword" FROM "Institution" WHERE name = %s',
    (name,),
)
row = cur.fetchone()
if row is None:
    print(f'No institution named "{name}". Check the exact spelling in Settings.')
    raise SystemExit(1)

institution_id, module, login, password = row[0], row[1], row[2], row[3]
if not module or not login or not password:
    print(f'"{name}" has no Woob credentials saved - configure it in Settings first.')
    raise SystemExit(1)

print(f"institution : {name} (module={module})")
print("attempting one login with a placeholder captcha...\n")

from woob.core import Woob
from woob.exceptions import ActionNeeded, AppValidation, BrowserIncorrectPassword, BrowserUserBanned

w = Woob()
backend_name = f"probe_{institution_id.replace('-', '_')[:20]}"
backend = w.build_backend(
    module,
    {"login": login, "password": password, "captcha_response": "PLACEHOLDER-NOT-A-REAL-CAPTCHA"},
    name=backend_name,
)

try:
    list(backend.iter_accounts())
    print("RESULT: the login SUCCEEDED with a placeholder captcha.")
    print("        The bank does not verify the captcha, so syncing can work")
    print("        from any domain. Tell Claude and it will wire this up.")
except BrowserUserBanned as e:
    print("RESULT: the account is ALREADY temporarily blocked by the bank.")
    print("        Nothing was learned. Wait for the block to lift before retrying.")
    print(f"        ({e})")
except (AppValidation,) as e:
    print("RESULT: the login got PAST the captcha and reached two-factor approval.")
    print("        That means the captcha is not verified server-side, so syncing")
    print("        can work from any domain. Tell Claude and it will wire this up.")
    print(f"        ({str(e)[:150]})")
except BrowserIncorrectPassword:
    print("RESULT: rejected, and the bank does not say why (a bare 403).")
    print("        Either the captcha IS verified, or the stored password is wrong.")
    print("        Check the password is right in Settings; if it is, the captcha")
    print("        is enforced and only an accepted origin can satisfy it.")
except ActionNeeded as e:
    print("RESULT: the bank wants an action on its own site, past the captcha step.")
    print(f"        ({str(e)[:150]})")
except Exception as e:
    print(f"RESULT: unexpected {type(e).__name__}: {str(e)[:200]}")
finally:
    try:
        w.deinit()
    except Exception:
        pass
    conn.close()
PY
