.PHONY: help check build data compile serve watch fetch clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

build: data compile ## Compile docs tables into data/, and TypeScript into build/

data: ## Compile docs/design tables into data/*.json
	@python3 tools/build_from_docs.py

compile: ## Type-check and emit build/
	@npx tsc -p tsconfig.json && echo "compiled to build/"

watch: ## Recompile on change
	@npx tsc --watch -p tsconfig.json

check: ## Run every invariant. Required before committing.
	@tools/check.sh

serve: ## Serve the game locally at http://localhost:8000
	@python3 -m http.server 8000

fetch: ## Download and normalise the WEB and KJV texts
	@python3 tools/fetch_bible.py

clean:
	@rm -rf build
	@find . -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
