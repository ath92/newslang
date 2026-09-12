import { useEffect, useState } from "react";
import type { DailyProgress, NotificationSettingsResponse } from "../shared/contracts";
import { DEFAULT_REMINDER_MINUTES } from "../shared/reminders";

const PRESETS = [5, 10, 15, 20, 30];

interface DailyGoalDialogProps {
  targetMinutes: number;
  today: DailyProgress | null;
  history: DailyProgress[];
  streak: number;
  notifications: NotificationSettingsResponse | null;
  pushSupported: boolean;
  onSave: (minutes: number) => Promise<void> | void;
  onSetNotificationsEnabled: (enabled: boolean, reminderMinutes: number) => Promise<void>;
  onSaveReminderTime: (reminderMinutes: number) => Promise<void>;
  onSendTestNotification: () => Promise<void>;
  onClose: () => void;
}

function toTimeValue(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
}

function fromTimeValue(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return DEFAULT_REMINDER_MINUTES;
  return hours * 60 + minutes;
}

/** Modal for choosing the daily reading target, with the last week's history. */
export function DailyGoalDialog({
  targetMinutes,
  today,
  history,
  streak,
  notifications,
  pushSupported,
  onSave,
  onSetNotificationsEnabled,
  onSaveReminderTime,
  onSendTestNotification,
  onClose,
}: DailyGoalDialogProps) {
  const [value, setValue] = useState(targetMinutes);
  const [custom, setCustom] = useState(targetMinutes > 0 && !PRESETS.includes(targetMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderTime, setReminderTime] = useState(
    notifications?.reminderMinutes ?? DEFAULT_REMINDER_MINUTES,
  );
  const [notificationsOn, setNotificationsOn] = useState(notifications?.enabled ?? false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!notifications) return;
    setReminderTime(notifications.reminderMinutes);
    setNotificationsOn(notifications.enabled);
  }, [notifications]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      await onSaveReminderTime(reminderTime);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifications = async () => {
    const next = !notificationsOn;
    setNotificationsBusy(true);
    setError(null);
    setNotificationStatus(null);
    try {
      await onSetNotificationsEnabled(next, reminderTime);
      setNotificationsOn(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore notifiche");
    } finally {
      setNotificationsBusy(false);
    }
  };

  const sendTest = async () => {
    setNotificationsBusy(true);
    setError(null);
    setNotificationStatus(null);
    try {
      await onSendTestNotification();
      setNotificationStatus("Notifica di prova inviata.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore invio notifica");
    } finally {
      setNotificationsBusy(false);
    }
  };

  return (
    <div className="goal-backdrop" onClick={onClose}>
      <div
        className="goal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Obiettivo giornaliero"
        data-translate-ignore
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Obiettivo giornaliero</h2>
        <p className="goal-dialog__lead">Quanti minuti vuoi leggere ogni giorno?</p>

        <div className="goal-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`toggle${!custom && value === preset ? " toggle--active" : ""}`}
              onClick={() => {
                setCustom(false);
                setValue(preset);
              }}
            >
              {preset} min
            </button>
          ))}
          <button
            type="button"
            className={`toggle${custom ? " toggle--active" : ""}`}
            onClick={() => setCustom(true)}
          >
            Personalizzato
          </button>
        </div>

        {custom ? (
          <label className="goal-dialog__custom">
            Minuti al giorno
            <input
              type="number"
              min={5}
              max={240}
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
            />
          </label>
        ) : null}

        <button
          type="button"
          className={`goal-dialog__off${value === 0 ? " goal-dialog__off--active" : ""}`}
          onClick={() => {
            setCustom(false);
            setValue(0);
          }}
        >
          Nessun obiettivo
        </button>

        {today ? (
          <p className="goal-dialog__today">
            Oggi: {today.minutes} min · {today.articles}{" "}
            {today.articles === 1 ? "articolo" : "articoli"}
          </p>
        ) : null}

        {history.length > 0 ? (
          <div className="goal-history">
            <div className="goal-history__head">
              <span>Ultimi 7 giorni</span>
              {streak > 1 ? <span>🔥 {streak} giorni di fila</span> : null}
            </div>
            <div className="goal-history__bars">
              {history.map((day) => {
                const ratio = value > 0 ? day.minutes / value : 0;
                return (
                  <span
                    key={day.day}
                    className="goal-history__bar"
                    title={`${day.day}: ${day.minutes} min`}
                  >
                    <span
                      className="goal-history__bar-fill"
                      style={{ height: `${Math.min(ratio, 1) * 100}%` }}
                    />
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        <section className="goal-reminder">
          <div className="goal-reminder__head">
            <div>
              <h3>Promemoria</h3>
              <p>Un avviso se a fine giornata non hai ancora letto.</p>
            </div>
            <button
              type="button"
              className={`toggle${notificationsOn ? " toggle--active" : ""}`}
              aria-pressed={notificationsOn}
              onClick={() => void toggleNotifications()}
              disabled={notificationsBusy || !pushSupported}
            >
              {notificationsOn ? "Attivo" : "Disattivo"}
            </button>
          </div>

          {!pushSupported ? (
            <p className="goal-reminder__hint">
              Le notifiche non sono supportate su questo dispositivo.
            </p>
          ) : (
            <label className="goal-reminder__time">
              Ora del promemoria
              <input
                type="time"
                value={toTimeValue(reminderTime)}
                disabled={!notificationsOn || notificationsBusy}
                onChange={(event) => setReminderTime(fromTimeValue(event.target.value))}
              />
            </label>
          )}

          {notificationsOn ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void sendTest()}
              disabled={notificationsBusy}
            >
              Invia una notifica di prova
            </button>
          ) : null}

          {notificationStatus ? (
            <p className="goal-reminder__status">{notificationStatus}</p>
          ) : null}
        </section>

        {error ? <p className="goal-dialog__error">{error}</p> : null}

        <div className="goal-dialog__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Annulla
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={saving}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
