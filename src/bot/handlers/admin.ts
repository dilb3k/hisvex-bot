import type { BotContext } from "../context";
import { texts, formatDate, formatSom, escapeTelegramHtml } from "../texts";
import { keyboards } from "../keyboards";
import { api, ApiError, type Payment } from "../../services/api-client";
import { isAdmin } from "./menu";
import { respond, ackIfCallback } from "../respond";

const reviewing = new Set<string>();

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

  if (reviewing.has(paymentId)) { await ctx.answerCbQuery("Amal bajarilmoqda. Biroz kuting."); return; }
  reviewing.add(paymentId);
  try {
    await ackIfCallback(ctx);
    const payment = await api.approvePayment(paymentId, String(ctx.from!.id));

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
    if (err instanceof ApiError && (err.statusCode === 400 || err.statusCode === 409)) {
      // The 48h auto-expire cron (or another admin, in a race) already
      // moved this payment out of "pending"/"provisioned" — nothing left to
      // approve, and it's not this admin's fault, so no "xatolik" alert.
      await ctx.reply(texts.adminAlreadyReviewed);
      return;
    }
    console.error("handleAdminApprove failed", err);
    await ctx.reply(texts.genericError);
  } finally { reviewing.delete(paymentId); }
}

export async function handleAdminReject(ctx: BotContext, paymentId: string) {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.answerCbQuery(texts.notAdmin, { show_alert: true });
    return;
  }

  if (reviewing.has(paymentId)) { await ctx.answerCbQuery("Amal bajarilmoqda. Biroz kuting."); return; }
  reviewing.add(paymentId);
  try {
    await ackIfCallback(ctx);
    const { payment, wasDowngraded } = await api.rejectPayment(paymentId, String(ctx.from!.id));

    const who = displayName(ctx);
    await editApprovalCard(ctx, texts.adminRejected(who));

    // Same reasoning as handleAdminApprove: the rejection already went
    // through, so a blocked-bot DM failure shouldn't surface as an error.
    // A "provisioned" payment had already granted the tier on trust (OCR
    // match) — wasDowngraded tells us that got taken back, which the user
    // needs to be told explicitly rather than the plain rejection message.
    try {
      const message = wasDowngraded ? texts.paymentRejectedDowngraded : texts.paymentRejectedUser();
      await ctx.telegram.sendMessage(payment.telegramUserId, message, { parse_mode: "HTML" });
    } catch (notifyErr) {
      console.error(`Failed to notify user ${payment.telegramUserId} of payment rejection`, notifyErr);
    }
  } catch (err) {
    if (err instanceof ApiError && (err.statusCode === 400 || err.statusCode === 409)) {
      await ctx.reply(texts.adminAlreadyReviewed);
      return;
    }
    console.error("handleAdminReject failed", err);
    await ctx.reply(texts.genericError);
  } finally { reviewing.delete(paymentId); }
}

async function editApprovalCard(ctx: BotContext, statusLine: string) {
  const message = (ctx.callbackQuery as any)?.message;
  const original = message?.caption ?? message?.text;
  const text = original ? `${escapeTelegramHtml(original)}\n\n${statusLine}` : statusLine;
  const options = { parse_mode: "HTML" as const, reply_markup: { inline_keyboard: [[{ text: "📋 To‘lovlar navbati", callback_data: "menu_admin" }]] } };
  try {
    if (message?.photo) await ctx.editMessageCaption(text, options);
    else await ctx.editMessageText(text, options);
  } catch { await ctx.reply(statusLine, options); }
}

