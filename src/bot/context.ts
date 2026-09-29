import type { Context } from "telegraf";
import type { PlanDuration, PlanTier } from "../services/api-client";

export interface SessionData {
  userId?: string;
  username?: string;
  // Set right after the user picks tier+duration and taps "Karta orqali",
  // so the next photo message they send is understood as a receipt for
  // this specific pending payment rather than a random image.
  awaitingReceiptFor?: { paymentId: string; tier: PlanTier; durationMonths: PlanDuration };
  // Set when the user taps "Skrinshot qila olmadim / Chek yo'q" instead of
  // sending a receipt photo, so the next text message they send is
  // understood as "<card number>, <full name>" for this payment.
  awaitingCardInfoFor?: string | null;
}

export interface BotContext extends Context {
  session: SessionData;
}

export function emptySession(): SessionData {
  return {};
}
