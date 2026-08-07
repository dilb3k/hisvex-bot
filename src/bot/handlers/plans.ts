import type { BotContext } from "../context";
import { texts, formatSom } from "../texts";
import { keyboards } from "../keyboards";
import { api, type PlanDuration, type PlanTier } from "../../services/api-client";
import { requireLinked } from "./menu";
import { respond, ackIfCallback } from "../respond";

export async function handleMenuBuy(ctx: BotContext) {
  await ackIfCallback(ctx);
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const { features } = await api.getPricing();
    const body =
      `${texts.choosePlan}\n\n` +
      `<b>Bor</b>\n${texts.planFeatures(features.bor)}\n\n` +
      `<b>Pro ⭐️</b>\n${texts.planFeatures(features.pro)}`;
    await respond(ctx, body, { parse_mode: "HTML", ...keyboards.choosePlan });
  } catch (err) {
    console.error("handleMenuBuy failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleChooseTier(ctx: BotContext, tier: PlanTier) {
  await ackIfCallback(ctx);
  await respond(ctx, texts.chooseDuration(tier), {
    parse_mode: "HTML",
    ...keyboards.chooseDuration(tier),
  });
}

export async function handleChooseDuration(ctx: BotContext, tier: PlanTier, duration: PlanDuration) {
  await ackIfCallback(ctx);
  try {
    const { pricing, clickEnabled } = await api.getPricing();
    const amount = pricing[tier][String(duration)];
    await respond(ctx, texts.chooseMethod(tier, duration, formatSom(amount)), {
      parse_mode: "HTML",
      ...keyboards.chooseMethod(tier, duration, clickEnabled),
    });
  } catch (err) {
    console.error("handleChooseDuration failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handlePayManual(ctx: BotContext, tier: PlanTier, duration: PlanDuration) {
  await ctx.answerCbQuery();
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const { pricing } = await api.getPricing();
    const amount = pricing[tier][String(duration)];

    const payment = await api.createManualPayment({
      userId,
      telegramUserId: String(ctx.from!.id),
      telegramUsername: ctx.from?.username,
      tier,
      durationMonths: duration,
    });

    ctx.session.awaitingReceiptFor = { paymentId: payment.id, tier, durationMonths: duration };

    await ctx.editMessageText(texts.manualCardInstructions(formatSom(amount)), { parse_mode: "HTML" });
  } catch (err) {
    console.error("handlePayManual failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handlePayClick(ctx: BotContext, tier: PlanTier, duration: PlanDuration) {
  await ctx.answerCbQuery();
  const userId = await requireLinked(ctx);
  if (!userId) return;

  try {
    const { payUrl } = await api.createClickPending({
      userId,
      telegramUserId: String(ctx.from!.id),
      telegramUsername: ctx.from?.username,
      tier,
      durationMonths: duration,
    });
    await ctx.editMessageText("⚡️ Click orqali to'lash uchun quyidagi tugmani bosing:", keyboards.clickPayLink(payUrl));
  } catch (err) {
    console.error("handlePayClick failed", err);
    await ctx.reply(texts.clickNotReady);
  }
}
