const SOLID_MARK_PIECES = [
  "25.85,24 30.7,15.6 41.32,15.6 41.32,32.4 30.7,32.4",
  "30.7,12.4 26.77,5.6 38.55,12.4",
  "23.08,25.6 27.93,34 22.61,43.2 8.07,34.8 13.38,25.6",
  "30.7,35.6 38.55,35.6 26.77,42.4",
  "23.08,22.4 13.38,22.4 8.07,13.2 22.61,4.8 27.93,14",
  "10.61,24 6.68,30.8 6.68,17.2",
];

export function KumiworkMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
      {SOLID_MARK_PIECES.map((points) => (
        <polygon key={points} points={points} />
      ))}
    </svg>
  );
}
