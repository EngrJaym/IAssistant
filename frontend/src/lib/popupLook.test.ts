import { describe, expect, it } from "vitest";
import { normalizePopupLook, popupLookVars, readPopupLook } from "./popupLook";

describe("popup look", () => {
  it("clamps appearance values and falls back when the saved value is unusable", () => {
    expect(normalizePopupLook({ layout: "roomy", align: "center", font: "mono", opacity: 2, fontSize: 4 })).toEqual({
      layout: "roomy",
      align: "center",
      font: "mono",
      opacity: 0.92,
      fontSize: 14,
    });
    expect(readPopupLook("not-json").layout).toBe("comfortable");
  });

  it("maps layout choices onto the window styles", () => {
    const vars = popupLookVars(normalizePopupLook({ layout: "compact", fontSize: 20, opacity: 0.4, font: "serif" }));
    expect(vars["--popup-pad"]).toBe("10px");
    expect(vars["--popup-size"]).toBe("20px");
    expect(vars["--popup-font"]).toMatch(/Georgia/);
    expect(vars["--popup-opacity"]).toBe("0.4");
  });
});
