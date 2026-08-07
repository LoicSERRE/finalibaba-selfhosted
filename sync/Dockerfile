# This container intentionally still runs as root (see docker:S6471
# exemption in sonar-project.properties for why: the woob/pytr session state
# persisted below (VOLUME) is a named Docker volume mounted at a root-home
# path, and every already-deployed self-hosted instance's existing volume
# data is owned by root at that path already - switching user here needs a
# one-time ownership migration for already-running deployments, out of scope
# for a lint-driven cleanup pass).
FROM python:3.14-slim

# System deps for woob (lxml, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev libssl-dev libxml2-dev libxslt1-dev git \
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
# pytr from a pinned git commit (no PyPI release), so pip needs git to clone
# it once. Never used again after install. Removing it cascades (via
# autoremove) to perl/liberror-perl/libcurl3t64-gnutls, which nothing else
# here needs either - confirmed via `apt-get remove --dry-run git`.
#
# xvfb/xserver-common come bundled with `playwright install --with-deps
# chromium`, which installs the union of headed- and headless-Chromium
# system deps. This project only ever launches Chromium headless (see
# setup_tr.py) and never starts an X server - grep confirms Xvfb/DISPLAY are
# never referenced anywhere in sync/. Removing xvfb/xserver-common cascades
# to the Mesa GL/Vulkan/X11-window-manager stack they alone pulled in
# (chromium's own ldd output doesn't reference libGL/libEGL - it ships its
# own software renderer for headless use).
#
# Verified all of the above together, not just individually: after removing
# git+xvfb+xserver-common (and everything autoremove cascades from them),
# headless Chromium still launches, executes JS, renders a canvas, and
# produces a correct screenshot - cut CRITICAL/HIGH Trivy findings on this
# image roughly in half (66 -> 33). The remaining ones are either genuine
# Chromium runtime deps (libglib2.0, libblkid1/libmount1 - present in its
# own ldd output) or Debian-essential base packages (perl-base: apt itself
# refuses to remove it without --allow-remove-essential) - see #22 for the
# full investigation and why those are left alone.
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install --with-deps chromium && \
    apt-get remove -y --purge gcc g++ libc6-dev linux-libc-dev cpp cpp-12 \
        git xvfb xserver-common && \
    apt-get autoremove -y --purge && \
    rm -rf /var/lib/apt/lists/*

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
