import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import PROFILES_DIR, init_profile_db
from .routers import audit, categories, imports, llm, reports, rules, transactions
from .routers import profiles as profiles_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    # Migrate legacy finance.db → profiles/default.db on first run
    legacy = Path("finance.db")
    default_profile = PROFILES_DIR / "default.db"
    if legacy.exists() and not default_profile.exists():
        shutil.copy(legacy, default_profile)

    # Initialize default profile (create tables + seed if needed)
    init_profile_db("default")

    yield
    # ── Shutdown (nothing needed for SQLite) ──────────────────────────────────


app = FastAPI(
    title="DigitalSov Finance Audit",
    description="Local-first personal finance audit — CSV import, dedup, categorisation.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(audit.router)
app.include_router(imports.router)
app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(rules.router)
app.include_router(reports.router)
app.include_router(llm.router)
app.include_router(profiles_router.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": "0.2.0"}
