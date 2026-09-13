import { useState } from "react";
import { canOfferReminders } from "./notifications";
import { useReadingProgress } from "./reading-progress";

/** How long "Non ora" hides the prompt before it may ask again. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "newslang.reminder-prompt-snoozed-until";
const DISMISS_KEY = "newslang.reminder-prompt-dismissed";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private browsing, etc.).
  }
}

function formatTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

/**
 * One-time banner offering the daily reminder. Two feedback paths are
 * remembered independently: "Non ora" snoozes it for a few days, while
 * "Non chiedermelo più" opts out for good.
 */
export function NotificationPrompt() {
  const { notifications, pushSupported, setNotificationsEnabled } = useReadingProgress();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState(() => {
    const until = Number(readStorage(SNOOZE_KEY));
    return Number.isFinite(until) && until > Date.now();
  });
  const [dismissed, setDismissed] = useState(() => readStorage(DISMISS_KEY) === "1");

  const offer = canOfferReminders(notifications, pushSupported);
  if (!offer || !notifications || notifications.enabled || snoozed || dismissed) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await setNotificationsEnabled(true, notifications.reminderMinutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore notifiche");
    } finally {
      setBusy(false);
    }
  };

  const snooze = () => {
    writeStorage(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setSnoozed(true);
  };

  const dismiss = () => {
    writeStorage(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <aside className="notify-prompt" aria-label="Promemoria di lettura" data-translate-ignore>
      <div className="notify-prompt__body">
        <strong className="notify-prompt__title">🔔 Attiva un promemoria</strong>
        <span className="notify-prompt__text">
          Ti avvisiamo alle {formatTime(notifications.reminderMinutes)} se non hai ancora letto.
        </span>
        {error ? <span className="notify-prompt__error">{error}</span> : null}
        <div className="notify-prompt__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void enable()}
            disabled={busy}
          >
            Attiva
          </button>
          <button type="button" className="button button--ghost" onClick={snooze} disabled={busy}>
            Non ora
          </button>
          <button
            type="button"
            className="notify-prompt__dismiss"
            onClick={dismiss}
            disabled={busy}
          >
            Non chiedermelo più
          </button>
        </div>
      </div>
    </aside>
  );
}
