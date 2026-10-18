import type { Ev } from "./services/websocket";

export const initialSessionState = {
  status: "READY",
  partial: "",
  finals: [] as string[],
  question: "",
  qtype: "",
  answer: "",
  points: [] as string[],
  followUp: "",
  confidence: "",
  possible: "",
  metrics: null as Record<string, unknown> | null,
  error: "",
  detected: false,
  phaseReason: "",
};

export type SessionState = typeof initialSessionState;

export function reduceSessionState(s: SessionState, e: Ev): SessionState {
  switch (e.type) {
    case "status":
      return { ...s, status: e.status, error: e.status === "ERROR" ? s.error : "" };
    case "phase":
      return { ...s, status: e.status, phaseReason: e.reason || "" };
    case "transcript_partial":
      return { ...s, partial: e.text };
    case "transcript_final":
      return { ...s, partial: "", finals: [...s.finals.slice(-3), e.text] };
    case "possible_question":
      return { ...s, possible: e.question };
    case "question_detected":
      return { ...s, question: e.question, qtype: e.qtype, detected: true, possible: "", error: "" };
    case "answer_start":
      return { ...s, question: e.question, answer: "", points: [], followUp: "", confidence: "", metrics: null };
    case "answer_token":
      return { ...s, answer: s.answer + e.text };
    case "answer_complete":
      return {
        ...s,
        answer: e.answer,
        points: e.key_points,
        followUp: e.follow_up,
        confidence: e.confidence,
        metrics: e.metrics,
      };
    case "error":
      return { ...s, error: e.message, status: "ERROR" };
    case "clear":
      return { ...initialSessionState, status: s.status === "ERROR" ? "READY" : s.status };
    default:
      return s;
  }
}
