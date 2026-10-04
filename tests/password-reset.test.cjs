const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks,globals={}) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>mocks[name]??require(name),Buffer,...globals}); return exports;
}
class ApiError extends Error {constructor(statusCode){super('internal diagnostic must not reach chat');this.statusCode=statusCode;}}
const {texts}=load('src/bot/texts.ts',{'../config/env':{env:{}}});
function harness(work=async()=>({token:'A'.repeat(43),expiresAt:new Date(Date.now()+600000).toISOString()}),confirm=async()=>({reset:true})) {
 const requests=[], confirmations=[], replies=[], acks=[], deletions=[], logs=[];
 let messageId=0;
 const handlers=load('src/bot/handlers/password-reset.ts',{
  '../../services/api-client':{ApiError,api:{requestPasswordReset:async id=>{requests.push(id);return work();},confirmPasswordReset:async(...args)=>{confirmations.push(args);return confirm();}}},
  '../texts':{texts},'./menu':{isAdmin:()=>false},
  '../keyboards':{keyboards:{requestPhone:{reply_markup:{keyboard:[]}},persistentMenu:()=>({reply_markup:{keyboard:[['menu']]}})}},
  '../respond':{ackIfCallback:async ctx=>acks.push(ctx)},
 },{console:{error:(...args)=>logs.push(args)}});
 const ctx={from:{id:123},chat:{type:'private'},botInfo:{id:987,is_bot:true},session:{userId:'stale-other-account',awaitingCardInfoFor:'payment',awaitingReceiptFor:{paymentId:'old-payment'}},
  reply:async(...args)=>{replies.push(args);return {message_id:++messageId};},
  deleteMessage:async function(){deletions.push(this.message.message_id);return true;}};
 function entry(text,options={}) {
  const promptId=ctx.session.passwordReset?.promptMessageId;
  const promptText=ctx.session.passwordReset?.stage==='confirm'?texts.passwordResetConfirm:texts.passwordResetNew;
  return {...ctx,message:{message_id:++messageId,text,...(promptId?{reply_to_message:{message_id:promptId,from:{id:987},text:promptText}}:{}),...options}};
 }
 let fallthrough=0;
 const send=async(text,options)=>handlers.passwordResetMiddleware(entry(text,options),async()=>{fallthrough++;});
 return {...handlers,ctx,requests,confirmations,replies,acks,deletions,logs,entry,send,fallthrough:()=>fallthrough};
}
test('reset uses the private sender, clears payment state and prompts in Telegram without a web link',async()=>{
 const h=harness();
 await h.handlePasswordReset({...h.ctx,chat:{type:'group'}});
 await h.handlePasswordReset({...h.ctx,chat:{type:'supergroup'}});
 await h.handlePasswordReset({...h.ctx,from:undefined});
 assert.equal(h.requests.length,0);assert.equal(h.replies.length,0);
 await h.handlePasswordReset(h.ctx);assert.deepEqual(h.requests,['123']);
 assert.equal(h.ctx.session.awaitingCardInfoFor,undefined);
 assert.equal(h.ctx.session.awaitingReceiptFor,undefined);
 assert.equal(h.ctx.session.passwordReset.stage,'new');
 assert.equal(h.replies[0][0],texts.passwordResetNew);
 assert.equal(h.replies[0][1].reply_markup.force_reply,true);
 assert.equal(JSON.stringify(h.replies).includes('https://'),false);
 assert.equal(JSON.stringify(h.replies).includes('A'.repeat(43)),false);
});
test('reset failures give actionable safe guidance without internal errors or secrets',async()=>{
 for(const [failure,reply] of [[new ApiError(404),texts.passwordResetNotLinked],[new ApiError(429),texts.passwordResetWait],[new Error('private secret'),texts.genericError]]) {
  const h=harness(async()=>{throw failure});await h.handlePasswordReset(h.ctx);
  assert.equal(h.replies[0][0],reply);
  assert.equal(h.ctx.session.passwordReset,undefined);
  assert.deepEqual(h.logs,[]);
 }
});
test('both password messages are deleted; only a digest is retained and confirmation revokes the flow',async()=>{
 const h=harness(),password='  local-password-123  ';
 await h.handlePasswordReset(h.ctx);await h.send(password);
 assert.equal(h.ctx.session.passwordReset.stage,'confirm');
 assert.equal(JSON.stringify(h.ctx.session).includes(password),false);
 assert.equal(h.confirmations.length,0);
 await h.send(password);
 assert.equal(h.deletions.length,2);
 assert.deepEqual(h.confirmations,[['123','A'.repeat(43),password]]);
 assert.equal(h.ctx.session.passwordReset,undefined);
 assert.equal(h.replies.at(-1)[0],texts.passwordResetSuccess);
 assert.equal(JSON.stringify(h.replies).includes(password),false);
 assert.equal(h.fallthrough(),0);assert.deepEqual(h.logs,[]);
});
test('numeric passwords stay out of phone/payment parsing and mismatches can be corrected',async()=>{
 const h=harness();await h.handlePasswordReset(h.ctx);
 await h.send('998901234567');await h.send('998909999999');
 assert.equal(h.confirmations.length,0);assert.equal(h.ctx.session.passwordReset.stage,'confirm');
 assert.ok(h.replies.some(reply=>reply[0]===texts.passwordResetMismatch));
 await h.send('998901234567');assert.equal(h.confirmations.length,1);assert.equal(h.fallthrough(),0);
});
test('short and oversized UTF-8 passwords are deleted without advancing or submitting',async()=>{
 const h=harness();await h.handlePasswordReset(h.ctx);
 for(const invalid of ['short','a'.repeat(73),'😀'.repeat(19)]) await h.send(invalid);
 assert.equal(h.ctx.session.passwordReset.stage,'new');assert.equal(h.confirmations.length,0);
 assert.equal(h.deletions.length,3);assert.equal(h.fallthrough(),0);
 await h.send('😀'.repeat(18));await h.send('😀'.repeat(18));assert.equal(h.confirmations.length,1);
});
test('expired, restarted, mismatched-sender and delayed prompt replies fail safely',async()=>{
 for(const kind of ['expired','restart','sender','delayed']) {
  const h=harness();await h.handlePasswordReset(h.ctx);
  const ctx=h.entry('998901234567');
  if(kind==='expired') h.ctx.session.passwordReset.expiresAt=Date.now()-1;
  if(kind==='restart') h.ctx.session.passwordReset=undefined;
  if(kind==='sender') ctx.from={id:999};
  if(kind==='delayed') ctx.message.reply_to_message.message_id--;
  await h.passwordResetMiddleware(ctx,async()=>{throw Error('must not enter phone parsing');});
  assert.equal(h.confirmations.length,0);assert.equal(h.deletions.length,1);
  if(kind==='delayed') assert.equal(h.ctx.session.passwordReset.stage,'new');
  else {assert.equal(h.ctx.session.passwordReset,undefined);assert.equal(h.replies.at(-1)[0],texts.passwordResetExpired);}
 }
 // A forged/non-bot prompt is not treated as a password after restart.
 const h=harness();const ctx=h.entry('normal text',{reply_to_message:{from:{id:123},text:texts.passwordResetNew}});
 let called=false;await h.passwordResetMiddleware(ctx,async()=>{called=true;});assert.equal(called,true);
});
test('delete failure aborts before retaining or submitting credentials',async()=>{
 for(const stage of ['new','confirm']) {
  const h=harness();await h.handlePasswordReset(h.ctx);
  if(stage==='confirm') await h.send('local-password-123');
  h.ctx.deleteMessage=async()=>{throw Error('Telegram deletion unavailable');};
  await h.send('local-password-123');assert.equal(h.confirmations.length,0);
  assert.equal(h.ctx.session.passwordReset,undefined);assert.equal(h.replies.at(-1)[0],texts.passwordResetDeleteFailed);
 }
});
test('concurrent confirmation updates make only one write and clear state after unknown outcomes',async()=>{
 let resolve;
 const h=harness(undefined,()=>new Promise(r=>{resolve=r;}));
 await h.handlePasswordReset(h.ctx);await h.send('local-password-123');
 const first=h.send('local-password-123');
 await new Promise(r=>setImmediate(r));
 await h.send('local-password-123');
 assert.equal(h.confirmations.length,1);resolve({reset:true});await first;
 assert.equal(h.deletions.length,3);assert.equal(h.ctx.session.passwordReset,undefined);
 const failed=harness(undefined,async()=>{throw Error('request body contains local-password-123');});
 await failed.handlePasswordReset(failed.ctx);await failed.send('local-password-123');await failed.send('local-password-123');
 assert.equal(failed.confirmations.length,1);assert.equal(failed.ctx.session.passwordReset,undefined);
 assert.equal(failed.replies.at(-1)[0],texts.genericError);assert.deepEqual(failed.logs,[]);
 assert.equal(JSON.stringify(failed.replies).includes('local-password-123'),false);
});
test('Telegram redelivery does not consume an entry twice or cancel an in-flight save',async()=>{
 let resolve;
 const h=harness(undefined,()=>new Promise(r=>{resolve=r;}));
 await h.handlePasswordReset(h.ctx);
 const first=h.entry('/local-password-123');
 const next=async()=>{throw Error('password cannot escape');};
 await h.passwordResetMiddleware(first,next);await h.passwordResetMiddleware(first,next);
 assert.equal(h.deletions.length,1);assert.equal(h.ctx.session.passwordReset.stage,'confirm');
 const second=h.entry('/local-password-123');
 const running=h.passwordResetMiddleware(second,next);
 await new Promise(r=>setImmediate(r));
 await h.passwordResetMiddleware(second,next);
 const duplicate=h.entry('/local-password-123');duplicate.deleteMessage=async()=>{throw Error('temporary delete failure');};
 await h.passwordResetMiddleware(duplicate,next);
 assert.equal(h.ctx.session.passwordReset.stage,'busy');assert.equal(h.confirmations.length,1);
 resolve({reset:true});await running;
 assert.equal(h.deletions.length,2);assert.equal(h.ctx.session.passwordReset,undefined);
 assert.equal(h.replies.at(-1)[0],texts.passwordResetSuccess);
});
test('commands, menus and callbacks exit password collection; cancel restores the menu',async()=>{
 for(const text of ['/start','/help','/cancel','/reset_password',texts.menuButtons.myAccount]) {
  const h=harness();await h.handlePasswordReset(h.ctx);await h.send(text);
  assert.equal(h.ctx.session.passwordReset,undefined);assert.equal(h.fallthrough(),1);assert.equal(h.deletions.length,0);
 }
 const h=harness();await h.handlePasswordReset(h.ctx);
 let next=false;await h.passwordResetMiddleware({...h.ctx,callbackQuery:{data:'menu_account'}},async()=>{next=true;});
 assert.equal(next,true);assert.equal(h.ctx.session.passwordReset,undefined);
 await h.handleCancelPasswordReset(h.ctx);assert.equal(h.replies.at(-1)[0],texts.passwordResetCancelled);
});
test('production routing captures password text before receipts or phone linking',async()=>{
 const h=harness();
 const {Telegraf,session}=require('telegraf');
 // TypeScript is evaluated in another VM realm; adapt RegExp identity for
 // the real Telegraf Composer while retaining its actual update pipeline.
 class TestBot extends Telegraf {action(trigger,...handlers){return super.action(typeof trigger==='object'?new RegExp(trigger.source,trigger.flags):trigger,...handlers);}}
 const menu={isAdmin:()=>false,resolveLinkedUser:async()=>null};
 const noop=async()=>{};
 for(const name of ['handleMenuMain','handleMenuAccount','handleMenuHelp']) menu[name]=noop;
 const handlers={};
 for(const name of ['handleMenuBuy','handleChooseTier','handleChooseDuration','handlePayManual','handlePayClick','handleMenuAdmin','handleAdminApprove','handleAdminReject','handleMenuPayments','handleCheckPaymentStatus']) handlers[name]=noop;
 let receipts=0;
 const mocks={'telegraf':{Telegraf:TestBot,session},'../config/env':{env:{BOT_TOKEN:'local-test-only'}},'./context':{emptySession:()=>({})},'./texts':{texts},
  './handlers/password-reset':h,'./handlers/start':{handleStart:noop,handleContact:async()=>{throw Error('password cannot enter linking');},handleRetryLink:noop},'./handlers/menu':menu,
  './handlers/plans':handlers,'./handlers/admin':handlers,'./handlers/payments':handlers,
  './handlers/receipt':{handlePhoto:noop,handleNoReceipt:noop,looksLikeCardDetails:()=>{receipts++;return false;},recoverCardDetailsPaymentId:noop,handleCardDetailsText:noop}};
 const {createBot}=load('src/bot/bot.ts',mocks,{console:{error:()=>{}}});
 const bot=createBot();bot.botInfo=h.ctx.botInfo;
 Object.assign(bot.context,{reply:h.ctx.reply,deleteMessage:h.ctx.deleteMessage});
 let id=200;
 async function update(text){const message={message_id:++id,date:0,text,from:{id:123,is_bot:false,first_name:'Local'},chat:{id:123,type:'private'}};if(text.startsWith('/'))message.entities=[{offset:0,length:text.split(' ')[0].length,type:'bot_command'}];await bot.handleUpdate({update_id:id,message});}
 await update('/reset_password');await update('998901234567');await update('998901234567');
 assert.equal(h.confirmations.length,1);assert.equal(receipts,0);
 assert.equal(h.replies.at(-1)[0],texts.passwordResetSuccess);
});
test('reset Start deep link runs before linked-account menu or signup flow',async()=>{
 let calls=0;
 const {handleStart}=load('src/bot/handlers/start.ts',{
  './password-reset':{handlePasswordReset:async()=>calls++},'./menu':{resolveLinkedUser:async()=>{throw Error('must not use cached linking');}},
  '../../services/api-client':{api:{}},'../../config/env':{env:{}},'../texts':{texts:{}},'../keyboards':{keyboards:{}},
 });
 await handleStart({from:{id:123},chat:{type:'private'},session:{},message:{text:'/start reset_password'}});
 assert.equal(calls,1);
});
