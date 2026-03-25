import { useEffect, useState } from "react";

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function WorkingIndicator({ active, startTimestamp }: { active: boolean; startTimestamp?: number }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    // Sync immediately on mount so we don't show 0s for a full second
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) {
    return null;
  }

  const elapsed = startTimestamp && startTimestamp > 0
    ? Math.max(0, Math.floor((now - startTimestamp) / 1000))
    : 0;

  return (
    <div className="working-indicator" role="status" aria-label={`Working for ${formatElapsed(elapsed)}`}>
      <span className="working-dots" aria-hidden="true">
        <span className="working-dot" />
        <span className="working-dot" />
        <span className="working-dot" />
      </span>
      <span className="working-timer">Working for {formatElapsed(elapsed)}</span>
    </div>
  );
}
