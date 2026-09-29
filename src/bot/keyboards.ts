import { Markup } from "telegraf";

import { texts, TIER_LABEL, DURATION_LABEL, formatSom } from "./texts";
import type { PlanDuration, PlanTier } from "../services/api-client";

export const keyboards = {
  requestPhone: Markup.keyboard([Markup.button.contactRequest(texts.requestPhoneButton)])
    .oneTime()
    .resize(),

  retry: Markup.inlineKeyboard([Markup.button.callback(texts.retryButton, "retry_link")]),

  // The persistent bottom keyboard — stays visible after it's sent once,
  // so a linked user always has the menu at hand without hunting for
  // /start or scrolling back to an old inline-button message.
  persistentMenu: (isAdmin: boolean) =>
    Markup.keyboard([
      [texts.menuButtons.buySubscription],
      [texts.menuButtons.myAccount, texts.menuButtons.myPayments],
      ...(isAdmin ? [[texts.menuButtons.help, texts.menuButtons.admin]] : [[texts.menuButtons.help]]),
    ]).resize(),

  mainMenu: (isAdmin: boolean) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(texts.menuButtons.buySubscription, "menu_buy")],
      [Markup.button.callback(texts.menuButtons.myAccount, "menu_account")],
      [Markup.button.callback(texts.menuButtons.myPayments, "menu_payments")],
      [Markup.button.callback(texts.menuButtons.help, "menu_help")],
      ...(isAdmin ? [[Markup.button.callback(texts.menuButtons.admin, "menu_admin")]] : []),
    ]),

  choosePlan: Markup.inlineKeyboard([
    [Markup.button.callback(`${TIER_LABEL.bor}`, "plan_tier_bor")],
    [Markup.button.callback(`${TIER_LABEL.pro} ⭐️`, "plan_tier_pro")],
    [Markup.button.callback(texts.back, "menu_main")],
  ]),

  // Price is baked into each button's own label (not just the message text
  // above it) so the cost of a tap is visible without reading elsewhere —
  // one less thing between "interested" and "paying".
  chooseDuration: (tier: PlanTier, pricing: Record<string, number>) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(`${DURATION_LABEL[1]} — ${formatSom(pricing["1"])}`, `plan_dur_${tier}_1`)],
      [Markup.button.callback(`${DURATION_LABEL[6]} — ${formatSom(pricing["6"])}`, `plan_dur_${tier}_6`)],
      [Markup.button.callback(`${DURATION_LABEL[12]} — ${formatSom(pricing["12"])}`, `plan_dur_${tier}_12`)],
      [Markup.button.callback(texts.back, "menu_buy")],
    ]),

  chooseMethod: (tier: PlanTier, duration: PlanDuration, clickEnabled: boolean) =>
    Markup.inlineKeyboard([
      ...(clickEnabled ? [[Markup.button.callback(texts.methodClick, `pay_click_${tier}_${duration}`)]] : []),
      [Markup.button.callback(texts.methodManual, `pay_manual_${tier}_${duration}`)],
      [Markup.button.callback(texts.back, `plan_tier_${tier}`)],
    ]),

  clickPayLink: (url: string) =>
    Markup.inlineKeyboard([
      [Markup.button.url(texts.clickPayButton, url)],
      [Markup.button.callback(texts.back, "menu_main")],
    ]),

  manualCardActions: (paymentId: string) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(texts.noReceiptButton, `no_receipt_${paymentId}`)],
      [Markup.button.callback(texts.back, "menu_main")],
    ]),

  // Attached to the three "submitted, waiting on admin" confirmations
  // (screenshot accepted, provisioned, card-details submitted) — lets the
  // user check in without having to dig through "🧾 To'lovlarim".
  paymentSubmittedActions: (paymentId: string) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(texts.checkStatusButton, `check_payment_${paymentId}`)],
      [Markup.button.callback(texts.back, "menu_main")],
    ]),

  accountActions: (ctaLabel: string | null) =>
    Markup.inlineKeyboard([
      ...(ctaLabel ? [[Markup.button.callback(ctaLabel, "menu_buy")]] : []),
      [Markup.button.callback(texts.back, "menu_main")],
    ]),

  adminPaymentActions: (paymentId: string) =>
    Markup.inlineKeyboard([
      [
        Markup.button.callback(texts.adminApproveButton, `admin_approve_${paymentId}`),
        Markup.button.callback(texts.adminRejectButton, `admin_reject_${paymentId}`),
      ],
    ]),

  backToMenu: Markup.inlineKeyboard([[Markup.button.callback(texts.back, "menu_main")]]),
};
