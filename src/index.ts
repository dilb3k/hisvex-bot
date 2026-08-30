import { createHash } from "node:crypto";

import { env } from "./config/env";
import { createBot } from "./bot/bot";
import { startReminderCron } from "./cron/reminders";

/**
 * Secret path Telegram posts updates to.
 *
 * Derived from the bot token rather than hardcoded: the path is the only
 * thing standing between the endpoint and anyone who wants to post forged
 * updates, so a constant like "/webhook" would let a stranger impersonate
 * Telegram. Deriving it keeps it stable across restarts — which matters,
 * because a path that changed on every deploy would silently stop delivering
 * until setWebhook ran again.
 */
const webhookPath = () =>
  env.WEBHOOK_PATH ??
  `/tg/${createHash("sha256").update(env.BOT_TOKEN).digest("hex").slice(0, 32)}`;

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

async function main() {
  const bot = createBot();

  startReminderCron(bot);

  if (env.WEBHOOK_URL) {
    const path = webhookPath();
    // launch() resolves only once Telegram has accepted the webhook, so a
    // bad domain fails the deploy here rather than looking healthy while
    // silently receiving nothing.
    await bot.launch({
      webhook: {
        domain: env.WEBHOOK_URL,
        hookPath: path,
        port: env.PORT,
      },
    });
    console.log(
      `hisvex-bot webhook rejimida (port ${env.PORT}, backend: ${env.BACKEND_URL})`
    );
  } else {
    await bot.launch();
    console.log(`hisvex-bot polling rejimida (backend: ${env.BACKEND_URL})`);
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

void main().catch((err) => {
  console.error("Failed to start bot", err);
  process.exit(1);
});
