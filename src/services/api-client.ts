import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

import { env } from "../config/env";

// Primary (Railway) / Backup (Render) — same comp-bar-server codebase
// deployed twice against the same MongoDB Atlas cluster. On a 502/503/504 or
// a connection-level failure, the failing request is retried once against
// the other one; every later request goes straight there until Railway's own
// /api/health answers again. This assumes both backends really do read the
// same database — if they don't, failing over serves a different dataset
// instead of an outage, which would be worse than not failing over at all.
const PRIMARY_BASE = env.BACKEND_URL.replace(/\/$/, "");
const BACKUP_BASE = env.BACKEND_BACKUP_URL.replace(/\/$/, "");
const HEALTH_RECHECK_INTERVAL_MS = 3 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const HEAVY_TIMEOUT_MS = 60_000;

let isPrimaryDown = false;
let healthRecheckTimer: NodeJS.Timeout | null = null;

function activeBase(): string {
  return isPrimaryDown ? BACKUP_BASE : PRIMARY_BASE;
}

function markPrimaryDown() {
  if (isPrimaryDown) return;
  isPrimaryDown = true;
  scheduleHealthRecheck();
  console.warn("[api-client] Primary (Railway) unreachable — failing over to Render for this and subsequent requests.");
}

// The bot is a long-running Node process (unlike a serverless client), so a
// module-level interval is safe for its whole lifetime. Stops itself once
// primary answers again; a later failure restarts it.
function scheduleHealthRecheck() {
  if (healthRecheckTimer) return;
  healthRecheckTimer = setInterval(async () => {
    if (!isPrimaryDown) return;
    try {
      const res = await axios.get(`${PRIMARY_BASE}/api/health`, { timeout: 5000 });
      if (res.status === 200) {
        isPrimaryDown = false;
        if (healthRecheckTimer) {
          clearInterval(healthRecheckTimer);
          healthRecheckTimer = null;
        }
        console.log("[api-client] Primary (Railway) is back — switching off Render.");
      }
    } catch {
      // Still down — leave isPrimaryDown as-is, try again next tick.
    }
  }, HEALTH_RECHECK_INTERVAL_MS);
}

// Only a server that's actually unreachable/down should fail over — a 4xx is
// this bot's own fault (bad input, payment already reviewed) and would fail
// identically on either backend.
function isFailoverTriggering(error: AxiosError): boolean {
  const status = error.response?.status;
  if (status === 404 && isRailwayPlatformNotFound(error.response?.headers, error.response?.data)) return true;
  if (status === 502 || status === 503 || status === 504) return true;
  // No response reached us at all — a genuine connection failure, not this
  // client's own request timeout (ECONNABORTED is a slow-but-maybe-alive
  // server, deliberately excluded: that's not the same as a dead one).
  if (!error.response && error.code && error.code !== "ECONNABORTED") return true;
  return false;
}

function isRailwayPlatformNotFound(headers: any, body: unknown): boolean {
  let appBody = body;
  if (typeof appBody === 'string') { try { appBody = JSON.parse(appBody); } catch {} }
  if (appBody && typeof appBody === 'object' && typeof (appBody as {success?:unknown}).success === 'boolean') return false;
  if (headers?.['x-railway-router']) return true;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return text.length <= 16_384 && text.includes('Application not found');
}

const http = axios.create({
  headers: { "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Set per-request, not baked into the instance at creation, so a failover
  // that happens mid-run applies to the very next call immediately.
  config.baseURL = `${activeBase()}/api/bot`;
  if (!config.timeout) config.timeout = DEFAULT_TIMEOUT_MS;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _failoverRetried?: boolean }) | undefined;
    if (originalRequest && !isPrimaryDown && ["get","head","options"].includes((originalRequest.method??"get").toLowerCase()) && !originalRequest._failoverRetried && isFailoverTriggering(error)) {
      originalRequest._failoverRetried = true;
      markPrimaryDown();
      originalRequest.baseURL = `${BACKUP_BASE}/api/bot`;
      return http(originalRequest);
    }
    if (originalRequest?.baseURL === `${PRIMARY_BASE}/api/bot` && isFailoverTriggering(error)) markPrimaryDown();
    return Promise.reject(error);
  },
);

export class ApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "ApiError";
  }
}

