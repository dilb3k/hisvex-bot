import type { RequestListener } from "node:http";

/** Handles requests rejected by Telegraf's webhook filter. */
export const webhookFallback: RequestListener = (req, res) => {
  if (req.url?.split("?", 1)[0] === "/health") {
    // Process liveness only: never call Telegram, the backend, or a database.
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end('{"status":"ok","service":"hisvex-bot"}');
    return;
  }

  // Preserve Telegraf's default rejection for every other non-webhook request.
  res.writeHead(403);
  res.end();
};
