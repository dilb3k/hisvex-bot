import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  BOT_TOKEN: z.string().trim().min(1, "BOT_TOKEN is required — get one from @BotFather"),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .trim()
    .default("")
    .transform((v) => v.split(",").map((id) => id.trim()).filter(Boolean)),
  ADMIN_APPROVAL_CHAT_ID: z.string().trim().min(1, "ADMIN_APPROVAL_CHAT_ID is required"),
  BACKEND_URL: z.string().trim().url(),
  BOT_INTERNAL_SECRET: z.string().trim().min(16, "BOT_INTERNAL_SECRET must match the backend's value"),
  CARD_NUMBER: z.string().trim().min(1),
  CARD_HOLDER_NAME: z.string().trim().min(1),
  APP_DOWNLOAD_URL: z.string().trim().url().default("https://hisvex-web.vercel.app"),
  SUPPORT_TELEGRAM_USERNAME: z.string().trim().default("dilbek7011"),
  REMINDER_DAYS_BEFORE: z.coerce.number().int().positive().default(3),

  // Set to this service's own public URL to run in webhook mode; leave unset
  // for long polling.
  //
  // Long polling needs a process that is always running, which on Render is
  // a Worker — and Workers are not part of the free tier, which is what the
  // $7/month invoice was for. In webhook mode the bot is an ordinary web
  // service: Telegram POSTs each update to it, so it qualifies for the free
  // plan. Local development leaves this unset and keeps polling, which needs
  // no public URL.
  WEBHOOK_URL: z.string().trim().url().optional(),

  // Telegram will only deliver to the path it was told about, but the path is
  // still effectively a shared secret — anyone who can guess it can post
  // fake updates. Defaults to a value derived from the bot token so it is
  // never a predictable constant.
  WEBHOOK_PATH: z.string().trim().optional(),

  // Render provides this. The webhook server has to bind it or the deploy is
  // marked failed for not opening a port.
  PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

if (parsed.data.ADMIN_TELEGRAM_IDS.length === 0) {
  console.warn(
    "ADMIN_TELEGRAM_IDS is empty — nobody will be able to approve/reject manual card payments or see the admin menu."
  );
}

export const env = parsed.data;