function unwrap<T>(promise: Promise<{ data: { success: boolean; data: T } }>): Promise<T> {
  return promise
    .then((res) => res.data.data)
    .catch((err: AxiosError<{ error?: { message?: string } }>) => {
      const message = err.response?.data?.error?.message ?? err.message ?? "Backend error";
      throw new ApiError(message, err.response?.status);
    });
}

// Aborts a fetch that's taking longer than `timeoutMs` — Node's fetch has no
// built-in timeout option, only the AbortController escape hatch.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Same failover shape as the `http` axios interceptor above, hand-rolled for
// fetch: try the currently-active backend, and on a 502/503/504 or a genuine
// connection failure (not our own AbortController timeout — that's "slow",
// not "down"), retry once against whichever backend wasn't just tried. If
// that one was already the backup (isPrimaryDown was already true walking
// in), there's nothing left to fall back to and the failure is real.
async function fetchWithFailover(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const firstBase = activeBase();
  const replayable = ["GET","HEAD","OPTIONS"].includes((init.method??"GET").toUpperCase());
  let res: Response;
  try {
    res = await fetchWithTimeout(`${firstBase}${path}`, init, timeoutMs);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    if (firstBase === BACKUP_BASE) throw err;
    markPrimaryDown();
    if (!replayable) throw err;
    return fetchWithTimeout(`${BACKUP_BASE}${path}`, init, timeoutMs);
  }

  const platform404 = res.status === 404 && firstBase !== BACKUP_BASE &&
    isRailwayPlatformNotFound(Object.fromEntries(res.headers), await res.clone().text());
  if ((platform404 || res.status === 502 || res.status === 503 || res.status === 504) && firstBase !== BACKUP_BASE) {
    markPrimaryDown();
    if (replayable) return fetchWithTimeout(`${BACKUP_BASE}${path}`, init, timeoutMs);
  }

  return res;
}

// The receipt endpoint takes a real image file (multipart/form-data), which
// the shared `http` axios instance above isn't set up for — everything else
// is JSON. Built on the platform's own `fetch`/`FormData`/`Blob` instead of
// pulling in a multipart-encoding dependency just for this one call.
//
// `form` (and the Blob wrapping the receipt buffer) is a plain in-memory
// object, not a one-shot Node stream — reusing the same FormData instance
// for a second fetch() call if the first attempt fails over is safe; nothing
// here is consumed/destroyed by the first request.
async function postMultipart<T>(
  path: string,
  fields: Record<string, string>,
  file: { buffer: Buffer; filename: string; contentType: string }
): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("receipt", new Blob([new Uint8Array(file.buffer)], { type: file.contentType }), file.filename);

  let res: Response;
  try {
    res = await fetchWithFailover(`/api/bot${path}`, {
      method: "POST",
      headers: { "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
      body: form,
    }, HEAVY_TIMEOUT_MS);
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : "Network error");
  }

  const json = (await res.json().catch(() => null)) as { success: boolean; data?: T; error?: { message?: string } } | null;

  if (!res.ok || !json?.success) {
    throw new ApiError(json?.error?.message ?? `Backend error (${res.status})`, res.status);
  }
  return json.data as T;
}

export type PlanTier = "bor" | "pro";
export type PlanDuration = 1 | 6 | 12;

export type PricingResponse = {
  pricing: Record<PlanTier, Record<string, number>>;
  features: Record<PlanTier, string[]>;
  clickEnabled: boolean;
};

export type UserLookup = {
  userId: string;
  username: string;
  phone_number: string;
  tier: "tekin" | PlanTier;
  subscriptionEndDate: string | null;
};

export type PaymentOcrResult = {
  extractedAmount: number | null;
  extractedText: string | null;
  transactionRef: string | null;
  amountMatched: boolean;
};

export type PaymentSenderCardDetails = {
  cardNumber: string;
  fullName: string;
};

export type Payment = {
  id: string;
  userId: string;
  telegramUserId: string;
  telegramUsername?: string;
  tier: PlanTier;
  durationMonths: PlanDuration;
  amount: number;
  method: "click" | "manual_card";
  // "provisioned" = OCR matched the amount and the tier was already granted
  // on trust, pending a human's later sign-off (see attachReceipt below).
  status: "pending" | "provisioned" | "approved" | "rejected" | "completed" | "cancelled";
  receiptFileId?: string;
  receiptImageUrl?: string | null;
  ocr?: PaymentOcrResult | null;
  senderCardDetails?: PaymentSenderCardDetails | null;
  rejectedReason?: string | null;
  merchantTransId?: string;
  createdAt: string;
};

