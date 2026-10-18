import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnswerPanel,
  Controls,
  Header,
  LiveTranscript,
  LoginPage,
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
  it("keeps sign-in off the coach header", () => {
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
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
  });

  it("shows a theme switch and the logo", () => {
    render(<Header />);
    expect(screen.getByRole("heading", { name: "IAssistant" })).toBeInTheDocument();
    const theme = screen.getByRole("switch", { name: /mode/i });
    const before = theme.getAttribute("aria-checked");
    fireEvent.click(theme);
    expect(theme.getAttribute("aria-checked")).not.toBe(before);
  });
});

describe("LoginPage", () => {
  it("offers Google or email and password, and no sign-up", async () => {
    const onPasswordLogin = vi.fn().mockResolvedValue("Invalid email or password.");
    render(<LoginPage providers={["google"]} onPasswordLogin={onPasswordLogin} />);
    expect(screen.getByRole("link", { name: /continue with google/i })).toHaveAttribute("href", "/api/auth/login/google");
    expect(screen.queryByRole("link", { name: /sign up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "coach@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(onPasswordLogin).toHaveBeenCalledWith("coach@example.com", "secret");
  });

  it("hides Google when OAuth is not configured", () => {
    render(<LoginPage providers={[]} error="Google sign-in is not configured on the server." onPasswordLogin={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /continue with google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
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