export async function handleMenuAdmin(ctx: BotContext, page = 1) {
  await ackIfCallback(ctx);
  if (!isAdmin(ctx.from?.id)) {
    await respond(ctx, texts.notAdmin, keyboards.backToMenu);
    return;
  }
  try {
    let queue = await api.getReviewQueue(page);
    if (page > Math.max(1, queue.totalPages)) queue = await api.getReviewQueue(Math.max(1, queue.totalPages));
    const lines = queue.items.map((p, i) => {
      const name = escapeTelegramHtml((p.telegramUsername || p.telegramUserId).slice(0, 80));
      const state = p.needsReconciliation || p.status === "provisioned" ? "⚠️ Tekshirish kerak" : "⏳ Kutilmoqda";
      return `${(queue.page - 1) * 5 + i + 1}. <b>${name}</b>\n${p.tier.toUpperCase()} · ${p.durationMonths} oy · <b>${formatSom(p.amount)}</b>\n${formatDate(p.createdAt)} · ${state}`;
    });
    const inline_keyboard = queue.items.map((p, i) => [{ text: `${(queue.page - 1) * 5 + i + 1}. To‘lovni ochish`, callback_data: `admin_view_${p.id}` }]);
    const nav = [];
    if (queue.page > 1) nav.push({ text: "← Oldingi", callback_data: `admin_page_${queue.page - 1}` });
    if (queue.page < queue.totalPages) nav.push({ text: "Keyingi →", callback_data: `admin_page_${queue.page + 1}` });
    if (nav.length) inline_keyboard.push(nav);
    inline_keyboard.push([{ text: "🔄 Yangilash", callback_data: `admin_page_${queue.page}` }, { text: "🏠 Menyu", callback_data: "menu_main" }]);
    await respond(ctx, `${texts.adminPendingList(queue.total)}\n${queue.total ? `Sahifa ${queue.page} / ${queue.totalPages}\n\n${lines.join("\n\n")}` : `\n${texts.adminPendingEmpty}`}`, { parse_mode: "HTML", reply_markup: { inline_keyboard } });
  } catch { await ctx.reply(texts.genericError); }
}

export function adminPaymentDetail(payment: Payment) {
  const safe = (value: string | undefined | null, limit = 120) => escapeTelegramHtml((value || "—").slice(0, limit));
  const sender = payment.senderCardDetails;
  const state = payment.needsReconciliation ? "⚠️ Qo‘shimcha tekshirish kerak" : texts.paymentStatusLabel[payment.status] ?? payment.status;
  return `💳 <b>To‘lov tafsilotlari</b>\n\nHisob: <b>${safe(payment.telegramUsername || payment.telegramUserId, 60)}</b>\nTarif: ${payment.tier.toUpperCase()} · ${payment.durationMonths} oy\nSumma: <b>${formatSom(payment.amount)}</b>\nSana: ${formatDate(payment.createdAt)}\nHolat: ${state}\nID: <code>${safe(payment.id, 24)}</code>` +
    (sender ? `\nYuboruvchi: ${safe(sender.fullName, 60)}\nKarta: •••• ${safe(sender.cardNumber.replace(/\D/g, "").slice(-4))}` : "") +
    (payment.ocr?.extractedAmount != null ? `\nChekdagi summa: ${formatSom(payment.ocr.extractedAmount)}` : "") +
    (payment.rejectedReason ? `\nSabab: ${safe(payment.rejectedReason, 100)}` : "") +
    (payment.status === "provisioned" ? "\n⚠️ Eski avtomatik faollashtirish. Obunani alohida tekshiring." : "");
}

export async function handleAdminView(ctx: BotContext, paymentId: string) {
  await ackIfCallback(ctx);
  if (!isAdmin(ctx.from?.id)) { await ctx.reply(texts.notAdmin); return; }
  try {
    const payment = await api.getPayment(paymentId);
    if (payment.method !== "manual_card") { await ctx.reply("Bu to‘lov Click orqali boshqariladi."); return; }
    const actions = payment.status === "pending" ? keyboards.adminPaymentActions(paymentId).reply_markup.inline_keyboard : [];
    const options = { parse_mode: "HTML" as const, reply_markup: { inline_keyboard: [...actions, [{ text: "📋 To‘lovlar navbati", callback_data: "menu_admin" }]] } };
    if (payment.receiptFileId) {
      try { await ctx.replyWithPhoto(payment.receiptFileId, { caption: adminPaymentDetail(payment), ...options }); return; }
      catch { /* Receipt metadata remains reviewable if Telegram cannot load its photo. */ }
    }
    await respond(ctx, adminPaymentDetail(payment), options);
  } catch { await ctx.reply(texts.genericError); }
}
