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
