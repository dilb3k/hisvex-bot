import { Markup } from "telegraf";

import type { BotContext } from "../context";
import { texts } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";
import { showMainMenu, isAdmin } from "./menu";

export async function handleStart(ctx: BotContext) {
  // Already linked in this session — go straight to the menu instead of
  // asking for the phone number again every time. Re-send the persistent
  // keyboard too, in case the user cleared it or is on a fresh device.
  if (ctx.session.userId) {
    await ctx.reply(texts.welcomeBack, keyboards.persistentMenu(isAdmin(ctx.from?.id)));
    return showMainMenu(ctx);
  }
  await ctx.reply(texts.welcome, { parse_mode: "HTML", ...keyboards.requestPhone });
}

export async function handleContact(ctx: BotContext) {
  const contact = (ctx.message as any)?.contact;
  if (!contact?.phone_number) return;

  // A user could theoretically forward someone ELSE's contact card instead
  // of sharing their own — only trust it if Telegram says it's the sender's
  // own contact (contact.user_id matches the sender).
  if (contact.user_id && contact.user_id !== ctx.from?.id) {
    await ctx.reply(texts.genericError, Markup.removeKeyboard());
    return;
  }

  await linkByPhone(ctx, contact.phone_number);
}

export async function linkByPhone(ctx: BotContext, phone: string) {
  try {
    const user = await api.lookupUserByPhone(phone);
    if (!user) {
      await ctx.reply(texts.userNotFound(phone), {
        parse_mode: "HTML",
        ...Markup.removeKeyboard(),
      });
      await ctx.reply(" ", {
        ...Markup.inlineKeyboard([
          [Markup.button.url(texts.openAppButton, env.APP_DOWNLOAD_URL)],
          [Markup.button.callback(texts.retryButton, "retry_link")],
        ]),
      });
      return;
    }

    await api.linkTelegram(user.userId, String(ctx.from!.id), ctx.from?.username);
    ctx.session.userId = user.userId;
    ctx.session.username = user.username;

    // Swap the one-time "share phone" keyboard for the persistent menu —
    // it stays visible for the rest of the chat from here on.
    await ctx.reply(texts.linked(user.username), {
      parse_mode: "HTML",
      ...keyboards.persistentMenu(isAdmin(ctx.from?.id)),
    });
    await showMainMenu(ctx);
  } catch (err) {
    console.error("linkByPhone failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleRetryLink(ctx: BotContext) {
  await ctx.answerCbQuery();
  await ctx.reply(texts.welcome, { parse_mode: "HTML", ...keyboards.requestPhone });
}
