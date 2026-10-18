import { useId } from "react";

/** Headphone lockup. "Assistant" follows the light or dark theme color. */
export function BrandLogo() {
  const grad = `ia-grad-${useId().replace(/:/g, "")}`;
  const fill = `url(#${grad})`;
  return (
    <svg className="brand-logo" viewBox="0 0 340 72" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="10" y1="4" x2="64" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2f6bff" />
          <stop offset="45%" stopColor="#4d6bff" />
          <stop offset="100%" stopColor="#7a45ff" />
        </linearGradient>
      </defs>
      <path
        d="M20 30a18 18 0 0 1 36 0"
        fill="none"
        stroke={fill}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <rect x="12" y="26" width="11" height="15" rx="3.5" fill={fill} />
      <rect x="49" y="26" width="11" height="15" rx="3.5" fill={fill} />
      <circle cx="36" cy="27" r="12" fill={fill} />
      <rect x="14" y="40" width="46" height="22" rx="11" fill={fill} />
      <path d="M20 58l-8 12 16-8z" fill={fill} />
      <g fill="#fff">
        <rect x="24" y="50" width="3.2" height="7" rx="1.6" />
        <rect x="30" y="46.5" width="3.2" height="12" rx="1.6" />
        <rect x="36" y="43" width="3.2" height="18" rx="1.6" />
        <rect x="42" y="46.5" width="3.2" height="12" rx="1.6" />
        <rect x="48" y="50" width="3.2" height="7" rx="1.6" />
      </g>
      <rect x="84" y="20" width="11" height="34" rx="3" fill={fill} />
      <text x="102" y="50" className="brand-mark-rest">Assistant</text>
    </svg>
  );
}
