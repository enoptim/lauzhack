# Development commands. Run `make setup` once, then `make dev`.
.PHONY: setup dev api frontend test

setup:            ## install the API venv and frontend packages
	python3 -m venv model/.venv
	model/.venv/bin/pip install -r model/requirements.txt
	cd frontend && npx -y pnpm@10 install   # the workspace file needs pnpm 10

api:              ## engine API on http://localhost:8000
	cd model && .venv/bin/uvicorn server:app --reload --port 8000

frontend:         ## Vite dev server (proxies /api to the engine)
	cd frontend && pnpm dev

dev:              ## API and frontend together; Ctrl+C stops both
	@trap 'kill 0' INT TERM EXIT; $(MAKE) api & $(MAKE) frontend & wait

test:             ## engine, optimizer and search tests
	cd model && python3 test_engine.py && python3 test_optimize.py && python3 test_search.py
