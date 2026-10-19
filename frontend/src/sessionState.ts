import type { Ev } from "./services/websocket";

export type AnswerTurn = {
  qid: number;
  question: string;
  answer: string;
  done: boolean;
};

export const initialSessionState = {
  status: "READY",
  partial: "",
  finals: [] as string[],
  question: "",
  qtype: "",
  answer: "",
  turns: [] as AnswerTurn[],
  points: [] as string[],
  followUp: "",
  confidence: "",
  possible: "",
  metrics: null as Record<string, unknown> | null,
  error: "",
  detected: false,
  phaseReason: "",
};

function putTurn(
  turns: AnswerTurn[],
  qid: number | undefined,
  question: string,
  patch: Partial<AnswerTurn>,
): AnswerTurn[] {
  const id = typeof qid === "number" ? qid : turns.length ? turns[turns.length - 1].qid : 0;
  const idx = turns.findIndex((turn) => turn.qid === id);
  if (idx < 0) {
    return [...turns, { qid: id, question, answer: "", done: false, ...patch }];
  }
  const next = turns.slice();
  next[idx] = { ...next[idx], ...patch, question: question || next[idx].question };
  return next;
}

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
      return {
        ...s,
        question: e.question,
        qtype: e.qtype,
        detected: true,
        possible: "",
        error: "",
        turns: putTurn(s.turns, e.qid, e.question, {}),
      };
    case "answer_start":
      return {
        ...s,
        question: e.question,
        answer: "",
        points: [],
        followUp: "",
        confidence: "",
        metrics: null,
        turns: putTurn(s.turns, e.qid, e.question, { answer: "", done: false }),
      };
    case "answer_token": {
      const turns = putTurn(s.turns, e.qid, "", {});
      const id = typeof e.qid === "number" ? e.qid : turns.length ? turns[turns.length - 1].qid : 0;
      const next = turns.map((turn) => (turn.qid === id ? { ...turn, answer: turn.answer + e.text } : turn));
      const current = next.find((turn) => turn.qid === id);
      return { ...s, turns: next, answer: current?.answer ?? s.answer };
    }
    case "answer_complete": {
      const turns = putTurn(s.turns, e.qid, e.question || s.question, { answer: e.answer, done: true });
      return {
        ...s,
        answer: e.answer,
        points: e.key_points,
        followUp: e.follow_up,
        confidence: e.confidence,
        metrics: e.metrics,
        turns,
      };
    }
    case "error":
      return { ...s, error: e.message, status: "ERROR" };
    case "clear":
      return { ...initialSessionState, status: s.status === "ERROR" ? "READY" : s.status };
    default:
      return s;
  }
}
