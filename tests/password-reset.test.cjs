const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,mocks) {
 const exports={};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>mocks[name]??require(name)}); return exports;
}
class ApiError extends Error {constructor(statusCode){super('internal diagnostic must not reach chat');this.statusCode=statusCode;}}
function harness(work=async()=>({resetUrl:'https://hisvex-web.vercel.app/reset-password#token='+'A'.repeat(43)})) {
 const requests=[], replies=[], acks=[];
 const {handlePasswordReset}=load('src/bot/handlers/password-reset.ts',{
  '../../services/api-client':{ApiError,api:{requestPasswordReset:async id=>{requests.push(id);return work();}}},
  '../texts':{texts:{passwordResetReady:'safe reset instructions',passwordResetOpen:'set password',passwordResetNotLinked:'share own contact first',passwordResetWait:'wait one minute',genericError:'safe error'}},
  '../keyboards':{keyboards:{requestPhone:{reply_markup:{keyboard:[]}}}},'../respond':{ackIfCallback:async ctx=>acks.push(ctx)},
 });
 const ctx={from:{id:123},chat:{type:'private'},session:{userId:'stale-other-account',awaitingCardInfoFor:'payment'},reply:async(...args)=>replies.push(args)};
 return {handlePasswordReset,ctx,requests,replies,acks};
}
test('reset uses the actual private sender and never exposes a link to groups or trusts a cached userId',async()=>{
 const h=harness();
 await h.handlePasswordReset({...h.ctx,chat:{type:'group'}});
 await h.handlePasswordReset({...h.ctx,chat:{type:'supergroup'}});
 await h.handlePasswordReset({...h.ctx,from:undefined});
 assert.equal(h.requests.length,0);assert.equal(h.replies.length,0);
 await h.handlePasswordReset(h.ctx);assert.deepEqual(h.requests,['123']);
 assert.equal(h.ctx.session.awaitingCardInfoFor,undefined);
 const options=h.replies[0][1];assert.equal(options.link_preview_options.is_disabled,true);
 assert.equal(options.reply_markup.inline_keyboard[0][0].url,'https://hisvex-web.vercel.app/reset-password#token='+'A'.repeat(43));
});
test('reset failures give actionable safe guidance without internal errors or secrets',async()=>{
 for(const [failure,reply] of [[new ApiError(404),'share own contact first'],[new ApiError(429),'wait one minute'],[new Error('private secret'),'safe error']]) {
  const h=harness(async()=>{throw failure});await h.handlePasswordReset(h.ctx);
  assert.equal(h.replies[0][0],reply);
 }
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
