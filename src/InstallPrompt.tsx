import { useCallback, useEffect, useState } from "react";

/** Chromium's deferred install event (not in the standard DOM lib yet). */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "newslang.install-dismissed";

function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac, but is touch-capable.
  return /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
}

/**
 * Offers to install the app.
 *
 * Chromium fires `beforeinstallprompt`, which we defer into a button; iOS has
 * no install event at all, so there we show the Share → "Aggiungi a Home"
 * instructions instead. Dismissal is remembered and already-installed users
 * never see it.
 */
export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Storage unavailable; allow the prompt anyway.
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isIos()) {
      setIosHint(true);
      setVisible(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    setPromptEvent(null);
  }, [promptEvent]);

  if (!visible) return null;

  return (
    <aside className="install-prompt" aria-label="Installa Newslang">
      <div className="install-prompt__text">
        <strong>Installa Newslang</strong>
        <span className="install-prompt__hint">
          {iosHint
            ? "Tocca Condividi e poi “Aggiungi a Home”."
            : "Aggiungila alla schermata Home per leggerla come un'app."}
        </span>
      </div>

      {iosHint ? null : (
        <button type="button" className="button button--primary" onClick={() => void install()}>
          Installa
        </button>
      )}

      <button type="button" className="install-prompt__close" aria-label="Chiudi" onClick={dismiss}>
        ×
      </button>
    </aside>
  );
}
