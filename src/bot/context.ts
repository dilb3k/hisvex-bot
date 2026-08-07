import type { Context } from "telegraf";
import type { PlanDuration, PlanTier } from "../services/api-client";

export interface SessionData {
  userId?: string;
  username?: string;
  // Set right after the user picks tier+duration and taps "Karta orqali",
  // so the next photo message they send is understood as a receipt for
  // this specific pending payment rather than a random image.
  awaitingReceiptFor?: { paymentId: string; tier: PlanTier; durationMonths: PlanDuration };
}

export interface BotContext extends Context {
  session: SessionData;
}

export function emptySession(): SessionData {
  return {};
}
