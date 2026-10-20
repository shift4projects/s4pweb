/** Drawn play triangle. The "▶" character turns into a blue emoji on iPhones, so we never use it. */
export default function PlayIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden style={{ display: "inline-block", verticalAlign: "-0.05em" }}>
      <path d="M2 1.2v7.6L8.6 5z" fill="currentColor" />
    </svg>
  );
}
