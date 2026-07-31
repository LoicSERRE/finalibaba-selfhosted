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
RUN pip install --no-cache-dir -r requirements.txt && \
    playwright install --with-deps chromium && \
    apt-get remove -y --purge gcc g++ libc6-dev linux-libc-dev cpp cpp-12 && \
    apt-get autoremove -y --purge && \
    rm -rf /var/lib/apt/lists/*

COPY . .

# Persist woob session + pytr credentials across restarts
VOLUME ["/root/.config/woob", "/root/.pytr"]

EXPOSE 8000
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
