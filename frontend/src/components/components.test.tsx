import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnswerPanel,
  Controls,
  Header,
  LiveTranscript,
  MeetingNotes,
  QuestionPanel,
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
});

describe("panels", () => {
  it("renders question and answer content", () => {
    render(
      <>
        <QuestionPanel question="" possible="Maybe a question?" />
        <QuestionPanel question="Why Docker?" possible="" />
        <AnswerPanel
          answer="Containers package apps."
          points={["Portable"]}
          followUp="Any limits?"
          metrics={{ total_ms: 100, detection_ms: 20 }}
          dev
        />
      </>,
    );
    expect(screen.getByText("Why Docker?")).toBeInTheDocument();
    expect(screen.getByText(/Containers package/)).toBeInTheDocument();
    expect(screen.getByText("Portable")).toBeInTheDocument();
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

describe("MeetingNotes", () => {
  it("filters live notes and clears", () => {
    const onClear = vi.fn();
    render(
      <MeetingNotes
        entries={[
          { id: "1", ts: 1_700_000_000_000, speaker: "Interviewer", text: "Tell me about Docker" },
          { id: "2", ts: 1_700_000_000_100, speaker: "You", text: "I use Kubernetes" },
        ]}
        savedMeetings={[]}
        dbEnabled={false}
        view="live"
        setView={() => {}}
        selectedMeetingId={null}
        onSelectMeeting={() => {}}
        onRefreshSaved={() => {}}
        onExportDocx={() => {}}
        onClear={onClear}
        onExport={() => {}}
        onDeleteSaved={() => {}}
        currentMeetingId={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "docker" } });
    expect(screen.getByText("Tell me about Docker")).toBeInTheDocument();
    expect(screen.queryByText("I use Kubernetes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
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
