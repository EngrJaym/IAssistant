from app import db


def test_memory_user_and_profile_roundtrip():
    uid = db.upsert_user("google", "sub-1", "a@example.com", "Ada", None)
    assert uid
    db.save_profile(uid, {"resume": "Engineer"})
    assert db.get_profile(uid)["resume"] == "Engineer"
    row = db.get_user(uid)
    assert row and row["email"] == "a@example.com"


def test_meeting_owned_by_anonymous():
    mid = db.create_meeting("groq", "groq", "groq", user_id=None)
    assert db.meeting_owned_by(mid, "any") is False
    assert db.get_meeting(mid) is not None
