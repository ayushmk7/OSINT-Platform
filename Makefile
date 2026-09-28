.PHONY: install dev build test lint format help docker-build docker-up docker-down

help:
	@echo "MK-OSINT commands:"
	@echo "  make install - Install all Node.js dependencies (root + workspaces)"
	@echo "  make dev     - Launch backend and frontend dev servers"
	@echo "  make build   - Compile backend and frontend web assets"
	@echo "  make test    - Run test suites for backend and frontend"
	@echo "  make lint    - Run linters across workspace"
	@echo "  make format  - Format codebase with Prettier"
	@echo "  make docker-build - Build the single-container image (mk-osint:latest)"
	@echo "  make docker-up    - Build and start the container on http://localhost:4000"
	@echo "  make docker-down  - Stop and remove the container (keeps the data volume)"

# Installs root + backend + frontend deps in one pass via NPM workspaces.
# Call `npm install` DIRECTLY. Do NOT add an "install" script to package.json:
# npm auto-runs an `install` lifecycle script during `npm install`, so it would
# recurse into itself and loop forever.
install:
	npm install

dev:
	npm run dev

build:
	npm run build

test:
	npm run test

lint:
	npm run lint

format:
	npm run format

docker-build:
	docker compose build

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down
