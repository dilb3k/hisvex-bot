import { Telegraf, session } from "telegraf";
import { message } from "telegraf/filters";

import { env } from "../config/env";
import type { BotContext } from "./context";
import { emptySession } from "./context";
import { texts } from "./texts";
import type { PlanDuration, PlanTier } from "../services/api-client";

import { handleStart, handleContact, handleRetryLink, linkByPhone } from "./handlers/start";
import { handleMenuMain, handleMenuAccount, handleMenuHelp } from "./handlers/menu";
import { handleMenuBuy, handleChooseTier, handleChooseDuration, handlePayManual, handlePayClick } from "./handlers/plans";
import { handlePhoto } from "./handlers/receipt";
import { handleMenuAdmin, handleAdminApprove, handleAdminReject } from "./handlers/admin";
import { handleMenuPayments } from "./handlers/payments";

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  bot.use(session({ defaultSession: emptySession }));

  bot.start(handleStart);
  bot.help((ctx) => ctx.reply(texts.help, { parse_mode: "HTML" }));

  bot.on(message("contact"), handleContact);
  bot.on(message("photo"), handlePhoto);

  // Also accept a phone number typed as plain text (some users decline the
  // "share contact" button but will type the number instead).
  bot.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();
    const digits = text.replace(/\D/g, "");
    if (!ctx.session.userId && digits.length >= 9 && digits.length <= 13) {
      await linkByPhone(ctx, text);
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

  // Persistent reply-keyboard buttons (bottom menu) — same destinations as
  // the inline "menu_*" actions above, just triggered by a plain text tap
  // instead of a callback query.
  bot.hears(texts.menuButtons.buySubscription, handleMenuBuy);
  bot.hears(texts.menuButtons.myAccount, handleMenuAccount);
  bot.hears(texts.menuButtons.myPayments, handleMenuPayments);
  bot.hears(texts.menuButtons.help, handleMenuHelp);
  bot.hears(texts.menuButtons.admin, handleMenuAdmin);

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

  bot.action(/^admin_approve_(.+)$/, (ctx) => handleAdminApprove(ctx, ctx.match[1]));
  bot.action(/^admin_reject_(.+)$/, (ctx) => handleAdminReject(ctx, ctx.match[1]));

  bot.catch((err, ctx) => {
    console.error(`Unhandled bot error for update ${ctx.updateType}`, err);
    ctx.reply(texts.genericError).catch(() => undefined);
  });

  return bot;
}
