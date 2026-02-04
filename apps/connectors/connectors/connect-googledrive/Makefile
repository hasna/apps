VENV_DIR ?= .venv
PYTHON ?= python3
UVICORN_HOST ?= 0.0.0.0
UVICORN_PORT ?= 21000

.PHONY: venv install clean lint fmt typecheck test connector-connect-googledrive connector-connect-googledrive-test connector-connect-googledrive-lint connector-connect-googledrive-cli connector-connect-googledrive-ci

venv:
	$(PYTHON) -m venv $(VENV_DIR)

install: venv
	. $(VENV_DIR)/bin/activate && pip install --upgrade pip && pip install -e .[dev]

clean:
	rm -rf $(VENV_DIR) .pytest_cache .mypy_cache .ruff_cache

lint:
	. $(VENV_DIR)/bin/activate && ruff check .

fmt:
	. $(VENV_DIR)/bin/activate && ruff format . && black .

typecheck:
	. $(VENV_DIR)/bin/activate && mypy .

test:
	. $(VENV_DIR)/bin/activate && pytest -m "not external"

connector-connect-googledrive: install
	. $(VENV_DIR)/bin/activate && uvicorn apps.api.main:app --host $(UVICORN_HOST) --port $(UVICORN_PORT) --reload

connector-connect-googledrive-test:
	$(MAKE) test

connector-connect-googledrive-lint:
	$(MAKE) lint && $(MAKE) typecheck

connector-connect-googledrive-cli:
	. $(VENV_DIR)/bin/activate && connector-googledrive $(ARGS)

connector-connect-googledrive-ci:
	$(MAKE) connector-connect-googledrive-lint
	$(MAKE) connector-connect-googledrive-test
