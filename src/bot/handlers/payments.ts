import type { BotContext } from "../context";
import { texts, formatSom, DURATION_LABEL, TIER_LABEL } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { requireLinked } from "./menu";

export async function handleMenuPayments(ctx: BotContext) {
  await ctx.answerCbQuery();
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const payments = await api.getPaymentsByUser(userId);
    if (payments.length === 0) {
      await ctx.editMessageText(`${texts.myPaymentsTitle}\n\n${texts.myPaymentsEmpty}`, {
        parse_mode: "HTML",
        ...keyboards.backToMenu,
      });
      return;
    }

    const lines = payments
      .map((p) => {
        const status = texts.paymentStatusLabel[p.status] ?? p.status;
        return `${status} — <b>${TIER_LABEL[p.tier]}</b> / ${DURATION_LABEL[p.durationMonths]} — ${formatSom(p.amount)}`;
      })
      .join("\n");

    await ctx.editMessageText(`${texts.myPaymentsTitle}\n\n${lines}`, {
      parse_mode: "HTML",
      ...keyboards.backToMenu,
    });
  } catch (err) {
    console.error("handleMenuPayments failed", err);
    await ctx.reply(texts.genericError);
  }
}
