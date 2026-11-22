# Development commands. Run `make setup` once, then `make dev`.
.PHONY: setup dev api frontend test

setup:            ## install the API venv and frontend packages
	python3 -m venv model/.venv
	model/.venv/bin/pip install -r model/requirements.txt
	cd frontend && npx -y pnpm@10 install   # the workspace file needs pnpm 10

api:              ## engine API on http://localhost:8000
	cd model && .venv/bin/uvicorn server:app --reload --reload-dir . --reload-dir ../chat --port 8000

frontend:         ## Vite dev server (proxies /api to the engine)
	cd frontend && pnpm dev

dev: private SHELL := bash
# Put each service in its own process group so cleanup also stops its workers.
dev:              ## API and frontend together; Ctrl+C stops both
	@set -m; \
	pids=(); \
	cleanup() { \
		trap '' INT TERM; \
		for pid in "$${pids[@]}"; do kill -TERM -- "-$$pid" 2>/dev/null || :; done; \
		wait; \
	}; \
	trap cleanup EXIT; \
	trap 'exit 130' INT; \
	trap 'exit 143' TERM; \
	$(MAKE) api & pids+=("$$!"); \
	$(MAKE) frontend & pids+=("$$!"); \
	wait -n

test:             ## engine, optimizer, search and assistant tests
	cd model && python3 test_engine.py && python3 test_optimize.py && python3 test_search.py
	python3 -m chat.test_agent
