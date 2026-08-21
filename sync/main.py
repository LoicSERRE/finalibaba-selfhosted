"""
Sync service - FastAPI + APScheduler

Endpoints (internal Docker network only, not exposed externally):
  POST /sync/lcl            → trigger LCL sync
  POST /sync/trade-republic → trigger Trade Republic sync
  POST /sync/institution/{id} → trigger Woob sync for a specific institution
  GET  /woob/modules        → list every Woob module capable of bank sync
  GET  /status              → last sync logs per source

Cron: every 4 hours
"""
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import psycopg2
import psycopg2.extras
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
log = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=2)
scheduler = AsyncIOScheduler()

_lcl_lock = threading.Lock()
_tr_lock = threading.Lock()


# ── Sync runners ──────────────────────────────────────────────────────────────

def _run_lcl():
    if not os.environ.get("LCL_LOGIN"):
        log.info("LCL_LOGIN not set - LCL sync disabled")
        return
    if not _lcl_lock.acquire(blocking=False):
        log.info("LCL sync already in progress - skipped")
        return
    try:
        import sync_lcl
        result = sync_lcl.run()
        log.info("LCL sync done: %s", result)
    except Exception:
        # Broad on purpose - this is a scheduled background job, an unhandled
        # exception here must not kill the scheduler thread. log.exception
        # captures the traceback (bare log.error(..., e) previously logged
        # only str(e), losing exactly the info needed to tell "woob module
        # broke" from "DB unreachable" from "actual code bug" in `docker
        # compose logs`).
        log.exception("LCL sync failed")
    finally:
        _lcl_lock.release()


def _run_tr():
    if not os.environ.get("TR_PHONE"):
        log.info("TR_PHONE not set - Trade Republic sync disabled")
        return
    if not _tr_lock.acquire(blocking=False):
        log.info("TR sync already in progress - skipped")
        return
    try:
        import sync_tr
        result = sync_tr.run()
        log.info("TR sync done: %s", result)
    except Exception:
        log.exception("TR sync failed")
    finally:
        _tr_lock.release()


def _keepalive_tr():
    if not os.environ.get("TR_PHONE"):
        return
    try:
        import sync_tr
        sync_tr.keepalive()
    except Exception:
        log.warning("TR keepalive failed", exc_info=True)


def _run_woob_institution(inst_id: str, inst_name: str, module: str, login: str, password: str):
    try:
        import sync_woob
        result = sync_woob.run(inst_id, inst_name, module, login, password)
        log.info("Woob sync done for %s: %s", inst_name, result)
    except sync_woob.AuthRequiredError:
        pass  # already written to SyncLog inside sync_woob.run()
    except Exception as e:
        log.exception("Woob sync failed for %s", inst_name)
        # Write to SyncLog so the UI shows the error (sync_woob.run() may not have caught it)
        try:
            import psycopg2.extras

            from db import get_conn, write_sync_log
            conn = get_conn()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            write_sync_log(cur, f"woob:{inst_id}", "error", str(e)[:300])
            conn.commit()
            cur.close()
            conn.close()
        except psycopg2.Error:
            # Distinct from the outer except: this specifically means "we
            # couldn't even write the failure to the DB" (connection down,
            # schema drift) - worth telling apart from the sync failure
            # itself in the logs.
            log.exception("Failed to write sync log for %s (DB error)", inst_name)
        except Exception:
            log.exception("Failed to write sync log for %s", inst_name)


def _run_all_woob():
    from db import get_conn, get_woob_institutions
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        institutions = get_woob_institutions(cur)
        cur.close()
        conn.close()
    except psycopg2.Error:
        log.exception("Failed to fetch Woob institutions (DB error)")
        return
    except Exception:
        log.exception("Failed to fetch Woob institutions")
        return
    for inst in institutions:
        _run_woob_institution(inst["id"], inst["name"], inst["woobModule"], inst["woobLogin"], inst["woobPassword"])


def _check_alerts():
    # Scoped to this automatic 4h job only, not on-demand "Sync now" clicks -
    # a manual sync's failure is already visible right there in the UI to
    # whoever just clicked it; a push notification adds value for the
    # unattended background job specifically. See CLAUDE.md's "Alerts &
    # webhooks" for the full design (net worth threshold / loan nearly paid
    # off / sync failures, all evaluated app-side to reuse its net-worth and
    # loan math instead of re-implementing it here).
    app_url = os.environ.get("APP_SERVICE_URL")
    secret = os.environ.get("NEXTAUTH_SECRET")
    if not app_url or not secret:
        log.info("APP_SERVICE_URL or NEXTAUTH_SECRET not set - alert check skipped")
        return
    try:
        import requests
        resp = requests.post(
            f"{app_url}/api/alerts/check",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=30,
        )
        resp.raise_for_status()
        log.info("Alert check done: %s", resp.json())
    except Exception:
        # Broad on purpose, same reasoning as every other scheduled-job
        # catch-all in this file - and never let this look like the sync
        # itself failed, it runs after that work is already done and logged.
        log.exception("Alert check failed")


