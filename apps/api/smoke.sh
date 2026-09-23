#!/usr/bin/env bash
# The API's own post-deploy checks, run by scripts/smoke.mjs after the API's
# commit-freshness gate has passed (#173 moved them here from smoke.yml, so
# the AI layer's workflow names no application). Every deployed app's URL is
# in the environment under its project.json name, upper-cased: $API, $WEB.
#
# Each check is a subshell function, so an `exit` inside one ends that check
# only, exactly as it ended its own workflow step before.
# `set -e` and nothing more: the options GitHub gave the workflow steps these
# checks were written for. Not pipefail: `printf "$page" | grep -q …` has
# grep exit at its first match, printf dies of SIGPIPE writing the rest of a
# large page, and under pipefail that 141 turns a match into a failure. That
# is what #178 was, and scripts/test/smoke.test.ts keeps it from coming back.
set -e
: "${API:?API is not set}" "${WEB:?WEB is not set}"

loaded_tree() (
  # The API is a Vercel serverless function, so the first request after an
  # idle period is a cold start.
  for attempt in $(seq 1 30); do
    body=$(curl -fsS --max-time 30 "$API/health" || true)
    echo "attempt $attempt: $body"
    case "$body" in *'"people":44'*) echo "API ok"; exit 0;; esac
    sleep 15
  done
  echo "API never reported 44 people" >&2
  exit 1
)

four_generations() (
  counts=$(curl -fsS --max-time 30 -X POST "$API/graphql" \
    -H 'content-type: application/json' \
    -d '{"query":"{ generations { depth people { id } } }"}' \
    | python3 -c 'import json,sys; g=json.load(sys.stdin)["data"]["generations"]; print(len(g), sum(len(x["people"]) for x in g))')
  echo "generations people = $counts"
  [ "$counts" = "4 44" ] || { echo "expected '4 44'" >&2; exit 1; }
)

own_manual() (
  # The manual is bundled into the API deployment. If a build change drops
  # it, nothing else notices: the API keeps answering GraphQL and the
  # documentation quietly 404s.
  #
  # This retries, and has to. The freshness gate is satisfied by the build
  # having been deployed, not by it answering every path yet — the first run
  # of this check failed 10 seconds after a merge, against an API that was
  # still the old build.
  #
  # Which is why the assertion is the wait. Anything a new build changes has
  # to be a reason to go round again, never a reason to fail: "Family Tree
  # API" matches the old manual exactly as well as the new one, so on its own
  # it cannot tell a live deployment from a stale one. Only once the page is
  # in the state this build put it in do the remaining checks — the ones a
  # correct build cannot fail — become hard failures. A check added here
  # belongs inside the retry, not after it.
  for attempt in $(seq 1 30); do
    page=$(curl -fsS --max-time 30 "$API/" || true)

    if ! printf '%s' "$page" | grep -q 'Family Tree API'; then
      echo "attempt $attempt: the API root is not serving the manual yet"
      sleep 15
      continue
    fi

    # Production serves the manual, not its query console: the console is
    # gated on API_ENVIRONMENT, which is unset on the Vercel project and so
    # reads "production". The endpoint string is the console's fetch target
    # and appears nowhere else in the page — which is also what makes it the
    # signal for "this is the new build", since the build before it genuinely
    # does carry a console.
    if printf '%s' "$page" | grep -q "var ENDPOINT = '/graphql'"; then
      echo "attempt $attempt: the manual still carries its console; waiting for the new build"
      sleep 15
      continue
    fi

    echo "attempt $attempt: manual served, console gated"

    # The new build is live, so nothing below is timing-dependent.
    printf '%s' "$page" | grep -q 'without its query console' \
      || { echo "the manual does not explain the missing console" >&2; exit 1; }
    curl -fsS --max-time 30 -o /dev/null "$API/app-generations.jpg" \
      || { echo "the manual's screenshots did not ship with it" >&2; exit 1; }
    exit 0
  done
  echo "the API never served a manual with its console gated" >&2
  exit 1
)

schema_withheld() (
  # FastAPI serves /docs, /redoc and /openapi.json by default, so they were
  # live and unauthenticated on this host: Swagger UI is an interactive
  # console with a "Try it out" button, and openapi.json publishes the
  # parameters and response schemas of every route. They are now gated on
  # API_ENVIRONMENT, the same mechanism as the GraphiQL IDE, introspection and
  # the manual's console, which is unset on the Vercel project and so reads
  # "production".
  #
  # The assertion is the wait, for the reason own_manual records. A cold
  # start or a proxy error answers with neither 404 nor a served page, and is
  # retried for the same reason.
  for attempt in $(seq 1 30); do
    open_paths=''
    for path in /docs /redoc /openapi.json; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$API$path" || echo 000)
      [ "$code" = 404 ] || open_paths="$open_paths $path=$code"
    done
    if [ -z "$open_paths" ]; then
      echo "attempt $attempt: /docs, /redoc and /openapi.json all 404"
      exit 0
    fi
    echo "attempt $attempt: schema surface still answering:$open_paths"
    sleep 15
  done
  echo "the API never stopped serving /docs, /redoc and /openapi.json" >&2
  exit 1
)

cors_from_web() (
  headers=$(mktemp)
  allowed=$(curl -fsS -o /dev/null -w '%{http_code}' -X OPTIONS "$API/graphql" \
    -H "Origin: $WEB" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    -D "$headers" && grep -i '^access-control-allow-origin' "$headers")
  echo "$allowed"
  printf '%s' "$allowed" | grep -qi "$WEB" || { echo "CORS does not allow the web origin" >&2; exit 1; }
)

burst_refused_at_edge() (
  # The in-process limiter counts per Vercel instance, and a burst is answered
  # by several (#128). The ceiling that holds is the WAF rule in
  # apps/api/firewall.json, counted at Vercel's edge. A refusal from the edge
  # never reaches the function, so it carries none of slowapi's
  # X-RateLimit-* headers -- that is how the two are told apart. 300 requests
  # against 120/60s: even a burst straddling a fixed-window boundary (at most
  # 240 allowed) must see edge refusals.
  burst=$(mktemp -d)
  export API burst
  seq 1 300 | xargs -P 50 -I{} sh -c 'curl -s -o /dev/null -D "$burst/{}" --max-time 30 \
    -X POST "$API/graphql" -H "content-type: application/json" \
    -d "{\"query\":\"{ status }\"}" || true'
  ok=0; app429=0; edge429=0; other=0
  for f in "$burst"/*; do
    code=$(head -1 "$f" | awk '{print $2}')
    case "$code" in
      200) ok=$((ok+1));;
      429) if grep -qi '^x-ratelimit-limit' "$f"; then app429=$((app429+1)); else edge429=$((edge429+1)); fi;;
      *) other=$((other+1));;
    esac
  done
  echo "200=$ok app-429=$app429 edge-429=$edge429 other=$other"
  [ "$edge429" -gt 0 ] || { echo "no request was refused at the edge: the WAF rule is not in force" >&2; exit 1; }
  [ "$ok" -le 240 ] || { echo "$ok requests allowed against 120/60s: the limit is not holding" >&2; exit 1; }
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

check 'the API reports the loaded tree' loaded_tree
check 'GraphQL returns four generations' four_generations
check 'the API serves its own manual' own_manual
check 'the API withholds its OpenAPI schema' schema_withheld
check 'CORS allows the deployed web origin' cors_from_web
# Last on purpose: this burst spends the caller's whole rate-limit budget for
# a minute, and any /graphql check after it would be refused.
check 'a concurrent burst is refused at the edge' burst_refused_at_edge
