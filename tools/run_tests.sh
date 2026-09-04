#!/usr/bin/env bash
# Compile to build/ and run the node test runner over the emitted JS.
# Glob rather than directory: node --test on a directory also picks up
# non-test modules and reports them as failures.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsc -p tsconfig.json
node --test "build/core/**/*.test.js"