def _auto_categorize():
    # Same call shape as _check_alerts() below, and called first - a
    # transaction that gets auto-categorized here can immediately make a
    # BUDGET_OVERRUN custom alert rule fire in the same cycle instead of
    # lagging a cycle behind. See lib/domain/auto-categorize.ts for the
    # self-learning label -> category matching itself; this just triggers
    # it after every automatic 4h sync run, same as CLAUDE.md's "Alerts &
    # webhooks" reasoning for why the alert check lives here rather than
    # only on-demand.
    app_url = os.environ.get("APP_SERVICE_URL")
    secret = os.environ.get("NEXTAUTH_SECRET")
    if not app_url or not secret:
        log.info("APP_SERVICE_URL or NEXTAUTH_SECRET not set - auto-categorize skipped")
        return
    try:
        import requests
        resp = requests.post(
            f"{app_url}/api/transactions/auto-categorize",
            headers={"Authorization": f"Bearer {secret}"},
            timeout=30,
        )
        resp.raise_for_status()
        log.info("Auto-categorize done: %s", resp.json())
    except Exception:
        log.exception("Auto-categorize failed")


def _run_all():
    log.info("=== Daily sync started ===")
    _run_lcl()
    _run_tr()
    _run_all_woob()
    _auto_categorize()
    _check_alerts()
    log.info("=== Daily sync done ===")


# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Full sync every 4 hours: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
    scheduler.add_job(_run_all, "cron", hour="*/4", minute=0, id="auto_sync")
    # TR session keepalive every 90 min - observed TTL is ~2h, so 90min gives a 30min buffer.
    scheduler.add_job(_keepalive_tr, "interval", minutes=90, id="tr_keepalive")
    scheduler.start()
    log.info("Scheduler started - auto sync every 4h, TR keepalive every 90min")

    # Immediate keepalive on startup: if the container restarts when the session
    # was close to expiry (3h TTL), the next scheduled keepalive (≤2h away) would
    # arrive too late. Refresh at boot to reset the TTL clock.
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _keepalive_tr)

    yield
    scheduler.shutdown()


app = FastAPI(lifespan=lifespan)


@app.post("/sync/lcl")
async def trigger_lcl():
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, _run_lcl)
    return {"status": "ok", "source": "lcl"}


@app.post("/sync/trade-republic")
async def trigger_tr():
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(executor, _run_tr)
    return {"status": "ok", "source": "trade_republic"}


@app.post("/sync/trade-republic/async")
async def trigger_tr_async():
    """Fire-and-forget - returns immediately, sync runs in the background."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_tr)
    return {"status": "started", "source": "trade_republic"}


@app.post("/sync/lcl/async")
async def trigger_lcl_async():
    """Fire-and-forget - returns immediately, sync runs in the background."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_lcl)
    return {"status": "started", "source": "lcl"}


@app.post("/sync/all/async")
async def trigger_all_async():
    """Fire-and-forget - triggers LCL, TR, and all Woob institutions in the background."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_all)
    return {"status": "started"}


@app.get("/status")
async def get_status():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT DISTINCT ON (source) source, status, message, "createdAt"
            FROM "SyncLog"
            ORDER BY source, "createdAt" DESC
            """
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {row["source"]: {"status": row["status"], "message": row["message"], "at": row["createdAt"].isoformat()} for row in rows}
    except psycopg2.Error:
        log.exception("Failed to fetch sync status (DB error)")
        return JSONResponse({"error": "Database error - check service logs"}, status_code=500)
    except Exception:
        # Still a catch-all - a FastAPI route must always return a response,
        # never let an unexpected exception bubble up and 500 with no body.
        # Kept separate from psycopg2.Error above so "DB error" in the log
        # actually means the DB, not e.g. a malformed row shape.
        log.exception("Failed to fetch sync status")
        return JSONResponse({"error": "Internal error - check service logs"}, status_code=500)


@app.post("/sync/lcl/setup/start")
async def lcl_setup_start():
    import asyncio

    import setup_lcl
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_lcl.start_setup)
        return result
    except Exception:
        log.exception("LCL setup/start failed")
        return JSONResponse({"error": "LCL setup failed - check service logs"}, status_code=500)


@app.post("/sync/lcl/setup/complete")
async def lcl_setup_complete():
    import asyncio

    import setup_lcl
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_lcl.complete_setup)
        return result
    except Exception:
        log.exception("LCL setup/complete failed")
        return JSONResponse({"error": "LCL setup failed - check service logs"}, status_code=500)


@app.post("/sync/trade-republic/setup/start")
async def tr_setup_start():
    import asyncio

    import setup_tr
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_tr.start_setup)
        return result
    except Exception:
        log.exception("TR setup/start failed")
        return JSONResponse({"error": "TR setup failed - check service logs"}, status_code=500)


@app.post("/sync/trade-republic/setup/complete")
async def tr_setup_complete(request: Request):
    body = await request.json()
    code = (body.get("code") or "").strip()
    if not code:
        return JSONResponse({"error": "missing code"}, status_code=400)
    import asyncio

    import setup_tr
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(executor, setup_tr.complete_setup, code)
        return {"status": "ok"}
    except Exception:
        log.exception("TR setup/complete failed")
        return JSONResponse({"error": "TR setup failed - check service logs"}, status_code=500)


