import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DailyProgress,
  NotificationSettingsResponse,
  ProgressResponse,
  RecordReadingResponse,
} from "../shared/contracts";
import { DEFAULT_DAILY_TARGET_MINUTES, HISTORY_DAYS, localDayKey } from "../shared/progress";
import {
  fetchNotificationSettings,
  fetchProgress,
  recordReading,
  sendTestNotification as sendTestPush,
  setDailyTarget,
  updateNotificationSettings,
} from "./api";
import {
  currentTimeZone,
  disablePush,
  enablePush,
  isPushSupported,
  syncPushSubscription,
} from "./notifications";
import { Toast, type ToastMessage } from "./Toast";

interface RecordArticleInput {
  url: string;
  title?: string;
  minutes: number;
}

interface ReadingProgressContextValue {
  targetMinutes: number;
  today: DailyProgress | null;
  history: DailyProgress[];
  streak: number;
  /** Credit an article's estimated time to today's goal (once per day). */
  recordArticle: (input: RecordArticleInput) => Promise<void>;
  /** Change the daily target; `0` turns the goal off. */
  setTarget: (minutes: number) => Promise<void>;
  /** This device's push/reminder settings (null until loaded). */
  notifications: NotificationSettingsResponse | null;
  /** True when this browser can receive Web Push. */
  pushSupported: boolean;
  /** Turn the daily reminder on/off (permission + subscription happen here). */
  setNotificationsEnabled: (enabled: boolean, reminderMinutes: number) => Promise<void>;
  /** Persist a new reminder time. */
  saveReminderTime: (reminderMinutes: number) => Promise<void>;
  /** Send a one-off test notification. */
  sendTestNotification: () => Promise<void>;
}

const ReadingProgressContext = createContext<ReadingProgressContextValue | null>(null);

export function useReadingProgress(): ReadingProgressContextValue {
  const value = useContext(ReadingProgressContext);
  if (!value) throw new Error("useReadingProgress must be used within ReadingProgressProvider");
  return value;
}

function currentTzOffset(): number {
  return new Date().getTimezoneOffset();
}

/** Fold a record response into the cached progress (history excludes today's new row). */
function withRecordedDay(
  previous: ProgressResponse | null,
  result: RecordReadingResponse,
): ProgressResponse {
  const history = previous?.history ?? [];
  const last = history[history.length - 1];
  const nextHistory =
    last && last.day === result.today.day
      ? [...history.slice(0, -1), result.today]
      : [...history, result.today].slice(-HISTORY_DAYS);
  return {
    targetMinutes: result.targetMinutes,
    today: result.today,
    history: nextHistory,
    streak: result.streak,
  };
}

/**
 * Tracks the reader's daily target and today's credited minutes, and owns the
 * goal dialog and completion/subtle toasts.
 */
export function ReadingProgressProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettingsResponse | null>(null);
  const [pushSupported] = useState(() => isPushSupported());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const recorded = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    fetchProgress(currentTzOffset())
      .then((progress) => {
        if (!cancelled) setData(progress);
      })
      .catch(() => {
        // Progress is non-critical; the app works without it.
      });
    fetchNotificationSettings()
      .then((settings) => {
        if (!cancelled) setNotifications(settings);
      })
      .catch(() => {
        // Notifications are optional; the app works without them.
      });
    // Keep the server's subscription copy in sync after a VAPID key rotation.
    void syncPushSubscription();
    return () => {
      cancelled = true;
    };
  }, []);

  const recordArticle = useCallback(async ({ url, title, minutes }: RecordArticleInput) => {
    const tzOffsetMinutes = currentTzOffset();
    const key = `${localDayKey(Date.now(), tzOffsetMinutes)}:${url}`;
    if (recorded.current.has(key)) return;
    recorded.current.add(key);

    try {
      const result = await recordReading({
        articleUrl: url,
        articleTitle: title,
        minutes,
        tzOffsetMinutes,
      });
      setData((previous) => withRecordedDay(previous, result));

      if (result.justMetTarget) {
        setToast({
          id: Date.now(),
          kind: "success",
          text: `🎉 Obiettivo di oggi raggiunto! ${result.today.minutes}/${result.targetMinutes} min`,
        });
      } else if (result.counted) {
        const progress =
          result.targetMinutes > 0
            ? `${result.today.minutes}/${result.targetMinutes} min oggi`
            : `${result.today.minutes} min oggi`;
        setToast({ id: Date.now(), kind: "info", text: `+${minutes} min · ${progress}` });
      }
    } catch {
      // Let a later visit retry the credit.
      recorded.current.delete(key);
    }
  }, []);

  const setTarget = useCallback(async (minutes: number) => {
    const result = await setDailyTarget({
      targetMinutes: minutes,
      tzOffsetMinutes: currentTzOffset(),
    });
    setData((previous) =>
      previous
        ? { ...previous, targetMinutes: result.targetMinutes, streak: result.streak }
        : previous,
    );
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const setNotificationsEnabled = useCallback(async (enabled: boolean, reminderMinutes: number) => {
    if (enabled) await enablePush();
    else await disablePush();
    const result = await updateNotificationSettings({
      enabled,
      reminderMinutes,
      timezone: currentTimeZone(),
    });
    setNotifications(result);
  }, []);

  const saveReminderTime = useCallback(
    async (reminderMinutes: number) => {
      const result = await updateNotificationSettings({
        enabled: notifications?.enabled ?? false,
        reminderMinutes,
        timezone: currentTimeZone(),
      });
      setNotifications(result);
    },
    [notifications],
  );

  const sendTestNotification = useCallback(async () => {
    await sendTestPush();
  }, []);

  const value = useMemo<ReadingProgressContextValue>(
    () => ({
      targetMinutes: data?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES,
      today: data?.today ?? null,
      history: data?.history ?? [],
      streak: data?.streak ?? 0,
      recordArticle,
      setTarget,
      notifications,
      pushSupported,
      setNotificationsEnabled,
      saveReminderTime,
      sendTestNotification,
    }),
    [
      data,
      notifications,
      pushSupported,
      recordArticle,
      setTarget,
      setNotificationsEnabled,
      saveReminderTime,
      sendTestNotification,
    ],
  );

  return (
    <ReadingProgressContext.Provider value={value}>
      {children}
      <Toast toast={toast} onDismiss={dismissToast} />
    </ReadingProgressContext.Provider>
  );
}
