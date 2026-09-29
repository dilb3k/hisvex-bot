import axios, { AxiosError } from "axios";

import { env } from "../config/env";

const http = axios.create({
  baseURL: `${env.BACKEND_URL.replace(/\/$/, "")}/api/bot`,
  timeout: 15_000,
  headers: { "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
});

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

// The receipt endpoint takes a real image file (multipart/form-data), which
// the shared `http` axios instance above isn't set up for — everything else
// is JSON. Built on the platform's own `fetch`/`FormData`/`Blob` instead of
// pulling in a multipart-encoding dependency just for this one call.
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
    res = await fetch(`${env.BACKEND_URL.replace(/\/$/, "")}/api/bot${path}`, {
      method: "POST",
      headers: { "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
      body: form,
    });
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

  linkTelegram(userId: string, telegramId: string, telegramUsername?: string): Promise<void> {
    return unwrap(http.post("/link-telegram", { userId, telegramId, telegramUsername })).then(() => undefined);
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
    file: { buffer: Buffer; contentType: string }
  ): Promise<{ payment: Payment; provisioned: boolean }> {
    return postMultipart(`/payments/${paymentId}/receipt`, { receiptFileId }, {
      buffer: file.buffer,
      filename: "receipt.jpg",
      contentType: file.contentType,
    });
  },

  // Screenshot-free flow: the user types the card they sent from + their
  // name instead of forwarding a screenshot. No OCR runs on this path —
  // status stays "pending" for an admin to review by hand.
  submitCardDetails(paymentId: string, cardNumber: string, fullName: string): Promise<Payment> {
    return unwrap(http.post(`/payments/${paymentId}/card-details`, { cardNumber, fullName }));
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

  markReminderSent(subscriptionId: string): Promise<{ ok: boolean }> {
    return unwrap(http.post(`/expiring-soon/${subscriptionId}/mark-reminded`, {}));
  },
};
