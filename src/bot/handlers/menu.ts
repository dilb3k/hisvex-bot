import type { BotContext } from "../context";
import { texts, formatDate, daysLeft } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";

export function isAdmin(telegramId: number | undefined): boolean {
  return !!telegramId && env.ADMIN_TELEGRAM_IDS.includes(String(telegramId));
}

export async function requireLinked(ctx: BotContext): Promise<string | null> {
  if (ctx.session.userId) return ctx.session.userId;
  await ctx.reply(texts.welcome, { parse_mode: "HTML", ...keyboards.requestPhone });
  return null;
}

export async function showMainMenu(ctx: BotContext) {
  const admin = isAdmin(ctx.from?.id);
  await ctx.reply(texts.mainMenu, keyboards.mainMenu(admin));
}

export async function handleMenuMain(ctx: BotContext) {
  await ctx.answerCbQuery();
  const admin = isAdmin(ctx.from?.id);
  await ctx.editMessageText(texts.mainMenu, keyboards.mainMenu(admin));
}

export async function handleMenuAccount(ctx: BotContext) {
  await ctx.answerCbQuery();
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const status = await api.getSubscriptionStatus(userId);
    const left = daysLeft(status.subscriptionEndDate);
    await ctx.editMessageText(
      texts.myAccount(status.username, status.tier, formatDate(status.subscriptionEndDate), left),
      { parse_mode: "HTML", ...keyboards.backToMenu }
    );
  } catch (err) {
    console.error("handleMenuAccount failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleMenuHelp(ctx: BotContext) {
  await ctx.answerCbQuery();
  await ctx.editMessageText(texts.help, { parse_mode: "HTML", ...keyboards.backToMenu });
}
