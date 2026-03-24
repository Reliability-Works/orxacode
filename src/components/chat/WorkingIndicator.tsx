import { useEffect, useRef, useState } from "react";

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function WorkingIndicator({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      setElapsed(0);
    }
    prevActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) {
    return null;
  }

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
