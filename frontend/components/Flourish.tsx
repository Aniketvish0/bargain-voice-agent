export default function Flourish({ paddingTop }: { paddingTop?: number }) {
  return (
    <div className="wrap">
      <div
        className="flourish"
        style={paddingTop !== undefined ? { paddingTop } : undefined}
      >
        <span className="dot" />
        <svg
          viewBox="0 0 240 60"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="40" y1="46" x2="200" y2="46" />
          <path d="M120 46 C110 46 104 40 104 32 C104 24 110 18 118 18 C126 18 130 24 128 30 C126 36 118 36 116 30" />
          <path d="M116 46 C104 46 92 44 82 38 C74 33 70 27 74 24" />
          <path d="M100 46 C88 46 78 42 70 34" />
          <path d="M120 46 C130 46 136 40 136 32 C136 24 130 18 122 18 C114 18 110 24 112 30 C114 36 122 36 124 30" />
          <path d="M124 46 C136 46 148 44 158 38 C166 33 170 27 166 24" />
          <path d="M140 46 C152 46 162 42 170 34" />
          <circle cx="120" cy="46" r="2.5" fill="currentColor" stroke="none" />
        </svg>
        <span className="dot" />
      </div>
    </div>
  );
}
