"""The engine's HTTP API (contract B). Run from the repo root: uvicorn engine.app:app

  GET  /health   no auth; says whether the engine is configured
  POST /plan     Authorization: Bearer <ENGINE_API_TOKEN>; body per
                 contracts/engine-request.schema.json; answer per engine-response.schema.json

SKELETON (task A2): /plan checks the token, validates the request, finds and loads the
field bundle, then returns the contract SAMPLE (made-up numbers, `sample_data: true`).
Task A6 replaces the sample with the real pipeline.
"""
from __future__ import annotations

import hmac
import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from jsonschema import Draft202012Validator

from engine import bundle
from engine.bundle import BundleError

CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"
REQUEST_SCHEMA = Draft202012Validator(json.loads((CONTRACTS / "engine-request.schema.json").read_text(encoding="utf-8")))
RESPONSE_SCHEMA = Draft202012Validator(json.loads((CONTRACTS / "engine-response.schema.json").read_text(encoding="utf-8")))
SAMPLE_PLAN = json.loads((CONTRACTS / "samples" / "plan-normal.json").read_text(encoding="utf-8"))

STATUS = {"unauthorized": 401, "bad_request": 400, "field_not_found": 404, "no_data": 422, "engine_failed": 500}

app = FastAPI(title="FarmLine engine", docs_url=None, redoc_url=None)


def error(code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=STATUS.get(code, 500))


@app.get("/health")
def health() -> dict:
    return {
        "service": "farmline-engine",
        "status": "ok",
        "token_configured": bool(os.environ.get("ENGINE_API_TOKEN")),
        "model": "skeleton",  # becomes "live" in A6
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
    problems = [f"{'/'.join(map(str, e.absolute_path)) or 'request'}: {e.message}" for e in REQUEST_SCHEMA.iter_errors(body)]
    if problems:
        return error("bad_request", "; ".join(problems[:3]))

    try:
        field_id = bundle.resolve(body)
        field, _ref = bundle.load(field_id)
    except BundleError as err:
        return error(err.code, err.message)

    # SKELETON: the contract sample, pointed at the field that was found.
    result = json.loads(json.dumps(SAMPLE_PLAN))
    result["_note"] = "SKELETON (A2): made-up sample numbers, not computed. The real model arrives in A6."
    result["field"]["id"] = field.field_id
    result["field"]["place"] = field.place
    result["sample_data"] = True

    if any(RESPONSE_SCHEMA.iter_errors(result)):
        return error("engine_failed", "The engine produced an answer that breaks its own contract")
    return JSONResponse(result)
