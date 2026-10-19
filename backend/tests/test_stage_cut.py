import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.stage_cut import after_cut, merge_gather, peel_cuts, worth_staging


def test_merge_prefers_the_longer_cumulative_partial():
    assert merge_gather("How would you design", "How would you design a cache") == "How would you design a cache"
    assert merge_gather("How would you design a cache", "How would you design") == "How would you design a cache"


def test_merge_appends_a_new_fragment():
    assert merge_gather("How would you design", "a cache") == "How would you design a cache"


def test_after_cut_keeps_only_the_new_tail():
    assert after_cut(
        "How would you design a cache for user sessions?",
        "How would you design a cache",
    ) == "for user sessions?"


def test_after_cut_drops_a_restatement_and_keeps_a_new_question():
    assert after_cut("How would you design a cache?", "How would you design a cache") == ""
    assert after_cut("What is Redis?", "How would you design a cache") == "What is Redis?"


def test_peel_applies_staged_parts_in_order():
    assert peel_cuts(
        "How would you scale this service?",
        ["How would you", "scale this service"],
    ) == ""


def test_worth_staging_rejects_filler_and_tiny_fragments():
    assert not worth_staging("okay")
    assert not worth_staging("um hi")
    assert worth_staging("How would you")
    assert worth_staging("What is Docker?")
