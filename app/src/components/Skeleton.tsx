/** Placeholder block shown while chain data loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl border border-line bg-panel ${className}`} />;
}
