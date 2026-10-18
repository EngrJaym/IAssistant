import time

from app.transcript_merge import dedupe_final, merge_chunk_text


def test_merge_empty_and_substring():
    assert merge_chunk_text("", "hello") == "hello"
    assert merge_chunk_text("hello", "") == "hello"
    assert merge_chunk_text("full text here", "full text") == "full text here"
    assert merge_chunk_text("short", "short but longer") == "short but longer"


def test_merge_word_overlap_fuzzy():
    left = "we built a pipeline for uploads"
    right = "pipeline for uploads and retries"
    merged = merge_chunk_text(left, right)
    assert "retries" in merged
    assert merged.lower().count("pipeline") == 1


def test_dedupe_final_within_window():
    now = time.time()
    assert dedupe_final("What is Docker?", "", now=now) is False
    assert dedupe_final("What is Docker?", "What is Docker?", now=now, last_ts=now) is True
    assert (
        dedupe_final(
            "What is Docker?",
            "What is Docker?",
            now=now,
            last_ts=now - 10,
            within_sec=3.0,
        )
        is False
    )
