import { useEffect, useState } from "react";
import type { QuizMode } from "../../shared/contracts";
import { DEFAULT_REMINDER_MINUTES } from "../../shared/reminders";
import { Link } from "../router";
import { useReadingProgress } from "../reading-progress";
import { useSettings } from "../settings";

const GOAL_PRESETS = [5, 10, 15, 20, 30];
const QUIZ_COUNT_MIN = 3;
const QUIZ_COUNT_MAX = 10;

const QUIZ_MODES: Array<{ id: QuizMode; label: string; hint: string }> = [
  { id: "open", label: "Risposta aperta", hint: "Scrivi la risposta con parole tue" },
  { id: "multiple_choice", label: "Scelta multipla", hint: "Scegli tra tre opzioni" },
  { id: "mixed", label: "Mista", hint: "Un po' aperte, un po' a scelta multipla" },
];

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

/** Dedicated settings page: reading goal, reminders and quiz preferences. */
export function Settings() {
  const {
    targetMinutes,
    today,
    history,
    streak,
    setTarget,
    notifications,
    pushSupported,
    setNotificationsEnabled,
    saveReminderTime,
    sendTestNotification,
  } = useReadingProgress();
  const { quiz, setQuiz } = useSettings();

  const [custom, setCustom] = useState(targetMinutes > 0 && !GOAL_PRESETS.includes(targetMinutes));
  const [customValue, setCustomValue] = useState(targetMinutes);
  const [reminderTime, setReminderTime] = useState(
    notifications?.reminderMinutes ?? DEFAULT_REMINDER_MINUTES,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!notifications) return;
    setReminderTime(notifications.reminderMinutes);
  }, [notifications]);

  const changeTarget = async (minutes: number) => {
    setError(null);
    try {
      await setTarget(minutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di salvataggio");
    }
  };

  const toggleNotifications = async () => {
    const next = !(notifications?.enabled ?? false);
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await setNotificationsEnabled(next, reminderTime);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore notifiche");
    } finally {
      setBusy(false);
    }
  };

  const changeReminderTime = async (value: string) => {
    const minutes = fromTimeValue(value);
    setReminderTime(minutes);
    setError(null);
    setBusy(true);
    try {
      await saveReminderTime(minutes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore salvataggio ora");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await sendTestNotification();
      setStatus("Notifica di prova inviata.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore invio notifica");
    } finally {
      setBusy(false);
    }
  };

  const notificationsOn = notifications?.enabled ?? false;

  return (
    <main className="settings">
      <nav className="article__nav">
        <Link to="/" className="back-link">
          ← Tutte le notizie
        </Link>
        <Link to="/review" className="nav-link">
          Ripasso
        </Link>
      </nav>

      <header className="settings__header">
        <h1>Impostazioni</h1>
        <p>Personalizza la lettura, i promemoria e i quiz.</p>
      </header>

      <section className="settings-card" aria-labelledby="settings-reading">
        <div className="settings-card__head">
          <div>
            <h2 id="settings-reading">Lettura</h2>
            <p>Quanti minuti vuoi leggere ogni giorno?</p>
          </div>
          {streak > 1 ? <span className="settings-card__badge">🔥 {streak} giorni</span> : null}
        </div>

        <div className="goal-presets">
          {GOAL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`toggle${!custom && targetMinutes === preset ? " toggle--active" : ""}`}
              onClick={() => {
                setCustom(false);
                void changeTarget(preset);
              }}
            >
              {preset} min
            </button>
          ))}
          <button
            type="button"
            className={`toggle${custom ? " toggle--active" : ""}`}
            onClick={() => {
              setCustomValue(targetMinutes);
              setCustom(true);
            }}
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
              value={customValue}
              onChange={(event) => setCustomValue(Number(event.target.value))}
              onBlur={() => void changeTarget(customValue)}
            />
          </label>
        ) : null}

        <button
          type="button"
          className={`goal-dialog__off${targetMinutes === 0 ? " goal-dialog__off--active" : ""}`}
          onClick={() => {
            setCustom(false);
            void changeTarget(0);
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
            </div>
            <div className="goal-history__bars">
              {history.map((day) => {
                const ratio = targetMinutes > 0 ? day.minutes / targetMinutes : 0;
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
      </section>

      <section className="settings-card" aria-labelledby="settings-reminders">
        <div className="settings-card__head">
          <div>
            <h2 id="settings-reminders">Promemoria</h2>
            <p>Un avviso se a fine giornata non hai ancora letto.</p>
          </div>
          <button
            type="button"
            className={`toggle${notificationsOn ? " toggle--active" : ""}`}
            aria-pressed={notificationsOn}
            onClick={() => void toggleNotifications()}
            disabled={busy || !pushSupported}
          >
            {notificationsOn ? "Attivo" : "Disattivo"}
          </button>
        </div>

        {!pushSupported ? (
          <p className="settings-card__hint">
            Le notifiche non sono supportate su questo dispositivo.
          </p>
        ) : (
          <label className="goal-reminder__time">
            Ora del promemoria
            <input
              type="time"
              value={toTimeValue(reminderTime)}
              disabled={!notificationsOn || busy}
              onChange={(event) => void changeReminderTime(event.target.value)}
            />
          </label>
        )}

        {notificationsOn ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void sendTest()}
            disabled={busy}
          >
            Invia una notifica di prova
          </button>
        ) : null}
      </section>

      <section className="settings-card" aria-labelledby="settings-quiz">
        <div className="settings-card__head">
          <div>
            <h2 id="settings-quiz">Quiz</h2>
            <p>Come vuoi metterti alla prova sugli articoli.</p>
          </div>
        </div>

        <div className="settings-quiz__modes" role="radiogroup" aria-label="Tipo di domande">
          {QUIZ_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={quiz.mode === item.id}
              className={`settings-quiz__mode${quiz.mode === item.id ? " settings-quiz__mode--active" : ""}`}
              onClick={() => setQuiz({ mode: item.id })}
            >
              <span className="settings-quiz__mode-label">{item.label}</span>
              <span className="settings-quiz__mode-hint">{item.hint}</span>
            </button>
          ))}
        </div>

        <label className="settings-quiz__count">
          <span>
            Numero di domande: <strong>{quiz.questionCount}</strong>
          </span>
          <input
            type="range"
            min={QUIZ_COUNT_MIN}
            max={QUIZ_COUNT_MAX}
            step={1}
            value={quiz.questionCount}
            onChange={(event) => setQuiz({ questionCount: Number(event.target.value) })}
          />
        </label>
      </section>

      {status ? <p className="settings__status">{status}</p> : null}
      {error ? <p className="settings__error">{error}</p> : null}
    </main>
  );
}
