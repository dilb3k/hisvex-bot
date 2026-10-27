import { processTezcheckEvent, verifyTezcheck } from '../services/tezcheck';
import type { RequestListener } from "node:http";

/** Handles requests rejected by Telegraf's webhook filter. */
export const webhookFallback: RequestListener = (req, res) => {
  const path=req.url?.split('?',1)[0];
  // Root is retained for the merchant endpoint already registered in TezCheck.
  if(req.method==='POST'&&(path==='/webhooks/tezcheck'||path==='/')){
    void (async()=>{
      try{
        const chunks:Buffer[]=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){res.writeHead(413);res.end();return;}chunks.push(Buffer.from(chunk));}
        const raw=Buffer.concat(chunks);
        if(!verifyTezcheck(raw,req.headers)){res.writeHead(401);res.end();return;}
        let event;try{event=JSON.parse(raw.toString('utf8'));}catch{res.writeHead(400);res.end();return;}
        await processTezcheckEvent(event);res.writeHead(200);res.end('{"ok":true}');
      }catch{console.error('TezCheck webhook processing failed');if(!res.headersSent)res.writeHead(503);res.end();}
    })();return;
  }
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
