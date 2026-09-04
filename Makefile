.PHONY: help check build serve fetch clean

help:
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

check: ## Run every invariant. Required before committing.
	@tools/check.sh

build: ## Compile docs/design tables into data/*.json
	@python3 tools/build_from_docs.py

serve: ## Serve the game locally at http://localhost:8000
	@python3 -m http.server 8000

fetch: ## Download and normalise the WEB and KJV texts
	@python3 tools/fetch_bible.py

clean:
	@find . -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