export type ExpiringSoon = {
  subscriptionId: string;
  userId: string;
  telegramId: string;
  username: string;
  tier: PlanTier;
  subscriptionEndDate: string;
};

export const api = {
  requestPasswordReset: (telegramId: string) =>
    unwrap<{ resetUrl: string; expiresAt: string }>(http.post("/password-reset", { telegramId })),
  startRegistration: (startToken: string, telegramId: string) =>
    unwrap<{ verified: boolean }>(http.post("/registration/start", { startToken, telegramId })),
  confirmRegistration: (telegramId: string, contactUserId: string, phone: string, telegramUsername?: string) =>
    unwrap<{ verified: boolean }>(http.post("/registration/confirm", { telegramId, contactUserId, phone, telegramUsername })),
  getPricing(): Promise<PricingResponse> {
    return unwrap(http.get("/pricing"));
  },

  lookupUserByPhone(phone: string): Promise<UserLookup | null> {
    return unwrap<UserLookup>(http.post("/lookup", { phone })).catch((err): UserLookup | null => {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    });
  },

  lookupUserByTelegramId(telegramId: string): Promise<UserLookup | null> {
    return unwrap<UserLookup>(http.get(`/lookup-by-telegram/${telegramId}`)).catch((err): UserLookup | null => {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    });
  },

  linkTelegram(userId: string, telegramId: string, telegramUsername: string | undefined, verifiedPhone: string): Promise<void> {
    return unwrap(http.post("/link-telegram", { userId, telegramId, telegramUsername, verifiedPhone, contactTelegramId:telegramId })).then(() => undefined);
  },

  getSubscriptionStatus(userId: string): Promise<UserLookup> {
    return unwrap(http.get(`/subscription/${userId}`));
  },

  createManualPayment(input: {
    userId: string;
    telegramUserId: string;
    telegramUsername?: string;
    tier: PlanTier;
    durationMonths: PlanDuration;
  }): Promise<Payment> {
    return unwrap(http.post("/payments/manual", input));
  },

  attachReceipt(
    paymentId: string,
    receiptFileId: string,
    file: { buffer: Buffer; contentType: string },
    telegramUserId:string,
  ): Promise<{ payment: Payment; provisioned: boolean }> {
    return postMultipart(`/payments/${paymentId}/receipt`, { receiptFileId, telegramUserId }, {
      buffer: file.buffer,
      filename: "receipt.jpg",
      contentType: file.contentType,
    });
  },

  // Screenshot-free flow: the user types the card they sent from + their
  // name instead of forwarding a screenshot. No OCR runs on this path —
  // status stays "pending" for an admin to review by hand.
  submitCardDetails(paymentId: string, cardNumber: string, fullName: string, telegramUserId:string): Promise<Payment> {
    return unwrap(http.post(`/payments/${paymentId}/card-details`, { cardNumber, fullName, telegramUserId }));
  },

  approvePayment(paymentId: string, approvedByTelegramId: string): Promise<Payment> {
    return unwrap(http.post(`/payments/${paymentId}/approve`, { approvedByTelegramId }));
  },

  rejectPayment(
    paymentId: string,
    rejectedByTelegramId: string,
    reason?: string
  ): Promise<{ payment: Payment; wasDowngraded: boolean }> {
    return unwrap(http.post(`/payments/${paymentId}/reject`, { rejectedByTelegramId, reason }));
  },

  getPendingPayments(): Promise<Payment[]> {
    return unwrap(http.get("/payments/pending"));
  },

  getPaymentsByUser(userId: string): Promise<Payment[]> {
    return unwrap(http.get(`/payments/user/${userId}`));
  },

  getPayment(paymentId: string): Promise<Payment> {
    return unwrap(http.get(`/payments/${paymentId}`));
  },

  createClickPending(input: {
    userId: string;
    telegramUserId: string;
    telegramUsername?: string;
    tier: PlanTier;
    durationMonths: PlanDuration;
  }): Promise<{ payment: Payment; payUrl: string }> {
    return unwrap(http.post("/payments/click", input));
  },

  getExpiringSoon(days: number): Promise<ExpiringSoon[]> {
    return unwrap(http.get("/expiring-soon", { params: { days } }));
  },

  markReminderSent(subscriptionId: string, expectedEndDate:string): Promise<{ ok: boolean }> {
    return unwrap(http.post(`/expiring-soon/${subscriptionId}/mark-reminded`, {expectedEndDate}));
  },
};
