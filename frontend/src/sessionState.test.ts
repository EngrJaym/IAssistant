import { describe, expect, it } from "vitest";
import { initialSessionState, reduceSessionState } from "./sessionState";

describe("reduceSessionState", () => {
  it("streams answer tokens then completes", () => {
    let s = reduceSessionState(initialSessionState, {
      type: "question_detected",
      question: "What is Docker?",
      qtype: "TECHNICAL_QUESTION",
    });
    s = reduceSessionState(s, { type: "answer_start", question: "What is Docker?" });
    s = reduceSessionState(s, { type: "answer_token", text: "Docker " });
    s = reduceSessionState(s, { type: "answer_token", text: "containers." });
    s = reduceSessionState(s, {
      type: "answer_complete",
      answer: "Docker containers.",
      key_points: ["Isolation"],
      follow_up: "",
      confidence: "high",
      metrics: { total_ms: 120 },
    });
    expect(s.answer).toBe("Docker containers.");
    expect(s.turns).toEqual([
      { qid: 0, question: "What is Docker?", answer: "Docker containers.", done: true },
    ]);
    expect(s.points).toEqual(["Isolation"]);
    expect(s.metrics).toEqual({ total_ms: 120 });
  });

  it("keeps each queued answer on its own question", () => {
    let s = reduceSessionState(initialSessionState, { type: "question_detected", question: "What is Docker?", qid: 1 });
    s = reduceSessionState(s, { type: "question_detected", question: "How do you scale it?", qid: 2 });
    s = reduceSessionState(s, { type: "answer_start", question: "What is Docker?", qid: 1 });
    s = reduceSessionState(s, { type: "answer_token", text: "Containers.", qid: 1 });
    s = reduceSessionState(s, { type: "answer_token", text: "Later.", qid: 2 });
    expect(s.turns.map((turn) => turn.answer)).toEqual(["Containers.", "Later."]);
  });

  it("keeps only the last four final transcript lines", () => {
    let s = initialSessionState;
    for (const line of ["a", "b", "c", "d", "e"]) {
      s = reduceSessionState(s, { type: "transcript_final", text: line, ts: 1 });
    }
    expect(s.finals).toEqual(["b", "c", "d", "e"]);
  });

  it("maps phase events to status and reason", () => {
    const s = reduceSessionState(initialSessionState, {
      type: "phase",
      status: "LISTENING",
      reason: "turn ended",
    });
    expect(s.status).toBe("LISTENING");
    expect(s.phaseReason).toBe("turn ended");
  });

  it("resets to ready after clear following an error", () => {
    const errored = reduceSessionState(initialSessionState, { type: "error", message: "boom" });
    expect(errored.status).toBe("ERROR");
    const cleared = reduceSessionState(errored, { type: "clear" });
    expect(cleared.status).toBe("READY");
    expect(cleared.error).toBe("");
    expect(cleared.answer).toBe("");
  });
});
