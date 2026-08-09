.PHONY: install dev build test lint format help

help:
	@echo "ReconVillage Workshop Automation Commands:"
	@echo "  make install - Install all Node.js dependencies (root + workspaces)"
	@echo "  make dev     - Launch backend and frontend dev servers"
	@echo "  make build   - Compile backend and frontend web assets"
	@echo "  make test    - Run test suites for backend and frontend"
	@echo "  make lint    - Run linters across workspace"
	@echo "  make format  - Format codebase with Prettier"

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
