const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(linked){
 const calls=[],exports={};
 const mocks={
 './plans':{handleMenuBuy:async()=>calls.push('buy')},
 './menu':{resolveLinkedUser:async()=>linked,isAdmin:()=>false,showMainMenu:async()=>calls.push('menu')},
 './password-reset':{handlePasswordReset:async()=>calls.push('reset')},
 '../texts':{texts:{welcome:'welcome',welcomeBack:'back',linked:()=> 'linked'}},
 '../keyboards':{keyboards:{persistentMenu:()=>({}),requestPhone:{}}},
 '../../config/env':{env:{}},
 '../../services/api-client':{api:{confirmRegistration:async()=>({verified:false}),lookupUserByPhone:async()=>({userId:'user',username:'name'}),linkTelegram:async()=>calls.push('link')}}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/bot/handlers/start.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]??require(n),console});
 const ctx={chat:{type:'private'},from:{id:123},session:{},message:{text:'/start obuna'},reply:async text=>calls.push(text)};
 return {...exports,ctx,calls};
}
test('subscription deep link and command go to purchase, ordinary start keeps main menu',async()=>{
 for(const command of ['/start obuna','/obuna','/obuna@hisvex_bot']){
 const h=harness(true);h.ctx.message.text=command;await h.handleStart(h.ctx);
 assert.ok(h.calls.includes('buy'));assert.ok(!h.calls.includes('menu'));assert.equal(h.ctx.session.pendingSubscription,false);
 }
 const h=harness(true);h.ctx.message.text='/start';await h.handleStart(h.ctx);assert.ok(h.calls.includes('menu'));assert.ok(!h.calls.includes('buy'));
});
test('subscription intent continues after own-phone verification',async()=>{
 const h=harness(false);await h.handleStart(h.ctx);assert.equal(h.ctx.session.pendingSubscription,true);assert.ok(!h.calls.includes('buy'));
 h.ctx.message={contact:{phone_number:'+998901234567',user_id:123}};await h.handleContact(h.ctx);
 assert.ok(h.calls.includes('link'));assert.ok(h.calls.includes('buy'));assert.equal(h.ctx.session.pendingSubscription,false);
});
test('subscription entry ignores group messages',async()=>{
 const h=harness(true);h.ctx.chat.type='group';await h.handleStart(h.ctx);assert.equal(h.calls.length,0);
});
