"""Mapping validation: sampling and metrics (panel comment 1).

* Sampling — a stratified random sample of AI-mapped assessment items, allocated to
  courses and, within a course, to confidence bands (>= / < the review threshold) in
  proportion to their size. The seed is stored so the sample can be reproduced.
* Ground truth — majority vote of the assigned validators (2 of 3, or both of 2);
  when there is no majority the Program Chair (adjudicator) breaks the tie.
* Metrics — accuracy (AI answer == ground truth, never the AI's own confidence) with a
  95% Wilson interval, inter-rater agreement before tie-breaks (Cohen's kappa for two
  validators, Fleiss' kappa for three), accuracy per competency and per confidence band.
"""
import math
import random
from collections import Counter, defaultdict

from sqlalchemy.orm import Session

from backend.models.assessment import Assessment, AssessmentItem
from backend.models.mapping_validation import MappingValidationItem

NONE = "none"  # label key for "no matching competency"
DEFAULT_SAMPLE_SIZE = 50  # capstone protocol: 50 items × 3 experts; report the Wilson CI with it


# ── sampling ──────────────────────────────────────────────────────────────────

def eligible_items(db: Session, course_ids) -> list[AssessmentItem]:
    """Items the AI actually mapped (pre-tagged CSV items have no AI answer to score)."""
    return (db.query(AssessmentItem)
            .join(Assessment, AssessmentItem.assessment_id == Assessment.id)
            .filter(Assessment.course_id.in_(course_ids), AssessmentItem.ai_mapped_at.isnot(None))
            .all())


def _allocate(sizes: dict, n: int) -> dict:
    """Largest-remainder proportional allocation of n across strata (never above a stratum's size)."""
    total = sum(sizes.values())
    if total <= n:
        return dict(sizes)
    raw = {k: n * v / total for k, v in sizes.items()}
    alloc = {k: min(int(r), sizes[k]) for k, r in raw.items()}
    leftover = n - sum(alloc.values())
    for k in sorted(raw, key=lambda k: raw[k] - int(raw[k]), reverse=True):
        if leftover <= 0:
            break
        if alloc[k] < sizes[k]:
            alloc[k] += 1
            leftover -= 1
    return alloc


def draw_sample(items: list[AssessmentItem], course_of: dict, n: int, seed: int, threshold: float):
    """Return [(item, course_id, band)] — stratified by course, then confidence band."""
    rng = random.Random(seed)
    strata = defaultdict(list)
    for it in sorted(items, key=lambda i: str(i.id)):   # stable order before shuffling
        conf = it.ai_confidence if it.ai_confidence is not None else it.confidence_score
        band = "high" if conf is not None and conf >= threshold else "low"
        strata[(course_of[str(it.id)], band)].append(it)
    by_course = defaultdict(int)
    for (course, _), its in strata.items():
        by_course[course] += len(its)
    per_course = _allocate(dict(by_course), n)
    chosen = []
    for course, k in per_course.items():
        bands = {band: len(its) for (c, band), its in strata.items() if c == course}
        for band, m in _allocate(bands, k).items():
            chosen += [(it, course, band) for it in rng.sample(strata[(course, band)], m)]
    rng.shuffle(chosen)
    return chosen


# ── metrics (pure functions) ──────────────────────────────────────────────────

def wilson_interval(successes: int, n: int, z: float = 1.96):
    if n == 0:
        return None, None
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return round(max(0.0, centre - half) * 100, 1), round(min(1.0, centre + half) * 100, 1)


def cohens_kappa(pairs: list[tuple]) -> float | None:
    """Cohen's kappa for two raters over categorical labels [(a, b), ...]."""
    n = len(pairs)
    if n == 0:
        return None
    observed = sum(1 for a, b in pairs if a == b) / n
    ca, cb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    expected = sum(ca[k] * cb.get(k, 0) for k in ca) / (n * n)
    if expected == 1:
        return 1.0
    return round((observed - expected) / (1 - expected), 3)


def fleiss_kappa(rows: list[tuple]) -> float | None:
    """Fleiss' kappa for a fixed number of raters per item [(a, b, c), ...]."""
    n = len(rows)
    if n == 0:
        return None
    m = len(rows[0])
    p_bar = sum((sum(v * v for v in Counter(r).values()) - m) / (m * (m - 1)) for r in rows) / n
    totals = Counter(l for r in rows for l in r)
    p_e = sum((v / (n * m)) ** 2 for v in totals.values())
    if p_e == 1:
        return 1.0
    return round((p_bar - p_e) / (1 - p_e), 3)


def label_key(competency_id, none_fits) -> str:
    return NONE if none_fits or competency_id is None else str(competency_id)


def voters(asg) -> list:
    """The assignment's validators (A, B and the optional C), unassigned slots dropped."""
    return [v for v in (asg.validator_a_id, asg.validator_b_id, getattr(asg, "validator_c_id", None)) if v]


def votes(item: MappingValidationItem, validators) -> list:
    """Labels given by the assigned validators, in A/B/C order (None = not labeled yet)."""
    labels = {str(l.validator_id): label_key(l.competency_id, l.none_fits) for l in item.labels}
    return [labels.get(str(v)) for v in validators]


