import type { BotContext } from "../context";
import { texts, formatSom } from "../texts";
import { keyboards } from "../keyboards";
import { api, ApiError, type Payment } from "../../services/api-client";
import { env } from "../../config/env";
import { resolveLinkedUser } from "./menu";

type PendingReceipt = { paymentId: string; tier: Payment["tier"]; durationMonths: Payment["durationMonths"] };

// Finds the most recent payment this session could plausibly be waiting on
// (via either the screenshot or the card-details flow) when the in-memory
// session that would normally carry a paymentId was lost — process restart,
// Render free-tier cold start, etc. The payment survives on the backend
// even though the bot's in-memory session doesn't.
async function findRecoverablePayment(ctx: BotContext): Promise<Payment | null> {
  const linked = await resolveLinkedUser(ctx);
  if (!linked) return null;

  const payments = await api.getPaymentsByUser(linked.userId);

  // A payment that already has a screenshot attached (receiptFileId) or
  // senderCardDetails filled already went through one of the two intake
  // flows — it's waiting on an admin, not on more input from us, so it's
  // never a valid recovery target for either flow.
  const eligible = payments.filter(
    (p) => p.status === "pending" && p.method === "manual_card" && !p.receiptFileId && !p.senderCardDetails
  );

  eligible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return eligible[0] ?? null;
}

export async function handlePhoto(ctx: BotContext) {
  const photos = (ctx.message as any)?.photo as Array<{ file_id: string }> | undefined;
  const fileId = photos?.[photos.length - 1]?.file_id; // largest size is last
  if (!fileId) return;

  let pending: PendingReceipt | undefined = ctx.session.awaitingReceiptFor;

  if (!pending) {
    // The in-memory session can be lost while the payment itself is safely
    // persisted on the backend — recover which payment this screenshot
    // belongs to from the user's durable Hisvex link, rather than silently
    // dropping it.
    try {
      const candidate = await findRecoverablePayment(ctx);
      if (candidate) {
        pending = { paymentId: candidate.id, tier: candidate.tier, durationMonths: candidate.durationMonths };
      }
    } catch (err) {
      console.error("handlePhoto fallback lookup failed", err);
      await ctx.reply(texts.genericError);
      return;
    }
  }

  if (!pending) {
    // Neither an in-memory nor a recoverable backend-side pending payment —
    // most likely the user never started (or already finished, via either
    // flow) a manual-card payment, so there's nothing to attach this photo to.
    await ctx.reply(texts.noPendingReceipt, { parse_mode: "HTML", ...keyboards.backToMenu });
    return;
  }

  // OCR can take a few seconds, especially on a cold start — let the user
  // know right away so the bot doesn't look stuck.
  await ctx.reply(texts.receiptChecking);

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const fileRes = await fetch(fileLink);
    if (!fileRes.ok) throw new Error(`Failed to download receipt from Telegram (${fileRes.status})`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const { payment, provisioned } = await api.attachReceipt(pending.paymentId, fileId, {
      buffer,
      contentType: "image/jpeg",
    });
    ctx.session.awaitingReceiptFor = undefined;

    const resultText = (provisioned ? texts.receiptProvisioned : texts.manualReceiptReceived) + texts.nextStepHint;
    await ctx.reply(resultText, { parse_mode: "HTML", ...keyboards.paymentSubmittedActions(pending.paymentId) });

    // The receipt is already attached (and, if matched, the tier already
    // granted) and the user has been told so above — don't let a failure
    // posting to the admin chat (wrong chat id, bot kicked from it, etc.)
    // surface as an error to the payer; the payment still sits reviewable
    // from /admin.
    try {
      const { pricing } = await api.getPricing();
      const amount = pricing[pending.tier][String(pending.durationMonths)];

      // Forward the receipt photo itself, then post the decision card with
      // Approve/Reject buttons (and the OCR read-out, if any) right under
      // it in the admin chat.
      await ctx.telegram.sendPhoto(env.ADMIN_APPROVAL_CHAT_ID, fileId, {
        caption: texts.adminNewPaymentCaption({
          username: ctx.session.username ?? "—",
          telegramUsername: ctx.from?.username,
          tier: pending.tier,
          duration: pending.durationMonths,
          amount: formatSom(amount),
          paymentId: pending.paymentId,
          ocr: payment.ocr,
        }),
        parse_mode: "HTML",
        ...keyboards.adminPaymentActions(pending.paymentId),
      });
    } catch (notifyErr) {
      console.error(`Failed to post admin approval card for payment ${pending.paymentId}`, notifyErr);
    }
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 409) {
      await ctx.reply(texts.duplicateReceipt, { parse_mode: "HTML" });
      return;
    }
    console.error("handlePhoto failed", err);
    await ctx.reply(texts.genericError);
  }
}

