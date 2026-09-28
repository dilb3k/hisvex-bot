import type { BotContext } from "../context";
import { texts, formatSom } from "../texts";
import { keyboards } from "../keyboards";
import { api } from "../../services/api-client";
import { env } from "../../config/env";
import { resolveLinkedUser } from "./menu";

export async function handlePhoto(ctx: BotContext) {
  const photos = (ctx.message as any)?.photo as Array<{ file_id: string }> | undefined;
  const fileId = photos?.[photos.length - 1]?.file_id; // largest size is last
  if (!fileId) return;

  let pending = ctx.session.awaitingReceiptFor;

  if (!pending) {
    // The in-memory session can be lost (process restart, Render free-tier
    // cold start) while the payment itself is safely persisted on the
    // backend. Rather than silently dropping the screenshot, re-derive which
    // payment it belongs to from the user's durable Hisvex link.
    try {
      const linked = await resolveLinkedUser(ctx);
      if (linked) {
        const payments = await api.getPaymentsByUser(linked.userId);
        const candidate = payments
          .filter((p) => p.status === "pending" && p.method === "manual_card" && !p.receiptFileId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (candidate) {
          pending = { paymentId: candidate.id, tier: candidate.tier, durationMonths: candidate.durationMonths };
        }
      }
    } catch (err) {
      console.error("handlePhoto fallback lookup failed", err);
      await ctx.reply(texts.genericError);
      return;
    }
  }

  if (!pending) {
    // Neither an in-memory nor a recoverable backend-side pending payment —
    // most likely the user never started (or already finished) a
    // manual-card payment, so there's nothing to attach this photo to.
    await ctx.reply(texts.noPendingReceipt, { parse_mode: "HTML", ...keyboards.backToMenu });
    return;
  }

  try {
    await api.attachReceipt(pending.paymentId, fileId);
    ctx.session.awaitingReceiptFor = undefined;

    await ctx.reply(texts.manualReceiptReceived, { parse_mode: "HTML" });

    // The receipt is already attached and the user has been told so above —
    // don't let a failure posting to the admin chat (wrong chat id, bot
    // kicked from it, etc.) surface as an error to the payer; the payment
    // still sits in the pending list an admin can review from /admin.
    try {
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
    } catch (notifyErr) {
      console.error(`Failed to post admin approval card for payment ${pending.paymentId}`, notifyErr);
    }
  } catch (err) {
    console.error("handlePhoto failed", err);
    await ctx.reply(texts.genericError);
  }
}
