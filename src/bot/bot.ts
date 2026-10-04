import { Telegraf, session } from "telegraf";
import { message } from "telegraf/filters";

import { env } from "../config/env";
import type { BotContext } from "./context";
import { emptySession } from "./context";
import { texts } from "./texts";
import type { PlanDuration, PlanTier } from "../services/api-client";

import { handleStart, handleContact, handleRetryLink } from "./handlers/start";
import { handleMenuMain, handleMenuAccount, handleMenuHelp } from "./handlers/menu";
import { handleMenuBuy, handleChooseTier, handleChooseDuration, handlePayManual, handlePayClick } from "./handlers/plans";
import {
  handlePhoto,
  handleNoReceipt,
  handleCardDetailsText,
  looksLikeCardDetails,
  recoverCardDetailsPaymentId,
} from "./handlers/receipt";
import { handleMenuAdmin, handleAdminApprove, handleAdminReject } from "./handlers/admin";
import { handleMenuPayments, handleCheckPaymentStatus } from "./handlers/payments";
import { handlePasswordReset, handleCancelPasswordReset, passwordResetMiddleware } from "./handlers/password-reset";

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  bot.use(session({ defaultSession: emptySession }));
  bot.use(passwordResetMiddleware);

  bot.start(handleStart);
  bot.command("reset_password", handlePasswordReset);
  bot.command("cancel", handleCancelPasswordReset);
  bot.help((ctx) => ctx.reply(texts.help, { parse_mode: "HTML" }));

  bot.on(message("contact"), handleContact);
  bot.on(message("photo"), handlePhoto);

  // Persistent-keyboard labels (and /start) double as an escape hatch out
  // of awaitingCardInfoFor below — without this, a user who taps a menu
  // button instead of typing "<card>, <name>" gets stuck: every text
  // message would be swallowed as "invalid card details" forever, since
  // bot.hears() for these labels is registered later and never gets a turn.
  const MENU_ESCAPE_TEXTS = new Set<string>([
    texts.menuButtons.buySubscription,
    texts.menuButtons.myAccount,
    texts.menuButtons.myPayments,
    texts.menuButtons.help,
    texts.menuButtons.admin,
    texts.menuButtons.resetPassword,
  ]);

  // Screenshot-free flow: a text message is "<card number>, <full name>"
  // when the user is (or, if the session was lost, plausibly still is)
  // mid-way through answering "no_receipt_*"'s prompt. Checked before the
  // phone-number middleware below since it has nothing to do with linking.
  bot.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();

    if (ctx.session.awaitingCardInfoFor) {
      if (text.startsWith("/") || MENU_ESCAPE_TEXTS.has(text)) {
        ctx.session.awaitingCardInfoFor = undefined;
        return next();
      }
      await handleCardDetailsText(ctx, ctx.session.awaitingCardInfoFor);
      return;
    }

    if (looksLikeCardDetails(text)) {
      const recoveredPaymentId = await recoverCardDetailsPaymentId(ctx);
      if (recoveredPaymentId) {
        await handleCardDetailsText(ctx, recoveredPaymentId);
        return;
      }
    }

    return next();
  });

  // Typing a phone number cannot prove ownership, including during signup
  // from a Telegram account that was already linked before this Start.
  bot.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 13) {
      await ctx.reply("Telefon raqamini yozish egalikni tasdiqlamaydi. O‘zingizning kontaktingizni tugma orqali yuboring.", (await import("./keyboards")).keyboards.requestPhone);
      return;
    }
    return next();
  });

  bot.action("retry_link", handleRetryLink);
  bot.action("menu_main", handleMenuMain);
  bot.action("menu_account", handleMenuAccount);
  bot.action("menu_payments", handleMenuPayments);
  bot.action("menu_help", handleMenuHelp);
  bot.action("menu_admin", handleMenuAdmin);
  bot.action("menu_buy", handleMenuBuy);
  bot.action("menu_reset_password", handlePasswordReset);

  // Persistent reply-keyboard buttons (bottom menu) — same destinations as
  // the inline "menu_*" actions above, just triggered by a plain text tap
  // instead of a callback query.
  bot.hears(texts.menuButtons.buySubscription, handleMenuBuy);
  bot.hears(texts.menuButtons.myAccount, handleMenuAccount);
  bot.hears(texts.menuButtons.myPayments, handleMenuPayments);
  bot.hears(texts.menuButtons.help, handleMenuHelp);
  bot.hears(texts.menuButtons.admin, handleMenuAdmin);
  bot.hears(texts.menuButtons.resetPassword, handlePasswordReset);

  bot.action(/^plan_tier_(bor|pro)$/, (ctx) => handleChooseTier(ctx, ctx.match[1] as PlanTier));

  bot.action(/^plan_dur_(bor|pro)_(1|6|12)$/, (ctx) =>
    handleChooseDuration(ctx, ctx.match[1] as PlanTier, Number(ctx.match[2]) as PlanDuration)
  );

  bot.action(/^pay_manual_(bor|pro)_(1|6|12)$/, (ctx) =>
    handlePayManual(ctx, ctx.match[1] as PlanTier, Number(ctx.match[2]) as PlanDuration)
  );

  bot.action(/^pay_click_(bor|pro)_(1|6|12)$/, (ctx) =>
    handlePayClick(ctx, ctx.match[1] as PlanTier, Number(ctx.match[2]) as PlanDuration)
  );

  bot.action(/^no_receipt_(.+)$/, (ctx) => handleNoReceipt(ctx, ctx.match[1]));
  bot.action(/^check_payment_(.+)$/, (ctx) => handleCheckPaymentStatus(ctx, ctx.match[1]));

  bot.action(/^admin_approve_(.+)$/, (ctx) => handleAdminApprove(ctx, ctx.match[1]));
  bot.action(/^admin_reject_(.+)$/, (ctx) => handleAdminReject(ctx, ctx.match[1]));

  bot.catch((_err, ctx) => {
    // Telegram/HTTP error objects can contain incoming or outgoing secrets.
    console.error(`Unhandled bot error for update ${ctx.updateType}`);
    ctx.reply(texts.genericError).catch(() => undefined);
  });

  return bot;
}
