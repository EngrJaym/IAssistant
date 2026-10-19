export type PopupLayout = "compact" | "comfortable" | "roomy";
export type PopupAlign = "left" | "center";
export type PopupFont = "system" | "serif" | "mono";

export type PopupLook = {
  layout: PopupLayout;
  align: PopupAlign;
  opacity: number;
  fontSize: number;
  font: PopupFont;
};

export const POPUP_LOOK_KEY = "coach.popup.look";

export const DEFAULT_POPUP_LOOK: PopupLook = {
  layout: "comfortable",
  align: "left",
  opacity: 0.42,
  fontSize: 17,
  font: "system",
};

const FONTS: Record<PopupFont, string> = {
  system: '"Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Mono", ui-monospace, monospace',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePopupLook(value: Partial<PopupLook> | null | undefined): PopupLook {
  const layout = value?.layout === "compact" || value?.layout === "roomy" ? value.layout : "comfortable";
  const align = value?.align === "center" ? "center" : "left";
  const font = value?.font === "serif" || value?.font === "mono" ? value.font : "system";
  return {
    layout,
    align,
    font,
    opacity: clamp(Number(value?.opacity) || DEFAULT_POPUP_LOOK.opacity, 0.08, 0.92),
    fontSize: clamp(Math.round(Number(value?.fontSize) || DEFAULT_POPUP_LOOK.fontSize), 14, 24),
  };
}

export function readPopupLook(raw: string | null): PopupLook {
  if (!raw) return DEFAULT_POPUP_LOOK;
  try {
    return normalizePopupLook(JSON.parse(raw));
  } catch {
    return DEFAULT_POPUP_LOOK;
  }
}

export function popupLookVars(look: PopupLook): Record<string, string> {
  const padding = look.layout === "compact" ? "10px" : look.layout === "roomy" ? "22px" : "16px";
  const leading = look.layout === "compact" ? "1.35" : look.layout === "roomy" ? "1.7" : "1.5";
  return {
    "--popup-opacity": String(look.opacity),
    "--popup-font": FONTS[look.font],
    "--popup-size": `${look.fontSize}px`,
    "--popup-pad": padding,
    "--popup-align": look.align,
    "--popup-leading": leading,
  };
}
