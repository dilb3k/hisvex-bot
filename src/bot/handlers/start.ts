import { Markup } from "telegraf";

import type { BotContext } from "../context";
import { texts } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";
import { showMainMenu, isAdmin, resolveLinkedUser } from "./menu";
import { handlePasswordReset } from "./password-reset";

export async function handleStart(ctx: BotContext) {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  ctx.session.awaitingCardInfoFor = undefined;
  const payload = (ctx.message as { text?: string } | undefined)?.text?.trim().split(/\s+/)[1];
  if (payload === "reset_password") return handlePasswordReset(ctx);
  if (payload?.startsWith("reg_")) {
    try {
      const result = await api.startRegistration(payload.slice(4), String(ctx.from.id));
      await ctx.reply(result.verified
        ? "✅ Telefon tasdiqlangan. Formaga qaytib ro‘yxatdan o‘tishni yakunlang."
        : "Ro‘yxatdan o‘tish uchun quyidagi «Telefon raqamni yuborish» tugmasini bosing. Raqamingiz formaga avtomatik tushadi.",
        result.verified ? Markup.removeKeyboard() : keyboards.requestPhone);
    } catch (err) {
      await ctx.reply(err instanceof Error ? err.message : texts.genericError);
    }
    return;
  }
  // Already linked — go straight to the menu instead of asking for the phone
  // number again every time. resolveLinkedUser() also covers a linked user
  // whose in-memory session was wiped by a bot restart (see its comment in
  // menu.ts) by re-resolving the durable link from telegramId, so a restart
  // doesn't put every existing user back through "share your phone number".
  // Re-send the persistent keyboard too, in case the user cleared it or is
  // on a fresh device.
  const linked = await resolveLinkedUser(ctx);
  if (linked) {
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
  if (ctx.chat?.type !== "private" || !contact.user_id || contact.user_id !== ctx.from?.id) {
    await ctx.reply("O‘zingizning telefon raqamingizni quyidagi tugma orqali yuboring.", keyboards.requestPhone);
    return;
  }

  try {
    const result = await api.confirmRegistration(String(ctx.from!.id), String(contact.user_id), contact.phone_number, ctx.from?.username);
    if (result.verified) {
      await ctx.reply("✅ Telefon raqamingiz tasdiqlandi! Formaga qayting — raqamingiz avtomatik kiritildi. Ro‘yxatdan o‘tishni yakunlang.", Markup.removeKeyboard());
      return;
    }
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : texts.genericError, keyboards.requestPhone);
    return;
  }
  await linkByPhone(ctx, contact.phone_number);
}

async function linkByPhone(ctx: BotContext, phone: string) {
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

    await api.linkTelegram(user.userId, String(ctx.from!.id), ctx.from?.username, phone);
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
