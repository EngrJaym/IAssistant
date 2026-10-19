const SHARED =
  "Answer as me, in the first person, in words I would say out loud. Answer the question correctly even when it is not on my resume. Use a real detail from my background when it naturally fits, and otherwise do not mention the resume. Never apologize, invent experience, companies, or metrics, or frame a missing detail as a weakness.";

export const STYLE_PRESETS: Record<string, string> = {
  "With example":
    SHARED +
    " Give a short direct answer, then one concrete example. Use a real piece of my work when it fits, or a simple everyday situation when the question is general. Do not add a second story. About 80 to 120 words.",
  "No example":
    SHARED +
    " Do not use an example, analogy, or story. State the answer, the reason, and the outcome in a few spoken sentences. Under 70 words.",
  "STAR story":
    SHARED +
    " Shape the answer as a STAR story: the situation, my task, the action I took, and the result. Use only a real item from my resume or profile. If nothing real fits, answer directly and do not invent a story. Keep it spoken and under 140 words.",
  Concise:
    SHARED +
    " Use two or three short spoken sentences. No example unless the question asks for one. No analogy.",
  "Senior judgment":
    SHARED +
    " Answer as a senior candidate. Name the trade-off, the choice I would make, and why. Add one brief example only when it shows that judgment. Under 120 words.",
  "Teach it simply":
    SHARED +
    " Explain it so a non-technical person can follow. If a technical word is necessary, define it in plain language immediately. Include one simple example and one beginner analogy.",
  Technical:
    SHARED +
    " Be precise. Name the approach, one constraint, and how I would build, debug, or measure it. Do not use an analogy. A concrete example is optional. Under 130 words.",
  Behavioral:
    SHARED +
    " Treat this as a behavioral answer: what I did, what changed because of it, and what I would repeat. Calm and specific. One real example only. No jargon.",
};

export const DEFAULT_STYLE = "With example";

const LEGACY_PLAIN =
  "Answer as me, in the first person, using only my resume and profile. Use short everyday words a non-technical person can follow. Give a concise explanation, one simple example, and one analogy a beginner would understand. If you must use a technical term, explain it in plain language right away.";

const PREVIOUS_PRESETS: Record<string, string> = {
  Plain:
    "Answer as me, in the first person. Answer the question correctly even when it is not on my resume. Treat my resume as background: use a real detail when it fits, relate the answer to something I actually did when that is natural, and otherwise do not relate it or mention the resume. Never apologize, say you lack resume details, or frame the answer as a weakness. Use short everyday words a non-technical person can follow. Give a concise explanation, one simple example, and one analogy a beginner would understand. If you must use a technical term, explain it in plain language right away.",
  Concise: "Keep answers short and conversational, as if spoken aloud.",
  Senior: "Answer as a senior engineer with trade-offs, under 120 words.",
  STAR: "Use natural STAR stories from my resume only.",
  Simple: "Explain simply, under 90 words.",
};

const LEGACY_TO_PRESET: Record<string, string> = {
  [LEGACY_PLAIN]: "With example",
  [PREVIOUS_PRESETS.Plain]: "With example",
  [PREVIOUS_PRESETS.Concise]: "Concise",
  [PREVIOUS_PRESETS.Senior]: "Senior judgment",
  [PREVIOUS_PRESETS.STAR]: "STAR story",
  [PREVIOUS_PRESETS.Simple]: "Teach it simply",
};

export function withDefaultStyle(profile: Record<string, string>): Record<string, string> {
  const instructions = (profile.instructions ?? "").trim();
  const upgraded = LEGACY_TO_PRESET[instructions];
  if (!instructions || upgraded) {
    return { ...profile, instructions: STYLE_PRESETS[upgraded || DEFAULT_STYLE] };
  }
  return profile;
}

export type StyleTemplate = {
  id: string;
  title: string;
  body: string;
};

const MAX_TEMPLATES = 12;

export function newTemplateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseTemplates(raw: string | undefined | null): StyleTemplate[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: StyleTemplate[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id ?? "").trim().slice(0, 80);
      if (!id) continue;
      const title = String(item.title ?? "").trim().slice(0, 60) || "Untitled";
      const body = String(item.body ?? "").slice(0, 2000);
      out.push({ id, title, body });
      if (out.length >= MAX_TEMPLATES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeTemplates(templates: StyleTemplate[]): string {
  const clean = templates
    .filter((item) => item.id)
    .slice(0, MAX_TEMPLATES)
    .map((item) => ({
      id: item.id.slice(0, 80),
      title: item.title.trim().slice(0, 60) || "Untitled",
      body: item.body.slice(0, 2000),
    }));
  return clean.length ? JSON.stringify(clean) : "";
}
