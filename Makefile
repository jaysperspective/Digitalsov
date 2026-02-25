.PHONY: setup setup-backend setup-frontend backend frontend migrate migrate-gen clean

# ── Setup ──────────────────────────────────────────────────────────────────
setup: setup-backend setup-frontend

setup-backend:
	cd backend && python3 -m venv .venv \
		&& .venv/bin/pip install --upgrade pip -q \
		&& .venv/bin/pip install -r requirements.txt

setup-frontend:
	cd frontend && npm install

# ── Run (open two terminals) ───────────────────────────────────────────────
backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

# ── Alembic migrations ─────────────────────────────────────────────────────
# Tables are auto-created on first backend start via Base.metadata.create_all.
# Use alembic only when you need versioned schema migrations.

migrate:
	cd backend && .venv/bin/alembic upgrade head

# Generate a new migration after editing models:  make migrate-gen msg="add category table"
migrate-gen:
	cd backend && .venv/bin/alembic revision --autogenerate -m "$(msg)"

migrate-history:
	cd backend && .venv/bin/alembic history --verbose

# ── Clean ──────────────────────────────────────────────────────────────────
clean:
	rm -f backend/finance.db
	rm -rf backend/.venv
	rm -rf frontend/node_modules frontend/dist
