/** Inline 1.6px stroke icons — no icon dependency, matches the landing weight. */
const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Search = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const Panel = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9 4v16" />
  </svg>
);

export const Insights = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M15 4v16" />
  </svg>
);

export const Moon = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
  </svg>
);

export const Sun = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const Phone = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z" />
  </svg>
);

export const Mic = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const Text = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const Shield = () => (
  <svg viewBox="0 0 24 24" {...s}>
    <path d="M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
