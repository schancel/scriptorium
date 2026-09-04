#!/usr/bin/env bash
# No runtime dependencies and no bundler. One dev tool (tsc) is permitted.
# See docs/decisions/0001-web-app-not-game-engine.md
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

if [ -f package.json ]; then
  if python3 -c "import json,sys; d=json.load(open('package.json')); sys.exit(0 if not d.get('dependencies') else 1)"; then
    :
  else
    echo "package.json declares runtime dependencies (devDependencies are fine)"; fail=1
  fi
fi
for f in webpack.config.js vite.config.js rollup.config.js esbuild.config.js next.config.js; do
  [ -e "$f" ] && { echo "bundler config present: $f"; fail=1; }
done
if git ls-files --error-unmatch node_modules >/dev/null 2>&1; then
  echo "node_modules/ is committed"; fail=1
fi
if git ls-files --error-unmatch build >/dev/null 2>&1; then
  echo "build/ output is committed; CI builds and deploys it"; fail=1
fi
if [ -f index.html ] && grep -qE '<script[^>]+src="(https?:)?//' index.html; then
  echo "index.html loads a remote script"; fail=1
fi
[ "$fail" -eq 0 ] && echo "    zero install: no deps, no bundler"
exit $fail
