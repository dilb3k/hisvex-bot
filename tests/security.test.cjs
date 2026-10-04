const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript')
function load(file,mocks,extra={}) {
 const exports={},code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 vm.runInNewContext(code,{exports,require:n=>mocks[n]??require(n),URL,Headers,Response,FormData,Blob,Buffer,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval:()=>({}),clearInterval(){},console,...extra});return exports
}
function startHarness(){
 const calls=[],api={confirmRegistration:async()=>({verified:false}),lookupUserByPhone:async phone=>{calls.push(['lookup',phone]);return {userId:'owner',username:'store'}},linkTelegram:async(...args)=>calls.push(['link',...args])}
 const mocks={'../../services/api-client':{api},'../../config/env':{env:{APP_DOWNLOAD_URL:'https://example.test'}},'./password-reset':{handlePasswordReset:async()=>{}},'./menu':{resolveLinkedUser:async()=>null,showMainMenu:async()=>{},isAdmin:()=>false},'../texts':{texts:{genericError:'invalid contact',linked:()=> 'linked'}},'../keyboards':{keyboards:{persistentMenu:()=>({})}}}
 return {handlers:load('src/bot/handlers/start.ts',mocks),calls}
}
test('bot accepts only the sender’s own Telegram contact in a private conversation',async()=>{
 const h=startHarness();const ctx=(contact,chat='private')=>({from:{id:123,username:'test'},chat:{type:chat},message:{contact},session:{},reply:async()=>{}})
 await h.handlers.handleContact(ctx({phone_number:'998900000000'}));await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:999}));await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:123},'group'))
 assert.equal(h.calls.length,0)
 await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:123}));assert.equal(h.calls[1][0],'link');assert.equal(h.calls[1][2],'123');assert.equal(h.calls[1][4],'998900000000')
 assert.equal(h.handlers.linkByPhone,undefined)
})
test('user-controlled account and payment text cannot inject Telegram HTML',()=>{
 const {texts}=load('src/bot/texts.ts',{'../config/env':{env:{}}})
 const unsafe='<a href="https://attacker.test">fake</a>&'
 const linked=texts.linked(unsafe)
 assert.ok(linked.includes('&lt;a href='));assert.equal(linked.includes('<a href='),false)
 const caption=texts.adminCardDetailsCaption({username:unsafe,telegramUsername:'safe',tier:'bor',duration:1,amount:'100',paymentId:'fixture',cardNumber:'86001234',fullName:unsafe})
 assert.equal(caption.includes('<a href='),false)
 assert.ok(caption.includes('&lt;/a&gt;&amp;'))
 assert.equal(texts.paymentRejectedUser(unsafe).includes('<a href='),false)
})
test('registration Start takes priority over a linked-account menu and own contact confirms without account lookup', async () => {
 const calls=[], replies=[];
 const api={startRegistration:async(...args)=>{calls.push(['start',...args]);return {verified:false}},confirmRegistration:async(...args)=>{calls.push(['confirm',...args]);return {verified:true}},lookupUserByPhone:async()=>{throw Error('registration has no account yet')}};
 const handlers=load('src/bot/handlers/start.ts',{'../../services/api-client':{api},'../../config/env':{env:{}},'./password-reset':{handlePasswordReset:async()=>{}},'./menu':{resolveLinkedUser:async()=>{throw Error('must handle registration first')},showMainMenu:async()=>{},isAdmin:()=>false},'../texts':{texts:{genericError:'error'}},'../keyboards':{keyboards:{requestPhone:{reply_markup:{keyboard:[]}}}}});
 const ctx={from:{id:123,username:'test'},chat:{type:'private'},message:{text:'/start reg_'+'A'.repeat(43)},session:{userId:'already-linked',awaitingCardInfoFor:'old-payment'},reply:async text=>replies.push(text)};
 await handlers.handleStart(ctx);
 assert.equal(calls[0][1],'A'.repeat(43));assert.equal(calls[0][2],'123');assert.equal(ctx.session.awaitingCardInfoFor,undefined);
 // A new session imitates a restart between Start and contact delivery.
 await handlers.handleContact({...ctx,session:{},message:{contact:{phone_number:'998901234567',user_id:123}}});
 assert.equal(calls[1][0],'confirm');assert.equal(calls[1][1],'123');assert.equal(calls[1][2],'123');
 assert.match(replies[1],/tasdiqlandi/);
});
function apiHarness(){
 const axios=require('axios'),requests=[],handlers={}
 const http={interceptors:{request:{use:fn=>handlers.request=fn},response:{use:(ok,fail)=>handlers.fail=fail}},get:async()=>{},post:async()=>{}}
 const instance=Object.assign(async config=>{requests.push(config);return {data:{success:true,data:{}}}},http)
 const ax={create:()=>instance,get:async()=>({status:200})}
 let fetchCalls=0
 const api=load('src/services/api-client.ts',{axios:{...ax,AxiosError:axios.AxiosError},'../config/env':{env:{BACKEND_URL:'https://primary.test',BACKEND_BACKUP_URL:'https://backup.test',BOT_INTERNAL_SECRET:'local-test-only'}}},{fetch:async()=>{fetchCalls++;throw Error('connection lost')}})
 return {api:api.api,handlers,requests,fetchCalls:()=>fetchCalls}
}
test('Axios zero timeout gets a deadline; only reads fail over; receipt uploads are never replayed',async()=>{
 const h=apiHarness();assert.ok(h.handlers.request({timeout:0}).timeout>0)
 const error={config:{method:'post',url:'/payments/manual'},code:'ERR_NETWORK'}
 await assert.rejects(h.handlers.fail(error));assert.equal(h.requests.length,0)
 await h.handlers.fail({config:{method:'get',url:'/pricing'},code:'ERR_NETWORK'});assert.equal(h.requests.length,1)
 const fresh=apiHarness();await assert.rejects(fresh.api.attachReceipt('p','file',{buffer:Buffer.from('image'),contentType:'image/png'},'123'))
 assert.equal(fresh.fetchCalls(),1)
})

