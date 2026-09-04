#!/usr/bin/env bash
# No runtime dependencies, no bundler, no build step.
# See docs/decisions/0001-web-app-not-game-engine.md
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

if [ -f package.json ]; then
  if python3 -c "import json,sys; d=json.load(open('package.json')); sys.exit(0 if not d.get('dependencies') else 1)"; then
    :
  else
    echo "package.json declares runtime dependencies"; fail=1
  fi
fi
for f in webpack.config.js vite.config.js rollup.config.js esbuild.config.js next.config.js; do
  [ -e "$f" ] && { echo "bundler config present: $f"; fail=1; }
done
[ -d node_modules ] && { echo "node_modules/ is committed or present"; fail=1; }
if [ -f index.html ] && grep -qE '<script[^>]+src="(https?:)?//' index.html; then
  echo "index.html loads a remote script"; fail=1
fi
[ "$fail" -eq 0 ] && echo "    zero install: no deps, no bundler"
exit $fail
