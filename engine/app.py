"""The engine's HTTP API (contract B). Run from the repo root: uvicorn engine.app:app

  GET  /health   no auth; says whether the engine is configured and which parts are stand-ins
  POST /plan     Authorization: Bearer <ENGINE_API_TOKEN>; body per
                 contracts/engine-request.schema.json; answer per engine-response.schema.json

Every answer is checked against the contract before it is sent; an answer that fails is
replaced by an `engine_failed` error, never sent as it is.

On start, every field in reference/places.csv is prepared in the background (cache.py), so
texts are answered in well under a second; /health shows each field's state. Set
ENGINE_WARMUP=0 to skip that.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from engine import cache, contract, plan as planner
from engine.bundle import BundleError

log = logging.getLogger("farmline.engine")
STATUS = {"unauthorized": 401, "bad_request": 400, "field_not_found": 404, "no_data": 422, "engine_failed": 500}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.environ.get("ENGINE_WARMUP", "1") != "0":
        cache.warm_up()
    yield


app = FastAPI(title="FarmLine engine", docs_url=None, redoc_url=None, lifespan=lifespan)


def error(code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=STATUS.get(code, 500))


@app.get("/health")
def health() -> dict:
    missing = planner.stand_ins()
    return {
        "service": "farmline-engine",
        "status": "ok",
        "token_configured": bool(os.environ.get("ENGINE_API_TOKEN")),
        "model": "live" if not missing else "stand-ins: " + ", ".join(missing),
        "fields": dict(cache.status),  # field_id -> warming | ready | <error code>: ...
    }


@app.post("/plan")
async def plan(request: Request) -> JSONResponse:
    token = os.environ.get("ENGINE_API_TOKEN", "")
    given = request.headers.get("authorization", "")
    # No token configured = closed, never open.
    if not token or not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
        return error("unauthorized", "Missing or wrong bearer token")

    try:
        body = json.loads(await request.body())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return error("bad_request", "The body must be JSON")
    found = contract.schema_errors(contract.REQUEST, body)
    if found:
        return error("bad_request", "; ".join(found[:3]))

    try:
        # In a worker thread, so a field still being prepared doesn't hold up other requests.
        return JSONResponse(await run_in_threadpool(planner.make_plan, body))
    except BundleError as err:
        return error(err.code, err.message)
    except Exception:  # a bug or a contract failure: log it, tell the caller nothing internal
        log.exception("plan failed")
        return error("engine_failed", "The engine could not compute a plan for this field")
