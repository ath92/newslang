import { progressRatio } from "../shared/progress";
import { canOfferReminders } from "./notifications";
import { useReadingProgress } from "./reading-progress";
import { Link } from "./router";

/** Compact today's-progress chip; tapping it opens the settings page. */
export function ReadingProgressBar({ className = "" }: { className?: string }) {
  const { targetMinutes, today, streak, notifications, pushSupported } = useReadingProgress();
  const extra = className ? ` ${className}` : "";

  if (!today) return null;

  if (targetMinutes <= 0) {
    return (
      <Link
        to="/settings"
        className={`reading-progress reading-progress--unset${extra}`}
        aria-label="Imposta un obiettivo di lettura"
      >
        Imposta un obiettivo di lettura
      </Link>
    );
  }

  const met = today.minutes >= targetMinutes;
  const ratio = progressRatio(today.minutes, targetMinutes);
  const remindersOff = canOfferReminders(notifications, pushSupported) && !notifications?.enabled;

  return (
    <Link
      to="/settings"
      className={`reading-progress${met ? " reading-progress--met" : ""}${extra}`}
      aria-label={`Obiettivo giornaliero: ${today.minutes} di ${targetMinutes} minuti${
        remindersOff ? ". Promemoria disattivati" : ""
      }`}
    >
      <span className="reading-progress__label">
        <span>
          Oggi {today.minutes} / {targetMinutes} min
        </span>
        <span className="reading-progress__meta">
          {streak > 1 ? <span className="reading-progress__streak">🔥 {streak} giorni</span> : null}
          {remindersOff ? (
            <span
              className="reading-progress__bell"
              title="Promemoria disattivati"
              aria-hidden="true"
            >
              🔔
            </span>
          ) : null}
        </span>
      </span>
      <span className="reading-progress__track" aria-hidden="true">
        <span className="reading-progress__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </Link>
  );
}
