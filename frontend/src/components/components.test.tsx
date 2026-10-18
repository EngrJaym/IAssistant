import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnswerPanel,
  Controls,
  Header,
  LiveTranscript,
  StatusIndicator,
  TabNav,
  formatTime,
} from "./components";

describe("formatTime", () => {
  it("formats a timestamp", () => {
    const text = formatTime(Date.UTC(2024, 0, 15, 14, 30, 5));
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("StatusIndicator", () => {
  it("shows friendly labels", () => {
    render(<StatusIndicator status="GENERATING" />);
    expect(screen.getByText("Writing")).toBeInTheDocument();
  });
});

describe("TabNav", () => {
  it("calls setTab when a tab is clicked", () => {
    const setTab = vi.fn();
    render(<TabNav tab="session" setTab={setTab} />);
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(setTab).toHaveBeenCalledWith("setup");
  });

  it("does not offer a notes tab", () => {
    render(<TabNav tab="session" setTab={() => {}} />);
    expect(screen.queryByRole("button", { name: "Notes" })).not.toBeInTheDocument();
  });
});

describe("panels", () => {
  it("renders the suggestion without extra notes", () => {
    render(
      <AnswerPanel
        answer="Containers package apps."
        metrics={{ total_ms: 100, detection_ms: 20 }}
        dev
      />,
    );
    expect(screen.getByText(/Containers package/)).toBeInTheDocument();
    expect(screen.queryByText("More")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Question" })).not.toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it("renders transcript empty and partial states", () => {
    const { rerender } = render(<LiveTranscript partial="" finals={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<LiveTranscript partial="listening…" finals={["Hi there"]} />);
    expect(screen.getByText("listening…")).toBeInTheDocument();
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });
});

describe("Header", () => {
  it("shows sign-in when OAuth enabled", () => {
    render(
      <Header
        auth={{
          enabled: true,
          required: true,
          providers: ["google"],
          user: null,
          onLogout: () => {},
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/api/auth/login/google");
  });
});

describe("Controls", () => {
  it("renders start/stop without compact view", () => {
    render(
      <Controls
        running={false}
        muted={false}
        mode="balanced"
        onStart={() => {}}
        onStop={() => {}}
        onMute={() => {}}
        onClear={() => {}}
        setMode={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    expect(screen.queryByText("Compact view")).not.toBeInTheDocument();
  });
});
