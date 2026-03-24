PYTHON := .venv/bin/python

.PHONY: install test run cli-help

install:
	$(PYTHON) -m pip install -e '.[dev]'

test:
	$(PYTHON) -m pytest tests

run:
	$(PYTHON) -m uvicorn xcpc_vp_gather.main:app --reload

cli-help:
	.venv/bin/xvg --help