// "❓ Skrinshot qila olmadim / Chek yo'q" — the screenshot-free fallback:
// switches this payment from waiting on a photo to waiting on a typed
// "<card number>, <full name>".
export async function handleNoReceipt(ctx: BotContext, paymentId: string) {
  await ctx.answerCbQuery();
  ctx.session.awaitingReceiptFor = undefined;
  ctx.session.awaitingCardInfoFor = paymentId;
  await ctx.reply(texts.askCardDetails, { parse_mode: "HTML" });
}

function parseCardDetails(text: string): { cardNumber: string; fullName: string } | null {
  const commaIndex = text.indexOf(",");
  if (commaIndex === -1) return null;

  const cardNumber = text.slice(0, commaIndex).trim();
  const fullName = text.slice(commaIndex + 1).trim();

  if (!/^[\d\s]{8,25}$/.test(cardNumber)) return null;
  if (fullName.length < 2 || fullName.length > 200) return null;

  return { cardNumber, fullName };
}

// Heuristic used only to recover a lost `awaitingCardInfoFor` session (see
// bot.ts's text middleware): cheap enough to run on every text message
// before bothering with a backend lookup, since most messages won't match.
export function looksLikeCardDetails(text: string): boolean {
  return parseCardDetails(text) !== null;
}

export async function handleCardDetailsText(ctx: BotContext, paymentId: string) {
  const text = (ctx.message as any)?.text as string | undefined;
  const parsed = text ? parseCardDetails(text) : null;
  if (!parsed) {
    await ctx.reply(texts.cardDetailsInvalid, { parse_mode: "HTML" });
    return;
  }

  try {
    const payment = await api.submitCardDetails(paymentId, parsed.cardNumber, parsed.fullName);
    ctx.session.awaitingCardInfoFor = undefined;

    await ctx.reply(texts.cardDetailsSubmitted + texts.nextStepHint, {
      parse_mode: "HTML",
      ...keyboards.paymentSubmittedActions(paymentId),
    });

    // Same reasoning as handlePhoto's admin-notify block: the submission
    // already succeeded and the user's been told, so a failure here
    // shouldn't surface to them.
    try {
      await ctx.telegram.sendMessage(
        env.ADMIN_APPROVAL_CHAT_ID,
        texts.adminCardDetailsCaption({
          username: ctx.session.username ?? "—",
          telegramUsername: ctx.from?.username,
          tier: payment.tier,
          duration: payment.durationMonths,
          amount: formatSom(payment.amount),
          paymentId: payment.id,
          cardNumber: parsed.cardNumber,
          fullName: parsed.fullName,
        }),
        { parse_mode: "HTML", ...keyboards.adminPaymentActions(payment.id) }
      );
    } catch (notifyErr) {
      console.error(`Failed to post admin card-details card for payment ${payment.id}`, notifyErr);
    }
  } catch (err) {
    console.error("handleCardDetailsText failed", err);
    await ctx.reply(texts.genericError);
  }
}

// Recovery counterpart to handleNoReceipt's session write, for a text
// message that looks like card details but arrived with no (or a stale)
// `awaitingCardInfoFor` — see findRecoverablePayment above.
export async function recoverCardDetailsPaymentId(ctx: BotContext): Promise<string | null> {
  try {
    const candidate = await findRecoverablePayment(ctx);
    return candidate?.id ?? null;
  } catch (err) {
    console.error("recoverCardDetailsPaymentId failed", err);
    return null;
  }
}
