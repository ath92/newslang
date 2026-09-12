import { progressRatio } from "../shared/progress";
import { useReadingProgress } from "./reading-progress";

/** Compact today's-progress chip; tapping it opens the goal dialog. */
export function ReadingProgressBar({ className = "" }: { className?: string }) {
  const { targetMinutes, today, streak, openGoalDialog } = useReadingProgress();
  const extra = className ? ` ${className}` : "";

  if (!today) return null;

  if (targetMinutes <= 0) {
    return (
      <button
        type="button"
        className={`reading-progress reading-progress--unset${extra}`}
        onClick={openGoalDialog}
      >
        Imposta un obiettivo di lettura
      </button>
    );
  }

  const met = today.minutes >= targetMinutes;
  const ratio = progressRatio(today.minutes, targetMinutes);

  return (
    <button
      type="button"
      className={`reading-progress${met ? " reading-progress--met" : ""}${extra}`}
      onClick={openGoalDialog}
      aria-label={`Obiettivo giornaliero: ${today.minutes} di ${targetMinutes} minuti`}
    >
      <span className="reading-progress__label">
        <span>
          Oggi {today.minutes} / {targetMinutes} min
        </span>
        {streak > 1 ? <span className="reading-progress__streak">🔥 {streak} giorni</span> : null}
      </span>
      <span className="reading-progress__track" aria-hidden="true">
        <span className="reading-progress__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </button>
  );
}
