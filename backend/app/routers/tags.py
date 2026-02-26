from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Tag, Transaction
from ..schemas import TagAssignRequest, TagCreate, TagSchema, TagUpdate

router = APIRouter(prefix="/tags", tags=["tags"])


def _get_tag_or_404(db: Session, tag_id: int) -> Tag:
    tag = db.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    return tag


@router.get("/", response_model=list[TagSchema], summary="List all tags")
def list_tags(db: Session = Depends(get_db)):
    return db.query(Tag).order_by(Tag.name).all()


@router.post("/", response_model=TagSchema, status_code=201, summary="Create a tag")
def create_tag(payload: TagCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tag name cannot be empty.")
    existing = db.query(Tag).filter(func.lower(Tag.name) == name.lower()).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Tag '{name}' already exists.")
    tag = Tag(name=name, color=payload.color or None)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagSchema, summary="Update a tag")
def update_tag(tag_id: int, payload: TagUpdate, db: Session = Depends(get_db)):
    tag = _get_tag_or_404(db, tag_id)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Tag name cannot be empty.")
        conflict = (
            db.query(Tag)
            .filter(func.lower(Tag.name) == name.lower(), Tag.id != tag_id)
            .first()
        )
        if conflict:
            raise HTTPException(status_code=409, detail=f"Tag '{name}' already exists.")
        tag.name = name
    if "color" in payload.model_fields_set:
        tag.color = payload.color or None
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=204, summary="Delete a tag")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = _get_tag_or_404(db, tag_id)
    db.delete(tag)
    db.commit()
