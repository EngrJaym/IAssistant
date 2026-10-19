import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, STYLE_PRESETS, parseTemplates, serializeTemplates, withDefaultStyle } from "./stylePresets";

describe("style presets", () => {
  it("keeps example and no-example strategies distinct", () => {
    expect(STYLE_PRESETS[DEFAULT_STYLE]).toMatch(/one concrete example/i);
    expect(STYLE_PRESETS["No example"]).toMatch(/do not use an example/i);
    expect(STYLE_PRESETS["STAR story"]).toMatch(/situation/i);
    expect(STYLE_PRESETS["With example"]).not.toMatch(/using only my resume/i);
  });

  it("upgrades retired preset text to the matching strategy", () => {
    const legacy =
      "Answer as me, in the first person, using only my resume and profile. Use short everyday words a non-technical person can follow. Give a concise explanation, one simple example, and one analogy a beginner would understand. If you must use a technical term, explain it in plain language right away.";
    expect(withDefaultStyle({ instructions: legacy }).instructions).toBe(STYLE_PRESETS["With example"]);
    expect(withDefaultStyle({ instructions: "Keep answers short and conversational, as if spoken aloud." }).instructions).toBe(
      STYLE_PRESETS.Concise,
    );
    expect(withDefaultStyle({ instructions: "Keep it formal." }).instructions).toBe("Keep it formal.");
  });
});

describe("parseTemplates", () => {
  it("keeps titled templates and drops incomplete ones", () => {
    const raw = JSON.stringify([
      { id: "a", title: "Board update", body: "Lead with the decision." },
      { id: "", title: "Missing", body: "no" },
      { title: "No id", body: "x" },
    ]);
    expect(parseTemplates(raw)).toEqual([{ id: "a", title: "Board update", body: "Lead with the decision." }]);
    expect(serializeTemplates([])).toBe("");
  });
});
