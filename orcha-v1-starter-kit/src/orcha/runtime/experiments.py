"""Evidence-only evaluation and decision rules for local Evolution records."""

from __future__ import annotations

from dataclasses import dataclass

from orcha.domain.models import Experiment


@dataclass(frozen=True)
class ExperimentEvaluation:
    promotable: bool
    reason: str
    baseline_average: float | None = None
    candidate_average: float | None = None
    baseline_samples: int = 0
    candidate_samples: int = 0


def evaluate(experiment: Experiment) -> ExperimentEvaluation:
    """Evaluate stored evidence without taking any deployment action."""
    baseline = [item for item in experiment.observations if item.variant == "baseline"]
    candidate = [item for item in experiment.observations if item.variant == "candidate"]
    if len(baseline) < experiment.minimum_observations or len(candidate) < experiment.minimum_observations:
        return ExperimentEvaluation(
            False,
            f"Need at least {experiment.minimum_observations} baseline and candidate observations before promotion.",
            baseline_samples=len(baseline), candidate_samples=len(candidate),
        )

    for item in candidate:
        for name, minimum in experiment.guardrails.items():
            value = item.guardrail_values.get(name)
            if value is None:
                return ExperimentEvaluation(False, f"Candidate evidence is missing the {name} guardrail.", baseline_samples=len(baseline), candidate_samples=len(candidate))
            if value < minimum:
                return ExperimentEvaluation(False, f"Candidate violated the {name} guardrail ({value:g} < {minimum:g}).", baseline_samples=len(baseline), candidate_samples=len(candidate))

    baseline_average = sum(item.primary_value for item in baseline) / len(baseline)
    candidate_average = sum(item.primary_value for item in candidate) / len(candidate)
    required = baseline_average * (1 + experiment.minimum_improvement) if baseline_average > 0 else baseline_average + experiment.minimum_improvement
    if candidate_average < required:
        return ExperimentEvaluation(
            False,
            f"Candidate {experiment.primary_metric} average {candidate_average:.4g} did not reach required {required:.4g}.",
            baseline_average, candidate_average, len(baseline), len(candidate),
        )
    return ExperimentEvaluation(
        True,
        f"Candidate improved {experiment.primary_metric} from {baseline_average:.4g} to {candidate_average:.4g} with all guardrails satisfied.",
        baseline_average, candidate_average, len(baseline), len(candidate),
    )
