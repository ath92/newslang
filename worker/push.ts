/**
 * Web Push delivery.
 *
 * `@mmmike/web-push` implements RFC 8291 (`aes128gcm`) and RFC 8292 (VAPID) on
 * the Web Crypto API, so it runs natively in Workers — no `nodejs_compat`.
 * This module is the single seam between our Durable Object and the push
 * services, and it is where the VAPID configuration is read from the Worker
 * environment.
 */

import {
  sendPushNotification,
  WebPushError,
  type PushPayload,
  type VapidConfig,
} from "@mmmike/web-push/send";

export type { PushPayload };

/** A push subscription as stored per user (one row per endpoint). */
export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = "delivered" | "gone" | "failed";

/** Fallback contact when `VAPID_SUBJECT` is unset. */
const DEFAULT_VAPID_SUBJECT = "mailto:hello@newslang.app";

/**
 * Read the VAPID configuration from the Worker environment. Returns null when
 * no key pair is configured, which disables delivery instead of failing.
 */
export function vapidFromEnv(env: Env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT,
  };
}

/**
 * Send one notification and classify the result: `gone` means the push service
 * reported the subscription dead (404/410) and the caller should prune it.
 */
export async function sendPush(
  subscription: StoredPushSubscription,
  payload: PushPayload,
  vapid: VapidConfig,
): Promise<PushOutcome> {
  try {
    const delivered = await sendPushNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      vapid,
      // A reminder is only useful today; a short TTL avoids a stale nudge.
      { ttl: 6 * 60 * 60, urgency: "normal" },
    );
    return delivered ? "delivered" : "gone";
  } catch (error) {
    if (error instanceof WebPushError) {
      // Never log the endpoint: it is a bearer capability URL.
      console.warn("Push rejected", {
        statusCode: error.statusCode,
        retryAfterMs: error.retryAfterMs,
      });
    } else {
      console.warn("Push failed", error);
    }
    return "failed";
  }
}
