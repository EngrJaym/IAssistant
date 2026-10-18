import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateProfile } from "./components";

describe("CandidateProfile", () => {
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

  it("applies answer style preset", () => {
    const setProfile = vi.fn();
    render(<CandidateProfile profile={{}} setProfile={setProfile} />);
    fireEvent.change(screen.getByDisplayValue("Preset…"), { target: { value: "Concise" } });
    expect(setProfile).toHaveBeenCalled();
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
