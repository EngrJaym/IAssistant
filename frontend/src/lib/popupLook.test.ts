import { describe, expect, it } from "vitest";
import { popupLookVars } from "./popupLook";

describe("popup look", () => {
  it("uses fixed safe defaults for the meeting window", () => {
    const vars = popupLookVars();
    expect(vars["--popup-pad"]).toBe("16px");
    expect(vars["--popup-size"]).toBe("17px");
    expect(vars["--popup-align"]).toBe("left");
    expect(vars["--popup-font"]).toMatch(/Segoe UI/);
    expect(vars["--popup-leading"]).toBe("1.5");
    expect(vars).not.toHaveProperty("--popup-opacity");
  });
});
