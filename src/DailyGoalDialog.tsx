import { useEffect, useState } from "react";
import type { DailyProgress } from "../shared/contracts";

const PRESETS = [5, 10, 15, 20, 30];

interface DailyGoalDialogProps {
  targetMinutes: number;
  today: DailyProgress | null;
  history: DailyProgress[];
  streak: number;
  onSave: (minutes: number) => Promise<void> | void;
  onClose: () => void;
}

/** Modal for choosing the daily reading target, with the last week's history. */
export function DailyGoalDialog({
  targetMinutes,
  today,
  history,
  streak,
  onSave,
  onClose,
}: DailyGoalDialogProps) {
  const [value, setValue] = useState(targetMinutes);
  const [custom, setCustom] = useState(targetMinutes > 0 && !PRESETS.includes(targetMinutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore di salvataggio");
    } finally {
      setSaving(false);
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
