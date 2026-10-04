import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Markup } from "telegraf";
import type { BotContext, SessionData } from "../context";
import { api, ApiError } from "../../services/api-client";
import { texts } from "../texts";
import { keyboards } from "../keyboards";
import { ackIfCallback } from "../respond";
import { isAdmin } from "./menu";

type Reset = NonNullable<SessionData["passwordReset"]>;

async function finish(ctx: BotContext, text: string) {
  ctx.session.passwordReset = undefined;
  await ctx.reply(text, keyboards.persistentMenu(isAdmin(ctx.from?.id)));
}

async function prompt(ctx: BotContext, state: Reset, stage: "new" | "confirm") {
  const sent = await ctx.reply(stage === "new" ? texts.passwordResetNew : texts.passwordResetConfirm, Markup.forceReply());
  state.promptMessageId = sent.message_id;
  state.stage = stage;
}

function digest(password: string, key: string) {
  return createHmac("sha256", Buffer.from(key, "hex")).update(password).digest();
}

// Recognize our own password prompts after a restart too: a numeric
// password must never fall into phone or payment parsing.
function replyingToPassword(ctx: BotContext) {
  const message = ctx.message;
  if (!message || !("reply_to_message" in message)) return false;
  const original = message.reply_to_message;
  return original?.from?.id === ctx.botInfo.id && "text" in original &&
    (original.text === texts.passwordResetNew || original.text === texts.passwordResetConfirm);
}

async function eraseEntry(ctx: BotContext, abortFlow = true) {
  try {
    await ctx.deleteMessage();
    return true;
  } catch {
    // Abort if Telegram could not remove the password from the chat.
    if (abortFlow) await finish(ctx, texts.passwordResetDeleteFailed);
    else await ctx.reply(texts.passwordResetDeleteWarning);
    return false;
  }
}

export async function handlePasswordReset(ctx: BotContext) {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  await ackIfCallback(ctx);
  if (ctx.session.passwordReset?.stage === "busy") {
    await ctx.reply(texts.passwordResetBusy);
    return;
  }
  ctx.session.awaitingCardInfoFor = undefined;
  ctx.session.awaitingReceiptFor = undefined;
  const state: Reset = { senderId: String(ctx.from.id), stage: "busy", expiresAt: Date.now() + 600000 };
  ctx.session.passwordReset = state;
  try {
    // Durable Telegram ownership, never a cached userId or a typed phone.
    const result = await api.requestPasswordReset(state.senderId);
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.token) || !Number.isFinite(Date.parse(result.expiresAt))) throw Error("Invalid reset proof");
    state.token = result.token;
    state.expiresAt = Date.parse(result.expiresAt);
    await prompt(ctx, state, "new");
  } catch (error) {
    ctx.session.passwordReset = undefined;
    if (error instanceof ApiError && error.statusCode === 404) {
      await ctx.reply(texts.passwordResetNotLinked, keyboards.requestPhone);
    } else if (error instanceof ApiError && error.statusCode === 429) {
      await finish(ctx, texts.passwordResetWait);
    } else {
      await finish(ctx, texts.genericError);
    }
  }
}

export async function handleCancelPasswordReset(ctx: BotContext) {
  if (ctx.chat?.type !== "private") return;
  await finish(ctx, texts.passwordResetCancelled);
}

// Runs immediately after session(), before commands, contacts, receipts
// and phone parsing. Password messages are handled only by this flow.
export async function passwordResetMiddleware(ctx: BotContext, next: () => Promise<void>) {
  if (ctx.chat?.type !== "private" || !ctx.from) return next();
  const state = ctx.session.passwordReset;
  const passwordReply = replyingToPassword(ctx);
  if (!state && !passwordReply) return next();
  const message = ctx.message;
  const text = message && "text" in message ? message.text : undefined;
  const navigation = !!text && (/^\/(start|help|cancel|reset_password)(?:@\w+)?(?:\s|$)/.test(text) || Object.values(texts.menuButtons).includes(text));
  // Telegram can redeliver an update whose response was lost. Its password
  // message has already been removed; do not delete/consume it a second time.
  if (state && text !== undefined && !navigation && message!.message_id <= (state.lastEntryMessageId ?? 0)) return;

  // Claim state synchronously: duplicate updates cannot replace a running
  // submission. Concurrent password-bearing messages are deleted as well.
  if (state?.stage === "busy") {
    if (text !== undefined && !navigation) {
      state.lastEntryMessageId = message!.message_id;
      await eraseEntry(ctx, false);
    }
    await ackIfCallback(ctx);
    await ctx.reply(texts.passwordResetBusy);
    return;
  }
  if (ctx.callbackQuery || navigation) {
    ctx.session.passwordReset = undefined;
    return next();
  }
  if (text === undefined) {
    await ctx.reply(texts.passwordResetTextOnly);
    return;
  }

  const stage = state?.stage;
  if (state) {
    state.stage = "busy";
    state.lastEntryMessageId = message!.message_id;
  }
  try {
    if (!await eraseEntry(ctx)) return;
    if (!state?.token || state.senderId !== String(ctx.from.id) || Date.now() >= state.expiresAt) {
      await finish(ctx, texts.passwordResetExpired);
      return;
    }
    // Delayed replies to an older prompt cannot confirm a different entry.
    // Fresh text sent without a reply is accepted too.
    const reply = "reply_to_message" in message! ? message.reply_to_message : undefined;
    if ((reply && reply.message_id !== state.promptMessageId) || message!.message_id <= (state.promptMessageId ?? 0)) {
      await prompt(ctx, state, stage === "confirm" ? "confirm" : "new");
      return;
    }
    if (text.length < 6 || Buffer.byteLength(text, "utf8") > 72) {
      await ctx.reply(texts.passwordResetInvalid);
      await prompt(ctx, state, stage === "confirm" ? "confirm" : "new");
      return;
    }
    if (stage === "new") {
      state.digestKey = randomBytes(32).toString("hex");
      state.passwordDigest = digest(text, state.digestKey).toString("hex");
      await prompt(ctx, state, "confirm");
      return;
    }
    if (!state.digestKey || !state.passwordDigest || !timingSafeEqual(digest(text, state.digestKey), Buffer.from(state.passwordDigest, "hex"))) {
      await ctx.reply(texts.passwordResetMismatch);
      await prompt(ctx, state, "confirm");
      return;
    }
    const result = await api.confirmPasswordReset(String(ctx.from.id), state.token, text);
    await finish(ctx, result.reset ? texts.passwordResetSuccess : texts.genericError);
  } catch (error) {
    // HTTP errors may contain the password request body. Never log them.
    await finish(ctx, error instanceof ApiError && error.statusCode === 400 ? texts.passwordResetExpired : texts.genericError);
  }
}
