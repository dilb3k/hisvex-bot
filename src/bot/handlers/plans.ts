import { createTezcheckCheckout, tezcheckEnabled } from '../../services/tezcheck';
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
    const { features, pricing } = await api.getPricing();
    const body =
      `${texts.choosePlan}\n\n` +
      `${texts.planDivider}\n` +
      `<b>💼 Bor</b>\n${texts.planFeatures(features.bor)}\n\n${texts.planPricing(pricing.bor)}\n` +
      `${texts.planDivider}\n` +
      `<b>⭐️ Pro</b>\n${texts.planFeatures(features.pro)}\n\n${texts.planPricing(pricing.pro)}\n` +
      `${texts.planDivider}\n\n` +
      texts.choosePlanFooter;
    // A new purchase needs a new message identity; retries within it keep the same order key.
    await ctx.reply(body, { parse_mode: "HTML", ...keyboards.choosePlan });
  } catch (err) {
    console.error("handleMenuBuy failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleChooseTier(ctx: BotContext, tier: PlanTier) {
  await ackIfCallback(ctx);
  try {
    const { pricing } = await api.getPricing();
    await respond(ctx, texts.chooseDuration(tier), {
      parse_mode: "HTML",
      ...keyboards.chooseDuration(tier, pricing[tier]),
    });
  } catch (err) {
    console.error("handleChooseTier failed", err);
    await ctx.reply(texts.genericError);
  }
}

export async function handleChooseDuration(ctx: BotContext, tier: PlanTier, duration: PlanDuration) {
  await ackIfCallback(ctx);
  try {
    const { pricing, clickEnabled } = await api.getPricing();
    const amount = pricing[tier][String(duration)];
    await respond(ctx, texts.chooseMethod(tier, duration, formatSom(amount)), {
      parse_mode: "HTML",
      ...keyboards.chooseMethod(tier, duration, clickEnabled, tezcheckEnabled()),
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
    ctx.session.awaitingCardInfoFor = undefined;

    await ctx.editMessageText(texts.manualCardInstructions(formatSom(amount)), {
      parse_mode: "HTML",
      ...keyboards.manualCardActions(payment.id),
    });
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

export async function handlePayTezcheck(ctx:BotContext,tier:PlanTier,duration:PlanDuration){
 await ctx.answerCbQuery();const userId=await requireLinked(ctx);if(!userId)return;
 try{
  const messageId=ctx.callbackQuery?.message?.message_id;
  if(!messageId)throw new Error('Missing order message');
  const {payment,payUrl}=await createTezcheckCheckout({userId,telegramUserId:String(ctx.from!.id),telegramUsername:ctx.from?.username,tier,durationMonths:duration,requestKey:`${ctx.chat!.id}:${messageId}:${tier}:${duration}`});
  ctx.session.awaitingReceiptFor=undefined;ctx.session.awaitingCardInfoFor=undefined;
  await respond(ctx,payUrl?`💳 Hisvex ${tier.toUpperCase()} — ${duration} oy\nSumma: ${formatSom(payment.amount)}\n\nTo‘lov tugagach obunangiz avtomatik faollashadi. Holatni quyidagi tugma bilan tekshirishingiz mumkin.`:'✅ Ushbu to‘lov tasdiqlangan. Obunangiz faol.',payUrl?keyboards.tezcheckPayLink(payUrl,payment.id):keyboards.backToMenu);
 }catch{console.error('TezCheck checkout failed');await ctx.reply('To‘lov havolasini hozir olish imkoni bo‘lmadi. Shu tugmani qayta bosing. Muammo davom etsa, xaridni menyudan qayta boshlang.');}
}
