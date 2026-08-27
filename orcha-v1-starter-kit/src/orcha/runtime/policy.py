"""Small, enforceable runtime limits for autonomous local work."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str = ""


class RuntimePolicy:
    """Applies a per-company daily run cap and estimated-cost ceiling.

    This is intentionally conservative and operates before a model request. A
    hosted runtime can replace this class with a quota service while keeping the
    runner contract unchanged.
    """

    def __init__(self, store):
        self.store = store

    @staticmethod
    def _number(name: str, default: float) -> float:
        try:
            return max(0.0, float(os.getenv(name, str(default))))
        except ValueError:
            return default

    def can_start(self, company) -> PolicyDecision:
        usage = self.store.daily_usage(company.id)
        max_runs = int(self._number("ORCHA_MAX_AGENT_RUNS_PER_DAY", 40))
        if usage["runs"] >= max_runs:
            return PolicyDecision(False, "Daily agent-run limit reached. Resume tomorrow or raise the server limit.")
        global_budget = self._number("ORCHA_MAX_COMPANY_BUDGET_USD", 25)
        constraint_budget = company.constraints.get("budget_usd") if isinstance(company.constraints, dict) else None
        try:
            company_budget = min(global_budget, float(constraint_budget)) if constraint_budget is not None else global_budget
        except (TypeError, ValueError):
            company_budget = global_budget
        reserve = self._number("ORCHA_AGENT_MAX_ESTIMATED_RUN_USD", 0.25)
        if usage["estimatedUsd"] + reserve > company_budget:
            return PolicyDecision(False, "Company budget reserve reached. Increase the budget or wait for review.")
        return PolicyDecision(True)