@app.post("/sync/institution/{institution_id}/setup/start")
async def institution_setup_start(institution_id: str):
    import asyncio

    import setup_woob
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_woob.start_setup, institution_id)
        return result
    except setup_woob.SetupError as e:
        # e.user_message was written by setup_woob.py itself at raise time
        # ("Institution introuvable", "Code manquant"...) - never derived
        # from str(exception)/.args of whatever actually failed, so this
        # isn't the same "exception text reaches a client" pattern CodeQL
        # flags below. See SetupError's own docstring in setup_woob.py.
        log.exception("Woob setup/start failed for institution %s", institution_id)
        return JSONResponse({"error": e.user_message[:300]}, status_code=500)
    except Exception:
        # Anything else (a DB error, a raw Woob/library exception never
        # translated by setup_woob.py into a SetupError) could carry
        # internal detail - a connection string, a file path, library
        # internals - that has no business reaching an HTTP client. Full
        # detail still goes to the service logs via log.exception; CodeQL
        # flagged the previous str(e) here as information exposure
        # (alert #1345/#1346, then #1347/#1348 once str(e) on the
        # RuntimeError branch above was still tainted by its own rule) -
        # same class of fix as the backup route's pg_dump/psql stderr
        # handling.
        log.exception("Woob setup/start failed for institution %s", institution_id)
        return JSONResponse({"error": "Échec de la configuration - vérifie les logs du service sync"}, status_code=500)


@app.post("/sync/institution/{institution_id}/setup/complete")
async def institution_setup_complete(institution_id: str, request: Request):
    body = await request.json()
    code = (body.get("code") or "").strip() or None
    import asyncio

    import setup_woob
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_woob.complete_setup, institution_id, code)
        return result
    except setup_woob.SetupError as e:
        # See institution_setup_start above - e.user_message is one of
        # setup_woob.py's own deliberately-written strings, not exception
        # text.
        log.exception("Woob setup/complete failed for institution %s", institution_id)
        return JSONResponse({"error": e.user_message[:300]}, status_code=500)
    except Exception:
        log.exception("Woob setup/complete failed for institution %s", institution_id)
        return JSONResponse({"error": "Échec de la configuration - vérifie les logs du service sync"}, status_code=500)


@app.post("/sync/institution/{institution_id}")
async def trigger_institution_sync(institution_id: str):
    """Trigger Woob sync for a specific institution (identified by DB id)."""
    import asyncio

    import psycopg2.extras

    from db import get_conn

    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            'SELECT id, name, "woobModule", "woobLogin", "woobPassword" FROM "Institution" WHERE id = %s',
            (institution_id,),
        )
        inst = cur.fetchone()
        cur.close()
        conn.close()
    except psycopg2.Error:
        log.exception("Failed to fetch institution %s (DB error)", institution_id)
        return JSONResponse({"error": "Database error - check service logs"}, status_code=500)
    except Exception:
        log.exception("Failed to fetch institution %s", institution_id)
        return JSONResponse({"error": "Internal error - check service logs"}, status_code=500)

    if not inst:
        return JSONResponse({"error": "Institution not found"}, status_code=404)
    if not inst["woobModule"]:
        return JSONResponse({"error": "No Woob module configured for this institution"}, status_code=400)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        executor,
        _run_woob_institution,
        inst["id"], inst["name"], inst["woobModule"], inst["woobLogin"], inst["woobPassword"],
    )
    return {"status": "ok", "institution": inst["name"]}


@app.get("/woob/modules")
async def list_woob_bank_modules():
    """Every Woob module capable of bank sync (CapBank), from the local
    repository index - entrypoint.sh already runs `woob config update` on
    every container start, so this doesn't need to hit the network itself.
    Powers the module dropdown in Settings -> "Configurer Woob" - see
    CLAUDE.md's "Sync service" section for why this replaced a hardcoded
    17-bank list."""
    import asyncio

    def _list_modules():
        from woob.core import Woob
        w = Woob()
        modules = w.repositories.get_all_modules_info()
        return sorted(
            (
                {"module": name, "label": info.description or name}
                for name, info in modules.items()
                if "CapBank" in [str(c) for c in info.capabilities]
            ),
            key=lambda m: m["label"].lower(),
        )

    loop = asyncio.get_event_loop()
    try:
        modules = await loop.run_in_executor(executor, _list_modules)
        return {"modules": modules}
    except Exception:
        log.exception("Failed to list Woob bank modules")
        return JSONResponse({"error": "Failed to list modules - check service logs"}, status_code=500)


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    # Suppressed below (python:S8392) - 0.0.0.0 is required here, not a
    # mistake: this is the actual production entrypoint (entrypoint.sh runs
    # `exec python main.py`), running inside the sync container. Binding to 127.0.0.1
    # would make it unreachable from the app container on the same Docker
    # network - the whole point of this service. The real security boundary
    # is that port 8000 is never published to the host in docker-compose.yml
    # (only app's 3000 is) - see SECURITY.md: "Docker-network-only, never
    # expose port 8000 publicly."
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")  # NOSONAR