test('Railway platform 404 fails over once while business 404 and write 404 keep their original outcome',async()=>{
 const platform={status:404,data:{status:'error',code:404,message:'Application not found',request_id:'fixture'},headers:{}};
 const read=apiHarness();await read.handlers.fail({config:{method:'get',url:'/pricing'},response:platform});assert.equal(read.requests.length,1);
 const header=apiHarness();await header.handlers.fail({config:{method:'get',url:'/pricing'},response:{status:404,data:'not found',headers:{'x-railway-router':'edge'}}});assert.equal(header.requests.length,1);
 const business=apiHarness();await assert.rejects(business.handlers.fail({config:{method:'get'},response:{status:404,data:{success:false,error:{message:'Mahsulot topilmadi'}},headers:{}}}));assert.equal(business.requests.length,0);
 const write=apiHarness();await assert.rejects(write.handlers.fail({config:{method:'post'},response:platform}));assert.equal(write.requests.length,0);
});
test('a business envelope cannot trigger failover by including the Railway marker',async()=>{
 const h=apiHarness();await assert.rejects(h.handlers.fail({config:{method:'get'},response:{status:404,data:{success:false,error:{message:'Application not found'}},headers:{'x-railway-router':'edge'}}}));assert.equal(h.requests.length,0);
});
test('write outage marks Render for the next explicit request and never replays the failed write',async()=>{
 const h=apiHarness(),config=h.handlers.request({method:'post',url:'/payments/manual',timeout:0});
 await assert.rejects(h.handlers.fail({config,response:{status:404,data:{status:'error',message:'Application not found'},headers:{}}}));assert.equal(h.requests.length,0);
 assert.equal(h.handlers.request({method:'post',timeout:0}).baseURL,'https://backup.test/api/bot');
 await assert.rejects(h.handlers.fail({config:h.handlers.request({method:'get',timeout:0}),response:{status:503}}));assert.equal(h.requests.length,0,'active backup is never retried against itself');
});
