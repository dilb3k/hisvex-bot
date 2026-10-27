// Based on the TezCheck merchant documentation supplied 2026-10-27. Fictional data only.
const http=require('node:http'),crypto=require('node:crypto');
http.createServer(async(req,res)=>{
 const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??{});
 const expected=crypto.createHmac('sha256','test-key').update(`${req.headers['x-tezcheck-timestamp']}.${req.method}./merchant${req.url}.${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
 if(req.headers.authorization!=='Bearer test-key'||req.headers['x-cash-desk-code']!=='test-desk'||req.headers['x-tezcheck-signature']!=='v1='+expected){res.writeHead(401);return res.end('{}');}
 if(req.url==='/bills/link_failure'){res.writeHead(503,{'Content-Type':'text/html'});return res.end('<h1>Unavailable</h1>');}
 if(req.method!=='POST'||req.url!=='/bills/link_test'){res.writeHead(501);return res.end('{}');}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{bill:{id:'link_test',external_reference:'abcdef123456abcdef123456',amount_minor:10000000,currency:'UZS',paid:true,environment:'live',livemode:true},payment:{id:'pay_test',amount_minor:10000000,fee_minor:100000,net_minor:9900000,refunded_amount_minor:0,currency:'UZS',state:'succeeded',environment:'live',livemode:true}}}));
}).listen(process.env.PORT||4500);
