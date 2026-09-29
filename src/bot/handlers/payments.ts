import type { BotContext } from "../context";
import { texts, formatSom, formatDate, DURATION_LABEL, TIER_LABEL } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { requireLinked } from "./menu";
import { respond, ackIfCallback } from "../respond";

export async function handleMenuPayments(ctx: BotContext) {
  await ackIfCallback(ctx);
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    // The backend already returns these newest-first (sorted by createdAt
    // descending) — nothing to re-sort here.
    const payments = await api.getPaymentsByUser(userId);
    if (payments.length === 0) {
      await respond(ctx, `${texts.myPaymentsTitle}\n\n${texts.myPaymentsEmpty}`, {
        parse_mode: "HTML",
        ...keyboards.backToMenu,
      });
      return;
    }

    const lines = payments
      .map((p) => {
        const status = texts.paymentStatusLabel[p.status] ?? p.status;
        let line =
          `${status} — <b>${TIER_LABEL[p.tier]}</b> / ${DURATION_LABEL[p.durationMonths]} — ` +
          `${formatSom(p.amount)} — ${formatDate(p.createdAt)}`;
        if (p.status === "rejected" && p.rejectedReason) {
          line += `\n    <i>Sabab: ${p.rejectedReason}</i>`;
        }
        return line;
      })
      .join("\n");

    await respond(ctx, `${texts.myPaymentsTitle}\n\n${lines}`, {
      parse_mode: "HTML",
      ...keyboards.backToMenu,
    });
  } catch (err) {
    console.error("handleMenuPayments failed", err);
    await ctx.reply(texts.genericError);
  }
}

// "🔄 Holatni tekshirish" on a submission confirmation — lets the user pull
// the current status without waiting on an admin DM.
export async function handleCheckPaymentStatus(ctx: BotContext, paymentId: string) {
  await ctx.answerCbQuery();

  try {
    const payment = await api.getPayment(paymentId);

    // Defense in depth: callback_data carries a raw paymentId, so confirm
    // whoever tapped this button is the Telegram user the payment actually
    // belongs to before showing anything about it.
    if (String(ctx.from?.id) !== payment.telegramUserId) {
      await ctx.reply(texts.genericError);
      return;
    }

    await ctx.reply(texts.checkStatusResult(payment), { parse_mode: "HTML", ...keyboards.backToMenu });
  } catch (err) {
    console.error("handleCheckPaymentStatus failed", err);
    await ctx.reply(texts.genericError);
  }
}
