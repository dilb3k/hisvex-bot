# Hisvex Bot

Telegram bot for Hisvex subscription plans: view your plan, buy/renew (Click
or manual card transfer), payment history, and automatic expiry reminders.
Calls `comp-bar-server`'s `/api/bot/*` and `/api/payments/click/*` endpoints
— it holds no database of its own.

## Architecture

```
Telegram user  <-->  hisvex-bot  <-->  comp-bar-server (/api/bot/*, X-Bot-Secret)
                                   \-->  Click (/api/payments/click/* webhook)
```

- **Manual card payment** works today, no merchant account needed: the bot
  shows a card number, the user transfers and sends a screenshot, an admin
  taps Approve/Reject in Telegram, the subscription activates immediately.
- **Click payment** is fully built but stays disabled until you register a
  Click Merchant account and set `CLICK_MERCHANT_ID`/`CLICK_SERVICE_ID`/
  `CLICK_SECRET_KEY` **on the backend** (not this repo — see below). The bot
  automatically shows/hides the Click button based on whether the backend
  reports it configured (`GET /api/bot/pricing` → `clickEnabled`).

## 1. Create the bot in Telegram

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` → follow the
   prompts (name, username must end in `bot`). You'll get a token like
   `123456789:AAF...` — this is `BOT_TOKEN`.
2. Optional but recommended: `/setdescription`, `/setabouttext`,
   `/setuserpic` to brand it.
3. Find your own numeric Telegram id by messaging
   [@userinfobot](https://t.me/userinfobot) — this is what goes in
   `ADMIN_TELEGRAM_IDS` / `ADMIN_APPROVAL_CHAT_ID`.
4. If you want payment receipts posted to a group instead of your DMs:
   create a Telegram group, add the bot to it, send any message, then check
   `https://api.telegram.org/bot<TOKEN>/getUpdates` for the group's
   (negative) chat id — that's `ADMIN_APPROVAL_CHAT_ID`.

## 2. Configure the backend

The bot never talks to MongoDB directly — everything goes through
`comp-bar-server`. On the backend, set (see
`comp-bar-server/.env.example`):

```
BOT_INTERNAL_SECRET=<a long random string, 32+ chars>
```

Generate one, e.g. `openssl rand -hex 32`. Use the **exact same value** for
`BOT_INTERNAL_SECRET` in this repo's `.env`. This is the shared secret the
bot presents (as an `X-Bot-Secret` header) to call `/api/bot/*` — those
routes refuse every request if this isn't set on the backend (fails
closed), so the bot integration is off by default until you set it there.

Redeploy/restart the backend after setting it.

## 3. Configure this bot

```bash
cp .env.example .env
```

Fill in:
- `BOT_TOKEN` — from step 1.
- `ADMIN_TELEGRAM_IDS` — comma-separated numeric ids allowed to
  approve/reject payments and see the admin menu.
- `ADMIN_APPROVAL_CHAT_ID` — where payment receipts get posted (from step 1).
- `BACKEND_URL` — e.g. `https://hisvex-api.onrender.com` (no trailing
  `/api`, the client adds that).
- `BOT_INTERNAL_SECRET` — must exactly match the backend's value from step 2.
- `CARD_NUMBER` / `CARD_HOLDER_NAME` — the card shown for manual transfers.
- `APP_DOWNLOAD_URL`, `SUPPORT_TELEGRAM_USERNAME`, `REMINDER_DAYS_BEFORE` —
  optional, sensible defaults are already in `.env.example`.

## 4. Run it

```bash
npm install
npm run dev      # local development, auto-reloads
# or
npm run build && npm start   # production
```

The bot uses long-polling (`bot.launch()`), not a webhook — no public URL
or port needs to be exposed for the bot itself. Deploy it anywhere that can
run a long-lived Node process (Render Background Worker, a small VPS,
etc.) — same platform as `comp-bar-server` is the simplest choice.

## 5. (Optional) Enable Click

Click is a licensed merchant integration — you need a real Click Business
account:

1. Register at [my.click.uz](https://my.click.uz) as a merchant (business
   registration, bank account verification — this is Click's own process,
   takes a few business days).
2. In the Click merchant cabinet, create a service and note down:
   `SERVICE_ID`, `MERCHANT_ID`, and generate a `SECRET_KEY`.
3. In the merchant cabinet, set the **Prepare URL** and **Complete URL** to:
   - Prepare: `https://<your-backend-domain>/api/payments/click/prepare`
   - Complete: `https://<your-backend-domain>/api/payments/click/complete`
4. Set on the **backend** (not this repo):
   ```
   CLICK_MERCHANT_ID=...
   CLICK_SERVICE_ID=...
   CLICK_SECRET_KEY=...
   ```
5. Redeploy the backend. The bot will automatically start showing the
   "⚡️ Click orqali" button — no bot-side changes or redeploy needed.

## What the bot does NOT do (by design)

- No database of its own — restarting it loses nothing except in-memory
  session state (which account is linked to which chat mid-conversation);
  a user just re-shares their phone number if that happens.
- No broadcast/marketing tools, no analytics — kept deliberately narrow to
  subscription + payment, per the brief ("aniq kerakli narsalar").
- Doesn't touch products/inventory/sales data — it only ever calls the
  `/api/bot/*` payment & subscription-status endpoints, nothing else in the
  main API.

## Repo layout

```
src/
  config/env.ts         zod-validated environment config
  services/api-client.ts   thin wrapper over comp-bar-server's /api/bot/*
  bot/
    bot.ts               wires up all commands/callback handlers
    context.ts           session shape
    texts.ts             all user-facing copy (Uzbek)
    keyboards.ts          inline keyboard builders
    handlers/
      start.ts            /start, phone-number linking
      menu.ts              main menu, "Mening hisobim"
      plans.ts             tier -> duration -> payment method selection
      receipt.ts           receives the manual-transfer screenshot
      admin.ts              Approve/Reject + pending list
      payments.ts           "To'lovlarim" (my payment history)
  cron/reminders.ts       daily expiry-reminder DM job
  index.ts                entry point
```
