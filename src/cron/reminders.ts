import cron from "node-cron";
import type { Telegraf } from "telegraf";

import { env } from "../config/env";
import { api } from "../services/api-client";
import { texts, TIER_LABEL, formatDate, daysLeft } from "../bot/texts";
import type { BotContext } from "../bot/context";

// Once a day: DM anyone whose subscription expires within
// REMINDER_DAYS_BEFORE days. Nothing notified users of this before — a
// subscription could lapse with zero warning.
export function startReminderCron(bot: Telegraf<BotContext>) {
  cron.schedule("0 9 * * *", () => {
    void runReminders(bot);
  });
}

export async function runReminders(bot: Telegraf<BotContext>) {
  try {
    const expiring = await api.getExpiringSoon(env.REMINDER_DAYS_BEFORE);
    for (const sub of expiring) {
      const left = daysLeft(sub.subscriptionEndDate);
      if (left === null) continue;
      try {
        await bot.telegram.sendMessage(
          sub.telegramId,
          texts.reminderMessage(TIER_LABEL[sub.tier], formatDate(sub.subscriptionEndDate), left),
          { parse_mode: "HTML" }
        );
      } catch (err) {
        // A user may have blocked the bot — don't let one failed DM stop
        // the rest of the batch.
        console.error(`Failed to send reminder to ${sub.telegramId}`, err);
      }
    }
    console.log(`Reminder cron: sent ${expiring.length} reminder(s)`);
  } catch (err) {
    console.error("runReminders failed", err);
  }
}
