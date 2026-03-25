.PHONY: bootstrap dev service-test

bootstrap:
	./scripts/bootstrap

dev:
	./scripts/dev-start

service-test:
	cd apps/service && .venv/bin/python -m pytest tests
