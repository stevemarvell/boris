"""The committed Vercel firewall rule says the same thing as api.limits.

The in-process limiter in api.limits counts per Vercel instance, and Vercel
runs several under a burst (#128), so the ceiling that actually holds is the
WAF rule in apps/api/firewall.json, counted at the edge. Two files now state
one limit. These tests are what stop them drifting apart: a change to either
the limit or the limited paths that is not made in both goes red here.

They cannot prove the rule is *applied* -- only the smoke workflow's burst
against the deployed API can (SOP 3). They prove the file is the rule the
docstrings describe.
"""

import json
import re
from pathlib import Path

import pytest
from limits import parse

from api import limits

FIREWALL = Path(__file__).resolve().parents[1] / "firewall.json"


@pytest.fixture(scope="module")
def rule() -> dict:
    config = json.loads(FIREWALL.read_text(encoding="utf-8"))
    assert config["firewallEnabled"] is True
    rate_rules = [r for r in config["rules"] if r["action"]["mitigate"]["action"] == "rate_limit"]
    # Hobby allows one rate-limit rule per project; a second would be refused
    # at apply time, so it is refused here first.
    assert len(rate_rules) == 1
    return rate_rules[0]


def test_rule_is_active_and_keyed_per_client_ip(rule: dict) -> None:
    rate = rule["action"]["mitigate"]["rateLimit"]
    assert rule["active"] is True
    assert rate["keys"] == ["ip"]
    assert rate["algo"] == "fixed_window"
    assert rate["action"] == "rate_limit"


def test_rule_limit_matches_the_in_process_default(rule: dict) -> None:
    rate = rule["action"]["mitigate"]["rateLimit"]
    item = parse(limits.DEFAULT_RATE_LIMIT)
    assert rate["limit"] == item.amount
    assert rate["window"] == item.get_expiry()


PATHS = [
    "/graphql",
    "/graphql/",
    "/person",
    "/person/p1",
    "/me",
    "/me/x",
    "/health",
    "/",
    "/index.html",
    "/graphqlx",
    "/persona",
    "/media",
    "/api/graphql",
]


@pytest.mark.parametrize("path", PATHS)
def test_rule_matches_exactly_the_paths_the_app_limits(rule: dict, path: str) -> None:
    (group,) = rule["conditionGroup"]
    (condition,) = group["conditions"]
    assert condition["type"] == "path"
    assert condition["op"] == "re"
    matched = re.search(condition["value"], path) is not None
    assert matched == limits.is_limited_path(path)


def test_rule_never_limits_health(rule: dict) -> None:
    """/health is what readiness polls; a 429 there is the wrong signal."""
    (group,) = rule["conditionGroup"]
    (condition,) = group["conditions"]
    assert re.search(condition["value"], "/health") is None
