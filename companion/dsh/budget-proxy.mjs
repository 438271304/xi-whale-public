import http from 'node:http';
import {readFileSync,appendFileSync} from 'node:fs';
import {SpendingBook} from './spending-book.mjs';
const root='D:/Deepseek',home='C:/Users/USER/PersonalAgentRuntime/whale-v1/home';
const cfg=JSON.parse(readFileSync(home+'/providers/deepseek/config.json','utf8'));
if(new URL(cfg.baseUrl).origin!=='https://api.deepseek.com')throw Error('Unexpected authorized provider');
// The child DSH receives a local proxy token under the same variable name.
// Read the authorized provider file explicitly; do not forward that local token.
if(cfg.secret!=='DEEPSEEK_API_KEY')throw Error('Authorized credential reference changed');
const key=/^[ \t]*DEEPSEEK_API_KEY[ \t]*=[ \t]*(\S+)/m.exec(readFileSync(home+'/providers/deepseek/.env','utf8').replace(/^\uFEFF/,''))?.[1];
if(!key)throw Error('Existing credential unavailable');
const token=readFileSync(root+'/data/proxy-token','utf8').trim(),book=new SpendingBook(root+'/data/dsh-budget.sqlite3',1000000);
function usage(text){let input=null,output=null;const add=u=>{if(!u)return;const i=u.input_tokens??u.prompt_tokens,o=u.output_tokens??u.completion_tokens;if(Number.isSafeInteger(i))input=Math.max(input??0,i+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0));if(Number.isSafeInteger(o))output=Math.max(output??0,o);};try{add(JSON.parse(text).usage);}catch{}for(const line of text.split('\n'))if(line.startsWith('data: ')){try{const v=JSON.parse(line.slice(6));add(v.usage);add(v.message?.usage);}catch{}}return input!==null&&output!==null?{input,output}:null;}
const fail=(res,status,message)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'budget_guard',message}}));};
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ready',daily_cap_cny:1,model:'deepseek-flash',max_output_tokens:1024,bind:'127.0.0.1'}));return;}
 if(req.headers['x-api-key']!==token&&req.headers.authorization!=='Bearer '+token){fail(res,401,'Local credential required');return;}
 if(req.method==='GET'&&req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-flash',type:'model',display_name:'DeepSeek Flash'}],has_more:false}));return;}
 if(req.method!=='POST'||req.url!=='/v1/messages'){fail(res,404,'Only the fixed Messages route is enabled');return;}
 let id,bytes=0;
 try{
  const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>262144)throw Error('Request size limit');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks).toString());if(body.model!=='deepseek-flash'||!Array.isArray(body.messages))throw Error('Only configured model accepted');
  body.max_tokens=Math.min(Number.isSafeInteger(body.max_tokens)?body.max_tokens:1024,1024);if(body.max_tokens<1)throw Error('Invalid output limit');
  // 4x byte fallback plus framing reserve; unknown usage stays reserved across restart.
  const wire=JSON.stringify(body),inputUpper=Buffer.byteLength(wire)*4+8192;if(inputUpper>1048576)throw Error('Input reservation limit');
  const amount=Math.max(50000,Math.ceil((inputUpper*200+body.max_tokens*800)/100));id=book.reserve(amount);
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  const upstream=await fetch('https://api.deepseek.com/anthropic/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:wire,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});let recorded='',length=0;
  for await(const chunk of upstream.body){length+=chunk.length;if(length<=4194304)recorded+=Buffer.from(chunk).toString('utf8');res.write(chunk);}res.end();
  const measured=length<=4194304?usage(recorded):null;if(measured)book.settleDeepSeek(id,[{meters:measured}]);
  appendFileSync(root+'/logs/budget-events.jsonl',JSON.stringify({at:new Date().toISOString(),id,http_status:upstream.status,reserved_cny:amount/1000000,usage_known:!!measured,input:measured?.input??null,output:measured?.output??null})+'\n');
 }catch{if(!res.headersSent)fail(res,429,'Independent DSH budget, request bound or provider unavailable; no automatic retry by the guard');else res.destroy();appendFileSync(root+'/logs/budget-events.jsonl',JSON.stringify({at:new Date().toISOString(),id:id??null,status:'failed-reservation-retained'})+'\n');}
});
server.listen(3091,'127.0.0.1',()=>console.log('DSH budget guard ready on loopback; daily cap 1 CNY.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{book.close();process.exit(0);});setTimeout(()=>process.exit(0),5000).unref();});
