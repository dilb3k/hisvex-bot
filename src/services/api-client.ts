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

export type Payment = {
  id: string;
  userId: string;
  telegramUserId: string;
  telegramUsername?: string;
  tier: PlanTier;
  durationMonths: PlanDuration;
  amount: number;
  method: "click" | "manual_card";
  status: "pending" | "approved" | "rejected" | "completed" | "cancelled";
  receiptFileId?: string;
  merchantTransId?: string;
  createdAt: string;
};

export type ExpiringSoon = {
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

  attachReceipt(paymentId: string, receiptFileId: string): Promise<Payment> {
    return unwrap(http.post(`/payments/${paymentId}/receipt`, { receiptFileId }));
  },

  approvePayment(paymentId: string, approvedByTelegramId: string): Promise<Payment> {
    return unwrap(http.post(`/payments/${paymentId}/approve`, { approvedByTelegramId }));
  },

  rejectPayment(paymentId: string, rejectedByTelegramId: string, reason?: string): Promise<Payment> {
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
};
