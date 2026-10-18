import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateProfile, DEFAULT_STYLE, STYLE_PRESETS } from "./components";

describe("CandidateProfile", () => {
  it("selects the plain-language style by default", () => {
    render(
      <CandidateProfile
        profile={{ instructions: STYLE_PRESETS[DEFAULT_STYLE] }}
        setProfile={() => {}}
      />,
    );
    expect(screen.getByLabelText("Style")).toHaveValue("Plain");
    expect(screen.getByPlaceholderText("How to answer (optional)")).toHaveValue(STYLE_PRESETS.Plain);
    expect(STYLE_PRESETS.Plain).toMatch(/analogy/i);
    expect(STYLE_PRESETS.Plain).toMatch(/resume/i);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows validation error for txt upload", async () => {
    const setProfile = vi.fn();
    render(<CandidateProfile profile={{}} setProfile={setProfile} />);
    const input = document.getElementById("resume-file") as HTMLInputElement;
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/PDF/);
    expect(setProfile).not.toHaveBeenCalled();
  });

  it("rejects oversize files before upload", async () => {
    const setProfile = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CandidateProfile profile={{}} setProfile={setProfile} />);
    const input = document.getElementById("resume-file") as HTMLInputElement;
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [big] });
    fireEvent.change(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(/10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
