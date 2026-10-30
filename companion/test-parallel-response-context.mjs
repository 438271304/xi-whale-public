import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {runScopedTurn} from './scoped-tools.mjs';
const app='C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app';
await import(pathToFileURL(app+'/build/cortico/src/extensions/runtime.ts').href);
const {VendorResponses}=await import(pathToFileURL(app+'/node_modules/cortico-provider-coo/src/responses.ts').href);
const origin={instance:'synthetic',module:'coo',model:'deepseek-flash',compatibilityDomain:'synthetic-domain'};
const mapper=new VendorResponses({baseUrl:'https://api.deepseek.com',reasoningReplay:'plaintext',sendSyntheticReasoning:true},{});
let rounds=0,executed=0;
const schema={type:'object',properties:{},additionalProperties:false};
const result=await runScopedTurn({profile:'synthetic',input:[{role:'user',content:'Use two tools.'}],tools:['one','two'].map(name=>({name,description:'synthetic',parameters:schema,handler:()=>++executed})),client:{respond:async(req,opt)=>{
 if(++rounds===1)return {response:{id:'synthetic-response-1',status:'completed',output:[{type:'reasoning',id:'rs_1',summary:[],content:[{type:'reasoning_text',text:'Synthetic decision.'}]},...['one','two'].map(name=>({type:'function_call',id:'fc_'+name,call_id:'call_'+name,name,arguments:'{}',status:'completed'}))]},attempts:[{origin}]};
 const wire=mapper.buildResponseBody(req,{...opt,origin});
 assert.deepEqual(wire.input.map(x=>x.type),['message','reasoning','function_call','function_call','function_call_output','function_call_output']);
 assert.equal(opt.context.filter(x=>x.item.type==='function_call').every(x=>x.context.origin===origin),true);
 const old=mapper.buildResponseBody(req,{origin});assert.equal(old.input.filter(x=>x.type==='reasoning').length,2); // old raw replay split the batch
 return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'OK'}]}]}};
}}});assert.equal(result,'OK');assert.equal(executed,2);assert.equal(rounds,2);
console.log('PASS actual Responses mapper: origin/response context preserves parallel call batch; old raw path reproduces extra reasoning split; no network');
