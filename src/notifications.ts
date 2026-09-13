/**
 * Browser-side Web Push helpers.
 *
 * The service worker is registered production-only (see `src/main.tsx`), so
 * push only works in a built/preview app — `enablePush` fails gracefully when
 * no registration is active.
 */

import type { NotificationSettingsResponse, PushSubscriptionInput } from "../shared/contracts";
import { fetchNotificationSettings, subscribeToPush, unsubscribeFromPush } from "./api";

const DEFAULT_TIMEZONE = "UTC";

/** True when this browser exposes the APIs needed for Web Push. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Whether it is worth offering reminders: push works, the server has a VAPID
 * key, and the reader has not already blocked notifications (a denied
 * permission can't be re-prompted, so the offer would be a dead end).
 */
export function canOfferReminders(
  settings: NotificationSettingsResponse | null,
  supported: boolean,
): boolean {
  if (!supported || !settings || !settings.vapidPublicKey) return false;
  try {
    return Notification.permission !== "denied";
  } catch {
    return false;
  }
}

/** The reader's IANA timezone, used to schedule the reminder at their local time. */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    if (!(await navigator.serviceWorker.getRegistration())) return null;
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function toPayload(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Ask for permission, subscribe, and register the subscription with the Worker. */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error("Notifiche non supportate su questo dispositivo");

  // Ask while still inside the click's user-gesture context (Safari requires it).
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permesso notifiche negato");

  const registration = await activeRegistration();
  if (!registration) throw new Error("Service worker non disponibile");

  const { vapidPublicKey } = await fetchNotificationSettings();
  if (!vapidPublicKey) throw new Error("Notifiche non configurate sul server");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const payload = toPayload(subscription);
  if (!payload) throw new Error("Iscrizione push non valida");
  await subscribeToPush(payload);
}

/** Unsubscribe in the browser and remove the subscription from the Worker. */
export async function disablePush(): Promise<void> {
  const registration = await activeRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const { endpoint } = subscription;
  try {
    await subscription.unsubscribe();
  } finally {
    // The server record is what actually stops the pushes, so prune it even if
    // the browser-side unsubscribe failed.
    await unsubscribeFromPush(endpoint).catch(() => undefined);
  }
}

/**
 * Re-upload an existing subscription on every app load. This recovers from a
 * first upload that failed and keeps the server's copy current after a VAPID
 * key rotation.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  const registration = await activeRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const payload = toPayload(subscription);
  if (!payload) return;
  await subscribeToPush(payload).catch(() => undefined);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
