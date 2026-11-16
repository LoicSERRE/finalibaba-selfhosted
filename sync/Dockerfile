# This container intentionally still runs as root (see docker:S6471
# exemption in sonar-project.properties for why: the woob/pytr session state
# persisted below (VOLUME) is a named Docker volume mounted at a root-home
# path, and every already-deployed self-hosted instance's existing volume
# data is owned by root at that path already - switching user here needs a
# one-time ownership migration for already-running deployments, out of scope
# for a lint-driven cleanup pass).
FROM python:3.14-slim

# System deps for woob (lxml, etc.). gpgv stays in the final image (it is not
# in the purge list below): `woob config update` fetches the bank modules at
# every start and verifies their signatures with it - without gpgv present it
# prints "Cannot find gpg or gpgv" and installs them UNVERIFIED, so a tampered
# module repository could ship code into this container. The sync service holds
# NEXTAUTH_SECRET, so that is a path to a forged app session.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev libssl-dev libxml2-dev libxslt1-dev git gpgv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# gcc/g++ (and the headers/libc6-dev/linux-libc-dev they pull in) are only
# needed to compile the native extensions in requirements.txt (woob's lxml,
# cryptography, psycopg2, etc.) - once pip install has produced the compiled
# .so files, the compiler itself is dead weight in the runtime image and a
# real Trivy CVE surface (linux-libc-dev alone accounted for 47 of the
# CRITICAL/HIGH findings on this image before this line was added).
# Verified the compiled extensions still import fine with the toolchain gone.
#
# git is only needed for the `pip install` above - requirements.txt pulls
# pytr from a pinned git commit (PyPI has no release of it), so pip needs git to clone
# it once. Never used again after install. Removing it cascades (via
# autoremove) to perl/liberror-perl/libcurl3t64-gnutls, which nothing else
# here needs either - confirmed via `apt-get remove --dry-run git`.
#
# No browser: Trade Republic's v2 login needs no AWS WAF token, which is all
# Playwright and its Chromium (and the ~70 CRITICAL/HIGH Debian packages they
# pulled in, see #22) were here for.
RUN pip install --no-cache-dir -r requirements.txt && \
    apt-get remove -y --purge gcc g++ libc6-dev linux-libc-dev cpp git \
        libffi-dev libssl-dev libxml2-dev libxslt1-dev && \
    apt-get autoremove -y --purge && \
    rm -rf /var/lib/apt/lists/*

# Trust Woob's module-signing keyring here, once, against a pinned checksum.
# It lives in ~/.local/share/woob, outside the volumes, so every new container
# started without it, and `woob config update` (no TTY) aborts at "The
# repository isn't trusted yet. Are you sure?" without saving it: installing
# any bank module then failed with "No keyring found, please update repos".
# Woob() on a fresh HOME accepts the keyring non-interactively; the checksum
# makes that a pin instead of trust-on-first-use. Later keyring rotations are
# validated by this one (Repository.retrieve_keyring). If Woob rotates it and
# this fails, check the new keyring's provenance before bumping the hash.
ARG WOOB_KEYRING_SHA256=a1755b379793ff4922a7bfb5f566c019205f805b96f3420aee95938cd0d1634a
RUN python -c "from woob.core import Woob; Woob()" && \
    echo "${WOOB_KEYRING_SHA256}  /root/.local/share/woob/keyrings/https___updates_woob_tech_3_main_.gpg" \
        | sha256sum -c -

COPY . .

# Persist woob session + pytr credentials across restarts
VOLUME ["/root/.config/woob", "/root/.pytr"]

EXPOSE 8000
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
# See the FROM line above for why this container deliberately still runs as
# root (same docker:S6471 exemption documented in sonar-project.properties) -
# semgrep's dockerfile.security.missing-user rule flags the same thing.
# A trailing comment on the CMD line itself (rather than here, on its own
# line) confused SonarQube's docker analyzer into misreading this exec-form
# instruction as shell-form (docker:S7019) - confirmed by testing.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["./entrypoint.sh"]
