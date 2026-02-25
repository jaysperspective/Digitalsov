from typing import Annotated

from fastapi import APIRouter, Body, HTTPException

from ..database import PROFILES_DIR, _sanitize_profile_name, init_profile_db

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("/")
def list_profiles():
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    names = sorted(p.stem for p in PROFILES_DIR.glob("*.db"))
    return {"profiles": names}


@router.post("/", status_code=201)
def create_profile(name: Annotated[str, Body(embed=True)]):
    safe = _sanitize_profile_name(name)
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid profile name — use only a-z, 0-9, _ or -")
    init_profile_db(safe)
    return {"name": safe}


@router.delete("/{name}", status_code=204)
def delete_profile(name: str):
    safe = _sanitize_profile_name(name)
    if not safe:
        raise HTTPException(status_code=400, detail="Invalid profile name")

    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    existing = list(PROFILES_DIR.glob("*.db"))
    if len(existing) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only profile")

    db_file = PROFILES_DIR / f"{safe}.db"
    if not db_file.exists():
        raise HTTPException(status_code=404, detail="Profile not found")

    db_file.unlink()
