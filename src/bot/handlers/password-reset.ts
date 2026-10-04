import { Markup } from "telegraf";
import type { BotContext } from "../context";
import { api, ApiError } from "../../services/api-client";
import { texts } from "../texts";
import { keyboards } from "../keyboards";
import { ackIfCallback } from "../respond";

export async function handlePasswordReset(ctx: BotContext) {
  // Reset links must never be posted to groups, even by a linked user.
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  await ackIfCallback(ctx);
  ctx.session.awaitingCardInfoFor = undefined;
  try {
    // Resolve the sender from the backend every time. An old in-memory userId
    // or a forwarded callback cannot choose somebody else's account.
    const result = await api.requestPasswordReset(String(ctx.from.id));
    await ctx.reply(texts.passwordResetReady, {
      ...Markup.inlineKeyboard([[Markup.button.url(texts.passwordResetOpen, result.resetUrl)]]),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      await ctx.reply(texts.passwordResetNotLinked, keyboards.requestPhone);
    } else if (error instanceof ApiError && error.statusCode === 429) {
      await ctx.reply(texts.passwordResetWait);
    } else {
      await ctx.reply(texts.genericError);
    }
  }
}
