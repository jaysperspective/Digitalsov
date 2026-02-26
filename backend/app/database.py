import re
from pathlib import Path
from typing import Generator, Optional

from fastapi import Depends, Header, Query
from sqlalchemy import create_engine, Engine, inspect
from sqlalchemy.orm import declarative_base, sessionmaker, Session

Base = declarative_base()

# profiles/ lives next to the backend/ directory (repo root)
PROFILES_DIR = Path(__file__).parent.parent.parent / "profiles"

# Alembic script directory — used when running migrations programmatically
BACKEND_DIR = Path(__file__).parent.parent          # …/backend/
ALEMBIC_DIR = BACKEND_DIR / "alembic"

_engines: dict[str, Engine] = {}


def _sanitize_profile_name(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]", "", name.lower())[:50]


def get_or_create_engine(profile: str) -> Engine:
    safe = _sanitize_profile_name(profile) or "default"
    if safe not in _engines:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
        db_path = PROFILES_DIR / f"{safe}.db"
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(bind=engine)
        _engines[safe] = engine
    return _engines[safe]


def _run_alembic_upgrade(db_url: str, *, is_new_db: bool = False) -> None:
    """Run Alembic migrations to head for the given SQLite DB URL.

    Strategy:
    - Brand-new DBs (``is_new_db=True``): ``create_all`` already built the full
      current schema in this process.  Stamp to head so future migrations know
      the baseline — no migrations actually need to run.
    - Existing DBs that already have an ``alembic_version`` table: just run
      ``upgrade head`` to apply any pending migrations.
    - Legacy DBs created before Alembic was integrated (no ``alembic_version``
      table but tables exist): stamp to "0007" (the schema at the time Alembic
      was adopted) then run ``upgrade head`` to apply new migrations.
    """
    from alembic.config import Config
    from alembic import command

    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    if is_new_db:
        # Brand-new DB: schema is current; just record the head revision.
        command.stamp(alembic_cfg, "head")
        return

    # Existing DB: check whether Alembic has been run before.
    tmp_engine = create_engine(db_url, connect_args={"check_same_thread": False})
    try:
        has_alembic_version = "alembic_version" in inspect(tmp_engine).get_table_names()
    finally:
        tmp_engine.dispose()

    if not has_alembic_version:
        # Legacy DB created via create_all + ALTER TABLE before Alembic adoption.
        # Stamp to 0007 (the pre-Pass-1 baseline) so only new migrations run.
        command.stamp(alembic_cfg, "0007")

    # Apply any pending migrations (e.g., 0008+ added in Pass 1).
    command.upgrade(alembic_cfg, "head")


def init_profile_db(name: str) -> str:
    """Create tables, run Alembic migrations, and seed a profile DB. Returns sanitized name."""
    from .services.seeder import (
        delete_personal_zelle,
        seed_401k_loan_note,
        seed_categories,
        seed_demo_transactions,
        seed_housing_rules,
        seed_rules,
        seed_transfer_rules,
    )

    safe = _sanitize_profile_name(name) or "default"
    db_path = PROFILES_DIR / f"{safe}.db"
    db_url = f"sqlite:///{db_path}"

    # Track whether this is a brand-new DB before create_all creates the file.
    is_new_db = not db_path.exists()

    # create_all ensures tables exist for new DBs; no-op for existing ones.
    engine = get_or_create_engine(safe)

    # Run Alembic migrations — stamps new DBs to head, upgrades existing ones.
    _run_alembic_upgrade(db_url, is_new_db=is_new_db)

    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = _SessionLocal()
    try:
        seed_categories(db)
        seed_rules(db)
        seed_transfer_rules(db)
        seed_housing_rules(db)
        if safe == "sample":
            # Demo profile — populate with fictional transactions only.
            seed_demo_transactions(db)
        else:
            # Real profiles — run personal-data cleanup seeds.
            seed_401k_loan_note(db)
            delete_personal_zelle(db)
    finally:
        db.close()
    return safe


def get_profile_name(x_profile: str = Header(default="default")) -> str:
    return _sanitize_profile_name(x_profile) or "default"


def get_db(
    profile: str = Depends(get_profile_name),
) -> Generator[Session, None, None]:
    engine = get_or_create_engine(profile)
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_download(
    profile: Optional[str] = Query(default=None),
    x_profile: str = Header(default="default"),
) -> Generator[Session, None, None]:
    """Like get_db but also accepts ?profile= query param (for browser-navigated downloads)."""
    name = profile if profile else x_profile
    safe = _sanitize_profile_name(name) or "default"
    engine = get_or_create_engine(safe)
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
