import type { BotContext } from "../context";
import { texts, formatSom } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";

export async function handlePhoto(ctx: BotContext) {
  const pending = ctx.session.awaitingReceiptFor;
  if (!pending) return; // not in the middle of a manual-payment flow — ignore, don't spam an error

  const photos = (ctx.message as any)?.photo as Array<{ file_id: string }> | undefined;
  const fileId = photos?.[photos.length - 1]?.file_id; // largest size is last
  if (!fileId) return;

  try {
    await api.attachReceipt(pending.paymentId, fileId);
    ctx.session.awaitingReceiptFor = undefined;

    await ctx.reply(texts.manualReceiptReceived, { parse_mode: "HTML" });

    const { pricing } = await api.getPricing();
    const amount = pricing[pending.tier][String(pending.durationMonths)];

    // Forward the receipt photo itself, then post the decision card with
    // Approve/Reject buttons right under it in the admin chat.
    await ctx.telegram.sendPhoto(env.ADMIN_APPROVAL_CHAT_ID, fileId, {
      caption: texts.adminNewPaymentCaption({
        username: ctx.session.username ?? "—",
        telegramUsername: ctx.from?.username,
        tier: pending.tier,
        duration: pending.durationMonths,
        amount: formatSom(amount),
        paymentId: pending.paymentId,
      }),
      parse_mode: "HTML",
      ...keyboards.adminPaymentActions(pending.paymentId),
    });
  } catch (err) {
    console.error("handlePhoto failed", err);
    await ctx.reply(texts.genericError);
  }
}
