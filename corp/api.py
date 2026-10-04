"""Local single-operator API. No live adapters or model credentials are present."""

import asyncio
import csv
import io
import logging
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .database import Database
from .service import CompanyService
from .treasury import DomainError


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Cycle(Input):
    product_id: str = "cleaning-kit"


class Pause(Input):
    paused: StrictBool


class Automation(Input):
    enabled: StrictBool


class Experiment(Input):
    title: str = Field(min_length=3, max_length=120)
    envelope_id: str
    amount_minor: StrictInt = Field(gt=0, le=100000)


class Policy(Input):
    action_limit_minor: StrictInt = Field(gt=0, le=60000)
    daily_limit_minor: StrictInt = Field(gt=0, le=60000)


class Allocations(Input):
    envelopes_minor: dict[str, Annotated[StrictInt, Field(ge=0, le=60000)]]


def create_app(database_path: Path | None = None, *, start_worker: bool = True) -> FastAPI:
    database = Database(database_path or Path(__file__).resolve().parent.parent / "data" / "company.sqlite3")
    service = CompanyService(database)
    operator_token = secrets.token_urlsafe(32)
    static = Path(__file__).parent / "static"

    async def scheduler():
        while True:
            await asyncio.sleep(1)
            try:
                await asyncio.to_thread(service.tick)
            except Exception:
                logging.exception("Simulation scheduler failed; no external action exists")

    @asynccontextmanager
    async def lifespan(app):
        service.initialize()
        task = asyncio.create_task(scheduler()) if start_worker else None
        yield
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(title="Corp · Company Lab", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service
    app.state.operator_token = operator_token
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])

    @app.middleware("http")
    async def security(request: Request, call_next):
        if request.url.path.startswith("/api") and request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Cross-site access is not permitted."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.url.path == "/" or request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def authorized(request: Request, x_operator_token: str = Header(default="")):
        if not secrets.compare_digest(x_operator_token, operator_token):
            raise DomainError("Operator authorization required. Reload the local dashboard.", 403)
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
            raise DomainError("Origin does not match this local dashboard.", 403)

    def command_key(idempotency_key: str = Header(alias="Idempotency-Key")):
        if not 8 <= len(idempotency_key) <= 128 or not all(c.isalnum() or c in "-_" for c in idempotency_key):
            raise DomainError("Provide an 8–128 character idempotency key.", 422)
        return idempotency_key

    Operator = Depends(authorized)
    Key = Depends(command_key)

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.get("/", response_class=HTMLResponse)
    def index():
        return (static / "index.html").read_text().replace("__OPERATOR_TOKEN__", operator_token)

    @app.get("/api/health")
    def health():
        with database.snapshot() as connection:
            connection.execute("SELECT id FROM company").fetchone()
        return {"status": "ok", "mode": "simulation", "real_world_execution": False}

    @app.get("/api/state")
    def state():
        return service.state()

    @app.post("/api/simulation/cycle", dependencies=[Operator])
    def cycle(body: Cycle, key: str = Key):
        return service.command(key, "cycle", body.model_dump())

    @app.post("/api/pause", dependencies=[Operator])
    def pause(body: Pause, key: str = Key):
        return service.command(key, "pause", body.model_dump())

    @app.post("/api/automation", dependencies=[Operator])
    def automation(body: Automation, key: str = Key):
        return service.command(key, "automation", body.model_dump())

    @app.post("/api/experiments", dependencies=[Operator])
    def reserve(body: Experiment, key: str = Key):
        return service.command(key, "reserve", body.model_dump())

    @app.post("/api/actions/{action_id}/execute", dependencies=[Operator])
    def execute(action_id: str, key: str = Key):
        return service.command(key, "execute", {"id": action_id})

    @app.post("/api/actions/{action_id}/cancel", dependencies=[Operator])
    def cancel(action_id: str, key: str = Key):
        return service.command(key, "cancel", {"id": action_id})

    @app.post("/api/orders/{order_id}/refund", dependencies=[Operator])
    def refund(order_id: str, key: str = Key):
        return service.command(key, "refund", {"id": order_id})

    @app.put("/api/policy", dependencies=[Operator])
    def policy(body: Policy, key: str = Key):
        return service.command(key, "policy", body.model_dump())

    @app.put("/api/allocations", dependencies=[Operator])
    def allocations(body: Allocations, key: str = Key):
        return service.command(key, "allocations", body.model_dump())

    @app.get("/api/ledger/export.csv")
    def export():
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["mode", "transaction_id", "created_at", "kind", "description", "reference", "envelope", "account", "amount_minor", "currency"])
        with database.snapshot() as connection:
            for row in connection.execute("SELECT t.*, l.account, l.amount_minor FROM transactions t JOIN journal_lines l ON l.transaction_id = t.id ORDER BY t.created_at, t.rowid, l.id"):
                # Neutralize spreadsheet formula interpretation in editable descriptions.
                description = row["description"]
                if description.startswith(("=", "+", "-", "@", "\t", "\r")):
                    description = "'" + description
                writer.writerow(["simulation", row["id"], row["created_at"], row["kind"], description, row["reference"], row["envelope_id"], row["account"], row["amount_minor"], "USD"])
        return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="corp-simulation-ledger.csv"'})

    app.mount("/static", StaticFiles(directory=static), name="static")
    return app
