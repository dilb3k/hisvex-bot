import { Markup } from "telegraf";

import { texts, TIER_LABEL, DURATION_LABEL } from "./texts";
import type { PlanDuration, PlanTier } from "../services/api-client";

export const keyboards = {
  requestPhone: Markup.keyboard([Markup.button.contactRequest(texts.requestPhoneButton)])
    .oneTime()
    .resize(),

  retry: Markup.inlineKeyboard([Markup.button.callback(texts.retryButton, "retry_link")]),

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

  chooseDuration: (tier: PlanTier) =>
    Markup.inlineKeyboard([
      [Markup.button.callback(DURATION_LABEL[1], `plan_dur_${tier}_1`)],
      [Markup.button.callback(DURATION_LABEL[6], `plan_dur_${tier}_6`)],
      [Markup.button.callback(DURATION_LABEL[12], `plan_dur_${tier}_12`)],
      [Markup.button.callback(texts.back, "menu_buy")],
    ]),

  chooseMethod: (tier: PlanTier, duration: PlanDuration, clickEnabled: boolean) =>
    Markup.inlineKeyboard([
      ...(clickEnabled ? [[Markup.button.callback(texts.methodClick, `pay_click_${tier}_${duration}`)]] : []),
      [Markup.button.callback(texts.methodManual, `pay_manual_${tier}_${duration}`)],
      [Markup.button.callback(texts.back, `plan_tier_${tier}`)],
    ]),

  clickPayLink: (url: string) => Markup.inlineKeyboard([[Markup.button.url(texts.clickPayButton, url)]]),

  adminPaymentActions: (paymentId: string) =>
    Markup.inlineKeyboard([
      [
        Markup.button.callback(texts.adminApproveButton, `admin_approve_${paymentId}`),
        Markup.button.callback(texts.adminRejectButton, `admin_reject_${paymentId}`),
      ],
    ]),

  backToMenu: Markup.inlineKeyboard([[Markup.button.callback(texts.back, "menu_main")]]),
};
