from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from .database import Base


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    color = Column(String(7), nullable=False, default="#94a3b8")  # hex
    icon = Column(String(10), nullable=False, default="📌")
    is_default = Column(Boolean, nullable=False, default=False)
    monthly_budget = Column(Integer, nullable=True)       # cents
    tax_deductible = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    transactions = relationship("Transaction", back_populates="category")
    rules = relationship("Rule", back_populates="category", cascade="all, delete-orphan")


class Rule(Base):
    __tablename__ = "rules"

    id = Column(Integer, primary_key=True, index=True)
    pattern = Column(String(500), nullable=False)
    match_type = Column(String(20), nullable=False, default="contains")  # contains | regex | exact
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=False)
    priority = Column(Integer, nullable=False, default=50)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    category = relationship("Category", back_populates="rules")


class Import(Base):
    __tablename__ = "imports"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False, unique=True, index=True)
    source_type = Column(String(50), nullable=False, default="generic")
    column_mapping = Column(JSON, nullable=True)
    account_label = Column(String(100), nullable=True)
    account_type = Column(String(20), nullable=True)   # checking | savings | credit
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    transactions = relationship("Transaction", back_populates="import_record")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    import_id = Column(Integer, ForeignKey("imports.id"), nullable=False)
    posted_date = Column(String(20), nullable=False)
    description_raw = Column(Text, nullable=False)
    description_norm = Column(Text, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    merchant = Column(String(255), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    category_source = Column(String(20), nullable=True)   # "rule" | "manual" | None
    category_rule_id = Column(Integer, ForeignKey("rules.id"), nullable=True)
    fingerprint_hash = Column(String(64), nullable=False, unique=True, index=True)
    transaction_type = Column(String(20), nullable=False, default="normal")
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    import_record = relationship("Import", back_populates="transactions")
    category = relationship("Category", back_populates="transactions")
    category_rule = relationship("Rule", foreign_keys=[category_rule_id])
