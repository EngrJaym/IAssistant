import { describe, expect, it } from "vitest";
import { RESUME_MAX_BYTES, validateResumeFile } from "./resumeFile";

describe("validateResumeFile", () => {
  it("accepts pdf and docx", () => {
    expect(validateResumeFile(new File(["x"], "cv.pdf", { type: "application/pdf" }))).toBeNull();
    expect(
      validateResumeFile(
        new File(["x"], "cv.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBeNull();
  });

  it("rejects other extensions", () => {
    expect(validateResumeFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toMatch(/PDF/);
  });

  it("rejects files over 10 MB", () => {
    const big = new File([new Uint8Array(RESUME_MAX_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    expect(validateResumeFile(big)).toMatch(/10 MB/);
  });
});
