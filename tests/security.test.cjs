const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),ts=require('typescript')
function load(file,mocks,extra={}) {
 const exports={},code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 vm.runInNewContext(code,{exports,require:n=>mocks[n]??require(n),URL,Headers,Response,FormData,Blob,Buffer,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval:()=>({}),clearInterval(){},console,...extra});return exports
}
function startHarness(){
 const calls=[],api={lookupUserByPhone:async phone=>{calls.push(['lookup',phone]);return {userId:'owner',username:'store'}},linkTelegram:async(...args)=>calls.push(['link',...args])}
 const mocks={'../../services/api-client':{api},'../../config/env':{env:{APP_DOWNLOAD_URL:'https://example.test'}},'./menu':{resolveLinkedUser:async()=>null,showMainMenu:async()=>{},isAdmin:()=>false},'../texts':{texts:{genericError:'invalid contact',linked:()=> 'linked'}},'../keyboards':{keyboards:{persistentMenu:()=>({})}}}
 return {handlers:load('src/bot/handlers/start.ts',mocks),calls}
}
test('bot accepts only the sender’s own Telegram contact in a private conversation',async()=>{
 const h=startHarness();const ctx=(contact,chat='private')=>({from:{id:123,username:'test'},chat:{type:chat},message:{contact},session:{},reply:async()=>{}})
 await h.handlers.handleContact(ctx({phone_number:'998900000000'}));await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:999}));await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:123},'group'))
 assert.equal(h.calls.length,0)
 await h.handlers.handleContact(ctx({phone_number:'998900000000',user_id:123}));assert.equal(h.calls[1][0],'link');assert.equal(h.calls[1][2],'123');assert.equal(h.calls[1][4],'998900000000')
 assert.equal(h.handlers.linkByPhone,undefined)
})
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
