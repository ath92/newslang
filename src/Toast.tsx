import { useEffect } from "react";

export interface ToastMessage {
  id: number;
  kind: "info" | "success";
  text: string;
}

/** Transient feedback pinned to the top of the viewport. */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(onDismiss, toast.kind === "success" ? 5000 : 2800);
    return () => window.clearTimeout(timeout);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      className={`toast toast--${toast.kind}`}
      role="status"
      aria-live="polite"
      data-translate-ignore
    >
      <span>{toast.text}</span>
      <button type="button" className="toast__close" aria-label="Chiudi" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
