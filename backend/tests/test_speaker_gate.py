from app.speaker_gate import speaker_status_label
from app.turn_router import route_turn


def test_status_is_interviewer_only():
    assert speaker_status_label() == "Listening for interviewer questions"
    assert "Manual" not in speaker_status_label("You", False)


def test_answers_interviewer_questions():
    for text in (
        "What is Docker?",
        "Can you tell me about your experience with Python?",
        "Walk me through how you designed this.",
        "What about performance?",
        "Tell me about yourself.",
        "What are your salary expectations?",
        "Where do you see yourself in five years?",
    ):
        route = route_turn(text, "QUESTION" if "performance" not in text.lower() else "FOLLOW_UP_QUESTION")
        assert route.should_answer, text
        assert route.speaker == "Interviewer"


def test_skips_personal_questions():
    for text in (
        "How old are you?",
        "Are you married?",
        "Do you have any children?",
        "What is your religion?",
        "Where are you from?",
        "What's your current salary?",
        "Do you have a disability?",
    ):
        route = route_turn(text, "QUESTION")
        assert route.kind == "personal", text
        assert route.should_answer is False


def test_skips_candidate_answers():
    route = route_turn(
        "I would use a token bucket in Redis and expire idle keys.",
        "AMBIGUOUS",
        last_question="How would you rate limit an API?",
    )
    assert route.speaker == "You"
    assert route.kind == "candidate_answer"
    assert route.should_answer is False

    echoed = route_turn(
        "Docker packages apps into containers. I use it for repeatable deployments across staging and production.",
        "STATEMENT",
        last_answer="Docker packages apps into containers. I use it for repeatable deployments across staging and production.",
    )
    assert echoed.kind == "candidate_answer"
    assert echoed.should_answer is False


def test_interview_prompt_is_not_candidate_speech():
    route = route_turn("I'd like you to walk me through your upload pipeline.", "QUESTION")
    assert route.should_answer is True
    assert route.speaker == "Interviewer"


def test_ambiguous_statement_needs_classifier():
    route = route_turn("So I see you've been working with containers.", "AMBIGUOUS")
    assert route.certain is False
    assert route.should_answer is False
