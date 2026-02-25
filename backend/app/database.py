import re
from pathlib import Path
from typing import Generator, Optional

from fastapi import Depends, Header, Query
from sqlalchemy import create_engine, Engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

Base = declarative_base()

# profiles/ lives next to the backend/ directory (repo root)
PROFILES_DIR = Path(__file__).parent.parent.parent / "profiles"

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


def _run_migrations(db: Session) -> None:
    """Idempotent schema migrations for columns added after initial creation."""
    migrations = [
        "ALTER TABLE transactions ADD COLUMN note TEXT",
        "ALTER TABLE categories ADD COLUMN monthly_budget INTEGER",
        "ALTER TABLE categories ADD COLUMN tax_deductible BOOLEAN NOT NULL DEFAULT 0",
        "ALTER TABLE imports ADD COLUMN notes TEXT",
    ]
    for stmt in migrations:
        try:
            db.execute(text(stmt))
            db.commit()
        except Exception:
            db.rollback()


def init_profile_db(name: str) -> str:
    """Create tables, run migrations, and seed a profile DB. Returns sanitized name."""
    from .services.seeder import (
        delete_personal_zelle,
        seed_401k_loan_note,
        seed_categories,
        seed_housing_rules,
        seed_rules,
        seed_transfer_rules,
    )

    safe = _sanitize_profile_name(name) or "default"
    engine = get_or_create_engine(safe)
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = _SessionLocal()
    try:
        _run_migrations(db)
        seed_categories(db)
        seed_rules(db)
        seed_transfer_rules(db)
        seed_housing_rules(db)
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
