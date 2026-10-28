import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { api, type Payment } from './api-client';

const signedTimes=new Map<string,number>();
export const tezcheckEnabled=()=>Boolean(env.TEZCHECK_API_KEY&&env.TEZCHECK_CASH_DESK_CODE&&env.TEZCHECK_WEBHOOK_SECRET&&env.TEZCHECK_CASH_DESK_ID&&env.TEZCHECK_ORGANIZATION_ID);
export async function tezcheckRequest(path:string,body?:unknown){
 if(!tezcheckEnabled())throw new Error('TezCheck is not configured');
 const raw=body===undefined?'':JSON.stringify(body),method=body===undefined?'GET':'POST';
 const url=new URL(env.TEZCHECK_API_URL+path);
 const now=Math.floor(Date.now()/1000),nonceKey=method+path+raw;
 for(const [key,time] of signedTimes)if(time<now-300)signedTimes.delete(key);
 const next=Math.max(now,(signedTimes.get(nonceKey)??0)+1);
 if(next>now+290)throw new Error('Too many repeated payment requests');
 signedTimes.set(nonceKey,next);const timestamp=String(next);
 const signature=createHmac('sha256',env.TEZCHECK_API_KEY!).update(`${timestamp}.${method}.${url.pathname+url.search}.${createHash('sha256').update(raw).digest('hex')}`).digest('hex');
 const response=await fetch(url,{method,headers:{Authorization:`Bearer ${env.TEZCHECK_API_KEY}`,'X-Cash-Desk-Code':env.TEZCHECK_CASH_DESK_CODE!,'Content-Type':'application/json','X-TezCheck-Timestamp':timestamp,'X-TezCheck-Signature':`v1=${signature}`,...(path==='/bills'?{'Idempotency-Key':`hisvex-${(body as any).external_reference}`}:{})},...(body===undefined?{}:{body:raw}),signal:AbortSignal.timeout(4000)});
 const json:any=await response.json().catch(()=>null);
 if(!response.ok||!json?.data)throw new Error(`TezCheck request failed (${response.status})`);
 return json.data;
}
export function verifyTezcheck(raw:Buffer,headers:Record<string,string|string[]|undefined>,now=Date.now()):boolean{
 const timestamp=headers['x-checkout-timestamp'],delivery=headers['x-checkout-delivery'],signature=headers['x-checkout-signature'];
 if(!env.TEZCHECK_WEBHOOK_SECRET||typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||typeof delivery!=='string'||!delivery||delivery.length>200||typeof signature!=='string')return false;
 const expected=createHmac('sha256',env.TEZCHECK_WEBHOOK_SECRET).update(`${timestamp}.${delivery}.`).update(raw).digest();
 return signature.split(',').some(s=>{const m=/^v1=([a-f\d]{64})$/i.exec(s.trim());return Boolean(m&&timingSafeEqual(expected,Buffer.from(m[1],'hex')));});
}
export async function createTezcheckCheckout(input:Parameters<typeof api.createTezcheckPending>[0]){
 let payment=await api.createTezcheckPending(input);
 if(payment.status==='completed')return {payment,payUrl:null};
 if(payment.status!=='pending'||payment.needsReconciliation)throw new Error('Order needs review');
 if(payment.tezcheckPayUrl)return {payment,payUrl:payment.tezcheckPayUrl};
 // Provider idempotency expires after 24h: never recreate an ambiguous old bill.
 if(Date.now()-Date.parse(payment.createdAt)>23*3600000)throw new Error('Order expired; start a new purchase');
 const data=await tezcheckRequest('/bills',{amount_minor:Math.round(payment.amount*100),title:`Hisvex ${payment.tier.toUpperCase()} — ${payment.durationMonths} oy`,external_reference:payment.id,return_url:'https://t.me/hisvex_bot'});
 if(data.bill?.external_reference!==payment.id||data.bill?.amount_minor!==Math.round(payment.amount*100)||data.bill?.currency!=='UZS')throw new Error('Bill identity mismatch');
 payment=await api.bindTezcheckBill(payment.id,{telegramUserId:input.telegramUserId,billId:data.bill.id,payUrl:data.payment_url});
 return {payment,payUrl:payment.status==='completed'?null:payment.tezcheckPayUrl!};
}
export async function reconcileTezcheck(payment:Payment,billId=payment.tezcheckBillId,eventId?:string){
 if(payment.method!=='tezcheck'||!billId||!/^link_[\w-]+$/.test(billId))return payment;
 const data=await tezcheckRequest(`/bills/${billId}`,{}),bill=data.bill,paid=data.payment;
 if(bill?.id!==billId||bill.external_reference!==payment.id||bill.amount_minor!==Math.round(payment.amount*100)||bill.currency!=='UZS')throw new Error('Bill identity mismatch');
 if(!paid)return payment;
 if(paid.environment!=='live'||paid.livemode!==true||bill.environment!=='live'||bill.livemode!==true)return payment;
 if(!['succeeded','partially_refunded','refunded','disputed','charged_back'].includes(paid.state))return payment;
 if(paid.state==='succeeded'&&bill.paid!==true)return payment;
 return api.settleTezcheck(payment.id,{billId,paymentId:paid.id,eventId,amountMinor:paid.amount_minor,netMinor:paid.net_minor,feeMinor:paid.fee_minor,refundedMinor:paid.refunded_amount_minor,currency:paid.currency,environment:paid.environment,state:paid.state});
}
export async function processTezcheckEvent(event:any){
 if(event?.schema_version!==1||typeof event.id!=='string'||!/^oev_[\w-]+$/.test(event.id)||typeof event.type!=='string'||!event.type.startsWith('payment.')||!event.data)throw new Error('Malformed event');
 if(String(event.cash_desk_id)!==env.TEZCHECK_CASH_DESK_ID||String(event.data.cash_desk_public_id)!==env.TEZCHECK_CASH_DESK_ID||String(event.organization_id)!==env.TEZCHECK_ORGANIZATION_ID)throw new Error('Wrong merchant');
 if(event.data.environment!=='live')return;
 const id=event.data.external_reference;if(typeof id!=='string'||!/^[a-f\d]{24}$/i.test(id))return;
 const payment=await api.getTezcheckPayment(id);
 if(payment.method!=='tezcheck')throw new Error('Wrong payment method');
 if(payment.tezcheckBillId&&payment.tezcheckBillId!==event.data.bill_id)throw new Error('Wrong bill');
 await reconcileTezcheck(payment,event.data.bill_id,event.id);
}
