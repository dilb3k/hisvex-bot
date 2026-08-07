import type { ExtraEditMessageText, ExtraReplyMessage } from "telegraf/typings/telegram-types";

import type { BotContext } from "./context";

// Every menu section is reachable two ways now: an inline-keyboard tap
// (a callback query, editing the existing message) and a persistent
// reply-keyboard tap (a plain text message, which has nothing to edit —
// it needs a fresh reply). Handlers call `respond` instead of choosing
// between editMessageText/reply themselves, so the same function serves
// both entry points.
export async function respond(
  ctx: BotContext,
  text: string,
  extra?: ExtraEditMessageText & ExtraReplyMessage
) {
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch {
      // Editing can fail (e.g. message too old, or content unchanged) —
      // fall back to a fresh reply so the user still gets an answer.
      return ctx.reply(text, extra);
    }
  }
  return ctx.reply(text, extra);
}

// answerCbQuery() throws when there is no callback query to answer (i.e.
// when a handler was triggered by a reply-keyboard text message instead
// of an inline button tap) — guard it so handlers can stay callback- and
// text-triggerable without branching every time.
export async function ackIfCallback(ctx: BotContext) {
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery();
  }
}
