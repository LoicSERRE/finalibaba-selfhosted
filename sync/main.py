"""
Sync service — FastAPI + APScheduler

Endpoints (internal Docker network only, not exposed externally):
  POST /sync/lcl            → trigger LCL sync
  POST /sync/trade-republic → trigger Trade Republic sync
  GET  /status              → last sync logs per source

Cron: every 4 hours
"""
import logging
import os
import threading
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

import psycopg2
import psycopg2.extras
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=2)
scheduler = AsyncIOScheduler()

_lcl_lock = threading.Lock()
_tr_lock = threading.Lock()


# ── Sync runners ──────────────────────────────────────────────────────────────

def _run_lcl():
    if not os.environ.get("LCL_LOGIN"):
        log.info("LCL_LOGIN not set — LCL sync disabled")
        return
    if not _lcl_lock.acquire(blocking=False):
        log.info("LCL sync already in progress — skipped")
        return
    try:
        import sync_lcl
        result = sync_lcl.run()
        log.info("LCL sync done: %s", result)
    except Exception as e:
        log.error("LCL sync failed: %s", e)
    finally:
        _lcl_lock.release()


def _run_tr():
    if not os.environ.get("TR_PHONE"):
        log.info("TR_PHONE not set — Trade Republic sync disabled")
        return
    if not _tr_lock.acquire(blocking=False):
        log.info("TR sync already in progress — skipped")
        return
    try:
        import sync_tr
        result = sync_tr.run()
        log.info("TR sync done: %s", result)
    except Exception as e:
        log.error("TR sync failed: %s", e)
    finally:
        _tr_lock.release()


def _keepalive_tr():
    if not os.environ.get("TR_PHONE"):
        return
    try:
        import sync_tr
        sync_tr.keepalive()
    except Exception as e:
        log.warning("TR keepalive failed: %s", e)


def _run_woob_institution(inst_id: str, inst_name: str, module: str, login: str, password: str):
    try:
        import sync_woob
        result = sync_woob.run(inst_id, inst_name, module, login, password)
        log.info("Woob sync done for %s: %s", inst_name, result)
    except sync_woob.AuthRequiredError:
        pass  # already written to SyncLog inside sync_woob.run()
    except Exception as e:
        log.error("Woob sync failed for %s: %s", inst_name, e)
        # Write to SyncLog so the UI shows the error (sync_woob.run() may not have caught it)
        try:
            from db import get_conn, write_sync_log
            import psycopg2.extras
            conn = get_conn()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            write_sync_log(cur, f"woob:{inst_id}", "error", str(e)[:300])
            conn.commit()
            cur.close()
            conn.close()
        except Exception as db_err:
            log.error("Failed to write sync log for %s: %s", inst_name, db_err)


def _run_all_woob():
    import psycopg2.extras
    from db import get_conn, get_woob_institutions
    try:
        conn = get_conn()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        institutions = get_woob_institutions(cur)
        cur.close()
        conn.close()
    except Exception as e:
        log.error("Failed to fetch Woob institutions: %s", e)
        return
    for inst in institutions:
        _run_woob_institution(inst["id"], inst["name"], inst["woobModule"], inst["woobLogin"], inst["woobPassword"])


def _run_all():
    log.info("=== Daily sync started ===")
    _run_lcl()
    _run_tr()
    _run_all_woob()
    log.info("=== Daily sync done ===")


# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Full sync every 4 hours: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00
    scheduler.add_job(_run_all, "cron", hour="*/4", minute=0, id="auto_sync")
    # TR session keepalive every 90 min — observed TTL is ~2h, so 90min gives a 30min buffer.
    scheduler.add_job(_keepalive_tr, "interval", minutes=90, id="tr_keepalive")
    scheduler.start()
    log.info("Scheduler started — auto sync every 4h, TR keepalive every 90min")

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
    """Fire-and-forget — returns immediately, sync runs in the background."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_tr)
    return {"status": "started", "source": "trade_republic"}


@app.post("/sync/lcl/async")
async def trigger_lcl_async():
    """Fire-and-forget — returns immediately, sync runs in the background."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, _run_lcl)
    return {"status": "started", "source": "lcl"}


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
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/sync/lcl/setup/start")
async def lcl_setup_start():
    import setup_lcl
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_lcl.start_setup)
        return result
    except Exception as e:
        log.error("LCL setup/start failed: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/sync/lcl/setup/complete")
async def lcl_setup_complete():
    import setup_lcl
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_lcl.complete_setup)
        return result
    except Exception as e:
        log.error("LCL setup/complete failed: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/sync/trade-republic/setup/start")
async def tr_setup_start():
    import setup_tr
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, setup_tr.start_setup)
        return result
    except Exception as e:
        log.error("TR setup/start failed: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/sync/trade-republic/setup/complete")
async def tr_setup_complete(request: Request):
    body = await request.json()
    code = (body.get("code") or "").strip()
    if not code:
        return JSONResponse({"error": "missing code"}, status_code=400)
    import setup_tr
    import asyncio
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(executor, setup_tr.complete_setup, code)
        return {"status": "ok"}
    except Exception as e:
        log.error("TR setup/complete failed: %s", e)
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/sync/institution/{institution_id}")
async def trigger_institution_sync(institution_id: str):
    """Trigger Woob sync for a specific institution (identified by DB id)."""
    import psycopg2.extras
    from db import get_conn
    import asyncio

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
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

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


@app.get("/health")
async def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
