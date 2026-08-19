import type { BotContext } from "../context";
import { texts, formatDate, formatSom } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { isAdmin } from "./menu";
import { respond, ackIfCallback } from "../respond";

function displayName(ctx: BotContext): string {
  const u = ctx.from;
  if (!u) return "admin";
  return u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(" ") || String(u.id);
}

export async function handleAdminApprove(ctx: BotContext, paymentId: string) {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.answerCbQuery(texts.notAdmin, { show_alert: true });
    return;
  }

  try {
    const payment = await api.approvePayment(paymentId, String(ctx.from!.id));
    await ctx.answerCbQuery("✅");

    const who = displayName(ctx);
    await editApprovalCard(ctx, texts.adminApproved(who));

    // The approval itself already succeeded and is reflected on the card —
    // don't let a failed DM (e.g. the user blocked the bot) fall through to
    // the outer catch and show the admin a misleading "xatolik" alert for
    // an action that actually went through.
    try {
      const status = await api.getSubscriptionStatus(payment.userId);
      await ctx.telegram.sendMessage(
        payment.telegramUserId,
        texts.paymentApprovedUser(payment.tier, formatDate(status.subscriptionEndDate)),
        { parse_mode: "HTML" }
      );
    } catch (notifyErr) {
      console.error(`Failed to notify user ${payment.telegramUserId} of payment approval`, notifyErr);
    }
  } catch (err) {
    console.error("handleAdminApprove failed", err);
    await ctx.answerCbQuery(texts.genericError, { show_alert: true });
  }
}

export async function handleAdminReject(ctx: BotContext, paymentId: string) {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.answerCbQuery(texts.notAdmin, { show_alert: true });
    return;
  }

  try {
    const payment = await api.rejectPayment(paymentId, String(ctx.from!.id));
    await ctx.answerCbQuery("❌");

    const who = displayName(ctx);
    await editApprovalCard(ctx, texts.adminRejected(who));

    // Same reasoning as handleAdminApprove: the rejection already went
    // through, so a blocked-bot DM failure shouldn't surface as an error.
    try {
      await ctx.telegram.sendMessage(payment.telegramUserId, texts.paymentRejectedUser(), { parse_mode: "HTML" });
    } catch (notifyErr) {
      console.error(`Failed to notify user ${payment.telegramUserId} of payment rejection`, notifyErr);
    }
  } catch (err) {
    console.error("handleAdminReject failed", err);
    await ctx.answerCbQuery(texts.genericError, { show_alert: true });
  }
}

// The approval card is a photo message (the receipt) with a caption —
// editMessageCaption (not editMessageText) is the right API for that, and
// we drop the inline keyboard so a second admin can't double-tap it.
async function editApprovalCard(ctx: BotContext, statusLine: string) {
  const original = (ctx.callbackQuery as any)?.message?.caption as string | undefined;
  const newCaption = original ? `${original}\n\n${statusLine}` : statusLine;
  try {
    await ctx.editMessageCaption(newCaption, { parse_mode: "HTML" });
  } catch {
    // If the original message had no caption (shouldn't happen for our own
    // photo+caption sends, but don't let a formatting edge case crash the
    // handler) fall back to a plain reply so the decision is still visible.
    await ctx.reply(statusLine);
  }
}

export async function handleMenuAdmin(ctx: BotContext) {
  await ackIfCallback(ctx);
  if (!isAdmin(ctx.from?.id)) {
    await respond(ctx, texts.notAdmin, keyboards.backToMenu);
    return;
  }

  try {
    const pending = await api.getPendingPayments();
    // Only manual_card payments wait on an admin's tap here — "pending"
    // click payments (if any show up mid-webhook) resolve themselves and
    // were never actionable from this list. Filter before counting, not
    // after: counting the unfiltered total against a filtered list of rows
    // showed a header like "3 ta kutilmoqda" above only 1 visible row,
    // which read as the other 2 having silently vanished.
    const manualPending = pending.filter((p) => p.method === "manual_card");
    if (manualPending.length === 0) {
      await respond(ctx, `${texts.adminPendingList(0)}\n\n${texts.adminPendingEmpty}`, {
        parse_mode: "HTML",
        ...keyboards.backToMenu,
      });
      return;
    }

    const lines = manualPending
      .map((p) => `• <b>${p.telegramUsername ?? p.telegramUserId}</b> — ${p.tier} / ${p.durationMonths} oy — ${formatSom(p.amount)} — <code>${p.id}</code>`)
      .join("\n");

    await respond(ctx, `${texts.adminPendingList(manualPending.length)}\n\n${lines}`, {
      parse_mode: "HTML",
      ...keyboards.backToMenu,
    });
  } catch (err) {
    console.error("handleMenuAdmin failed", err);
    await ctx.reply(texts.genericError);
  }
}
