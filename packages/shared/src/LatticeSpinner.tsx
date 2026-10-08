const JOINT_PATHS = [
  "M29.77,14 L24,24 M29.77,14 L25.4,6.4 M29.77,14 L39.6,14",
  "M29.77,34 L24,24 M29.77,34 L39.6,34 M29.77,34 L25.4,41.6",
  "M12.45,24 L24,24 M12.45,24 L8.1,31.6 M12.45,24 L8.1,16.4",
];

const SPINNER_CSS = `
.kw-lattice-spinner { display: inline-flex; }
@media (prefers-reduced-motion: no-preference) {
  .kw-lattice-frame {
    stroke-dasharray: 120;
    animation: kwLatticeFrame 1.05s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
  }
  .kw-lattice-joints {
    stroke-dasharray: 40;
    animation: kwLatticeJoints 1.05s cubic-bezier(0.2, 0.8, 0.2, 1) infinite backwards;
  }
  .kw-lattice-joints-1 { animation-delay: 0.18s; }
  .kw-lattice-joints-2 { animation-delay: 0.3s; }
  .kw-lattice-joints-3 { animation-delay: 0.42s; }
  .kw-lattice-center {
    animation: kwLatticeCenter 1.05s cubic-bezier(0.2, 0.8, 0.2, 1) 0.42s infinite backwards;
  }
}
@keyframes kwLatticeFrame {
  0% { stroke-dashoffset: 120; }
  55%, 100% { stroke-dashoffset: 0; }
}
@keyframes kwLatticeJoints {
  0% { stroke-dashoffset: 40; opacity: 1; }
  45%, 88% { stroke-dashoffset: 0; opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes kwLatticeCenter {
  0%, 25% { opacity: 0; }
  45%, 88% { opacity: 1; }
  100% { opacity: 0; }
}
`;

export function LatticeSpinner({ size = 24, label = "Loading" }: { size?: number; label?: string }) {
  return (
    <span role="status" aria-label={label} className="kw-lattice-spinner">
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <polygon
          className="kw-lattice-frame"
          points="32.66,9 41.32,14 41.32,34 24,44 6.68,34 6.68,14 24,4"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinejoin="miter"
        />
        {JOINT_PATHS.map((d, index) => (
          <path
            key={d}
            className={`kw-lattice-joints kw-lattice-joints-${index + 1}`}
            d={d}
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
        <circle className="kw-lattice-center" cx={24} cy={24} r={3.6} fill="var(--color-accent-300)" />
      </svg>
      <style>{SPINNER_CSS}</style>
    </span>
  );
}