def majority(item: MappingValidationItem, validators) -> str | None:
    """The label held by a majority of the validators (at least two), else None."""
    given = [v for v in votes(item, validators) if v is not None]
    if not given:
        return None
    label, count = Counter(given).most_common(1)[0]
    return label if count >= max(2, len(validators) // 2 + 1) else None


def needs_tie_break(item: MappingValidationItem, validators) -> bool:
    """Every validator has answered and no label has a majority."""
    v = votes(item, validators)
    return len(v) >= 2 and None not in v and majority(item, validators) is None


def ground_truth(item: MappingValidationItem, validators) -> str | None:
    """Majority label, else the Program Chair's tie-break, else None (still open)."""
    gt = majority(item, validators)
    if gt is not None:
        return gt
    if item.adjudication is not None:
        return label_key(item.adjudication.competency_id, item.adjudication.none_fits)
    return None


def decision(item: MappingValidationItem, validators) -> str | None:
    """How the ground truth was reached: unanimous, majority, program_chair."""
    if majority(item, validators) is not None:
        v = votes(item, validators)
        return "unanimous" if None not in v and len(set(v)) == 1 else "majority"
    return "program_chair" if item.adjudication is not None else None


def compute_metrics(items, assignments_by_course: dict, competency_names: dict, target: float = 85.0) -> dict:
    """items: MappingValidationItem with labels/adjudication loaded.
    assignments_by_course: {course_id: assignment}; competency_names: {id: (code, topic)}."""
    full, scored = [], []
    labeled = [0, 0, 0]
    disagreements = adjudicated = 0
    decisions = Counter()
    for it in items:
        asg = assignments_by_course.get(str(it.course_id))
        if asg is None:
            continue
        slots = (asg.validator_a_id, asg.validator_b_id, getattr(asg, "validator_c_id", None))
        for k, v in enumerate(votes(it, slots)):
            labeled[k] += v is not None
        vs = voters(asg)
        v = votes(it, vs)
        if len(v) >= 2 and None not in v:
            full.append(tuple(v))
        if needs_tie_break(it, vs):
            disagreements += 1
            adjudicated += it.adjudication is not None
        gt = ground_truth(it, vs)
        if gt is not None:
            decisions[decision(it, vs)] += 1
            ai = label_key(it.ai_competency_id, it.ai_competency_id is None)
            scored.append((it, gt, ai == gt))

    correct = sum(1 for _, _, ok in scored if ok)
    lo, hi = wilson_interval(correct, len(scored))
    accuracy = round(correct / len(scored) * 100, 1) if scored else None

    by_band = {}
    for band in ("high", "low"):
        rows = [ok for it, _, ok in scored if it.confidence_band == band]
        b_lo, b_hi = wilson_interval(sum(rows), len(rows))
        by_band[band] = {"items": len(rows), "correct": sum(rows),
                         "accuracy_pct": round(sum(rows) / len(rows) * 100, 1) if rows else None,
                         "ci_low": b_lo, "ci_high": b_hi}

    per_comp = defaultdict(lambda: [0, 0])
    for _, gt, ok in scored:
        per_comp[gt][0] += 1
        per_comp[gt][1] += ok
    by_competency = []
    for key, (n, ok) in per_comp.items():
        code, topic = competency_names.get(key, ("—", "No matching competency" if key == NONE else "Unknown"))
        by_competency.append({"competency_code": code, "topic_name": topic, "items": n, "correct": ok,
                              "accuracy_pct": round(ok / n * 100, 1)})
    by_competency.sort(key=lambda r: (r["accuracy_pct"], -r["items"]))

    # Agreement before tie-breaks: Fleiss for three-validator items, Cohen for two.
    triples = [r for r in full if len(r) == 3]
    rows = triples or [r for r in full if len(r) == 2]
    kappa = fleiss_kappa(triples) if triples else cohens_kappa(rows)

    total = len(items)
    return {
        "items": total,
        "labeled_by_both": len(full),   # labeled by every assigned validator
        "labeled_a": labeled[0],
        "labeled_b": labeled[1],
        "labeled_c": labeled[2],
        "disagreements": disagreements,
        "adjudicated": adjudicated,
        "awaiting_adjudication": disagreements - adjudicated,
        "ground_truth_items": len(scored),
        "correct": correct,
        "accuracy_pct": accuracy,
        "ci_low": lo,
        "ci_high": hi,
        "target_pct": target,
        "meets_target": accuracy is not None and accuracy >= target,
        # stricter reading: even the lower end of the 95% interval reaches the target
        "meets_target_at_ci_low": lo is not None and lo >= target,
        "kappa": kappa,
        "kappa_method": None if kappa is None else ("Fleiss" if triples else "Cohen"),
        "agreement_pct": round(sum(1 for r in rows if len(set(r)) == 1) / len(rows) * 100, 1) if rows else None,
        "decisions": {k: decisions[k] for k in ("unanimous", "majority", "program_chair")},
        "by_band": by_band,
        "by_competency": by_competency,
        "none_fits_ground_truth": sum(1 for _, gt, _ in scored if gt == NONE),
        "complete": total > 0 and len(scored) == total,
    }
