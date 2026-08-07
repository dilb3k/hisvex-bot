import { env } from "./config/env";
import { createBot } from "./bot/bot";
import { startReminderCron } from "./cron/reminders";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

async function main() {
  const bot = createBot();

  startReminderCron(bot);

  await bot.launch();
  console.log(`hisvex-bot is running (backend: ${env.BACKEND_URL})`);

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

void main().catch((err) => {
  console.error("Failed to start bot", err);
  process.exit(1);
});
