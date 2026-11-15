"""The engine's HTTP API (contract B). Run from the repo root: uvicorn engine.app:app

  GET  /health   no auth; says whether the engine is configured and which parts are stand-ins
  POST /plan     Authorization: Bearer <ENGINE_API_TOKEN>; body per
                 contracts/engine-request.schema.json; answer per engine-response.schema.json

Every answer is checked against the contract before it is sent; an answer that fails is
replaced by an `engine_failed` error, never sent as it is.
"""
from __future__ import annotations

import hmac
import json
import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from engine import contract, plan as planner
from engine.bundle import BundleError

log = logging.getLogger("farmline.engine")
STATUS = {"unauthorized": 401, "bad_request": 400, "field_not_found": 404, "no_data": 422, "engine_failed": 500}

app = FastAPI(title="FarmLine engine", docs_url=None, redoc_url=None)


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
        return JSONResponse(planner.make_plan(body))
    except BundleError as err:
        return error(err.code, err.message)
    except Exception:  # a bug or a contract failure: log it, tell the caller nothing internal
        log.exception("plan failed")
        return error("engine_failed", "The engine could not compute a plan for this field")
