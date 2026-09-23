#!/usr/bin/env bash
# The web app's own post-deploy checks, run by scripts/smoke.mjs after the
# web app's commit-freshness gate has passed (#173 moved them here from
# smoke.yml). Every deployed app's URL is in the environment under its
# project.json name, upper-cased: $API, $WEB. Nothing here calls the API, so
# the API's rate-limit burst, whenever it runs, cannot starve these checks.
#
# Each check is a subshell function, so an `exit` inside one ends that check
# only, exactly as it ended its own workflow step before.
# `set -e` and nothing more: the options GitHub gave the workflow steps these
# checks were written for. Not pipefail: `printf "$page" | grep -q …` has
# grep exit at its first match, printf dies of SIGPIPE writing the rest of a
# large page, and under pipefail that 141 turns a match into a failure. That
# is what #178 was, and scripts/test/smoke.test.ts keeps it from coming back.
set -e
: "${WEB:?WEB is not set}"

current_bundle() (
  for attempt in $(seq 1 30); do
    page=$(curl -fsS --max-time 30 "$WEB" || true)
    bundle=$(printf '%s' "$page" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
    echo "attempt $attempt: bundle=$bundle"
    if [ -n "$bundle" ] && curl -fsS --max-time 30 "$WEB$bundle" | grep -q 'generations'; then
      echo "web ok"; exit 0
    fi
    sleep 15
  done
  echo "web never served a bundle querying generations" >&2
  exit 1
)

docs_served() (
  # These pages are built by a prebuild step, so a broken build shows up as
  # missing documentation rather than as a failed deploy. Retried for the
  # same reason as the API's manual: a page can lag the deployment.
  for attempt in $(seq 1 30); do
    missing=''
    for path in /docs/ /docs/adoption.html /docs/data-governance.html \
                /docs/sops.html /docs/extraction.html /docs/step-0.html \
                /docs/manual/web/; do
      curl -fsS --max-time 30 -o /dev/null "$WEB$path" || missing="$missing $path"
    done
    if [ -z "$missing" ]; then
      echo "attempt $attempt: every doc page served"
      curl -fsS --max-time 30 "$WEB/docs/adoption.html" \
        | grep -q 'Steps of AI Adoption' \
        || { echo "adoption.html did not render its heading" >&2; exit 1; }
      curl -fsS --max-time 30 "$WEB/docs/data-governance.html" \
        | grep -q 'Data governance' \
        || { echo "data-governance.html did not render its heading" >&2; exit 1; }
      exit 0
    fi
    echo "attempt $attempt: missing$missing"
    sleep 15
  done
  echo "the web deployment never served the docs" >&2
  exit 1
)

# Run each check plainly, not inside `if`: a condition switches `set -e` off
# for everything it calls, and these bodies were written for a step shell
# where a failing command ends the step. On failure set -e ends the script
# and the trap names the check that did it.
CURRENT=setup
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "::endgroup::"; echo "FAILED: $CURRENT" >&2; fi' EXIT
check() {
  CURRENT=$1
  echo "::group::$1"
  "$2"
  echo "::endgroup::"
}

check 'the web app serves the current bundle' current_bundle
check 'the web deployment serves the docs' docs_served
