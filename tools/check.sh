#!/usr/bin/env bash
# Every invariant. Run before committing: `make check`
# See AGENTS.md for what each of these protects.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
run() {
  local name="$1"; shift
  printf '  %-24s' "$name"
  local out
  if out=$("$@" 2>&1); then
    printf '\033[32mok\033[0m\n'
    [ -n "$out" ] && echo "$out" | sed 's/^    /      /'
  else
    printf '\033[31mFAIL\033[0m\n'
    echo "$out" | sed 's/^/      /'
    fail=1
  fi
  return 0
}

echo "scriptorium: checking invariants"
echo

run "docs projection"   python3 tools/build_from_docs.py --check
run "core purity"       python3 tools/check_core_purity.py
run "doc links"         python3 tools/check_doc_links.py
run "no magic numbers"  python3 tools/check_no_magic.py
run "data invariants"   python3 tools/validate_data.py
run "zero install"      tools/check_zero_install.sh

if ls core/*.test.js core/**/*.test.js >/dev/null 2>&1; then
  run "unit tests"      node --test core/
else
  printf '  %-24s\033[33mskip\033[0m (no tests yet)\n' "unit tests"
fi

if [ "${SKIP_TSC:-0}" != "1" ] && command -v npx >/dev/null 2>&1 && ls core/*.js >/dev/null 2>&1; then
  run "type check"      npx -y -p typescript@5.6 tsc --noEmit -p jsconfig.json
else
  printf '  %-24s\033[33mskip\033[0m (SKIP_TSC or no sources)\n' "type check"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo -e "\033[31mFAILED\033[0m — see above. Do not commit."
  exit 1
fi
echo -e "\033[32mall invariants hold\033[0m"
