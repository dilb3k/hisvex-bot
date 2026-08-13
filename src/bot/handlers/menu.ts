import type { BotContext } from "../context";
import { texts, formatDate, daysLeft } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";
import { respond, ackIfCallback } from "../respond";

export function isAdmin(telegramId: number | undefined): boolean {
  return !!telegramId && env.ADMIN_TELEGRAM_IDS.includes(String(telegramId));
}

export async function requireLinked(ctx: BotContext): Promise<string | null> {
  const linked = await resolveLinkedUser(ctx);
  if (linked) return linked.userId;
  await ctx.reply(texts.welcome, { parse_mode: "HTML", ...keyboards.requestPhone });
  return null;
}

// Telegraf's session() middleware here has no store configured, so it's an
// in-memory Map that's wiped on every process restart (every deploy, and
// Render can also restart a worker on its own). The account link itself is
// NOT in-memory — linkByPhone() (start.ts) already persists telegramId on
// the user document via api.linkTelegram — so a restart shouldn't actually
// force a previously-linked user back through "share your phone number"
// again. Falling back to a lookup-by-telegramId call re-populates the
// session from that durable link instead of treating a lost in-memory
// session as "never linked".
export async function resolveLinkedUser(ctx: BotContext): Promise<{ userId: string; username?: string } | null> {
  if (ctx.session.userId) return { userId: ctx.session.userId, username: ctx.session.username };
  const telegramId = ctx.from?.id;
  if (!telegramId) return null;
  try {
    const user = await api.lookupUserByTelegramId(String(telegramId));
    if (!user) return null;
    ctx.session.userId = user.userId;
    ctx.session.username = user.username;
    return { userId: user.userId, username: user.username };
  } catch (err) {
    console.error("resolveLinkedUser failed", err);
    return null;
  }
}

export async function showMainMenu(ctx: BotContext) {
  const admin = isAdmin(ctx.from?.id);
  await ctx.reply(texts.mainMenu, keyboards.mainMenu(admin));
}

export async function handleMenuMain(ctx: BotContext) {
  await ackIfCallback(ctx);
  const admin = isAdmin(ctx.from?.id);
  await respond(ctx, texts.mainMenu, keyboards.mainMenu(admin));
}

export async function handleMenuAccount(ctx: BotContext) {
  await ackIfCallback(ctx);
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const status = await api.getSubscriptionStatus(userId);
    const left = daysLeft(status.subscriptionEndDate);
    await respond(
      ctx,
      texts.myAccount(status.username, status.tier, formatDate(status.subscriptionEndDate), left),
      { parse_mode: "HTML", ...keyboards.backToMenu }
    );
  } catch (err) {
    console.error("handleMenuAccount failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleMenuHelp(ctx: BotContext) {
  await ackIfCallback(ctx);
  await respond(ctx, texts.help, { parse_mode: "HTML", ...keyboards.backToMenu });
}
