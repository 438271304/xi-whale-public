import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {PrivateConversation} from './private-conversation.mjs';

const app='C:/Users/USER/PersonalAgentBackups/companion-runtime/clean-lab-0.2.8/resources/app';
const requireApp=createRequire(join(app,'package.json'));
const {transformSync}=requireApp('esbuild');
const source=readFileSync(new URL('./core-output-recovery.ts',import.meta.url),'utf8');

// Execute the production registration block, not a second handwritten client.
// The real build callback's local `cfg` deliberately does not exist here: QQ
// definition.create is registered outside that callback in the production core.
function actualQQFactory(coreSource,{loaded,provider}){
 const startMarker='  for (const definition of extensions.worlds) {';
 const endMarker='  registerProviderModules(';
 const start=coreSource.indexOf(startMarker),end=coreSource.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,'Production QQ registration block must be identifiable');
 assert.equal(coreSource.indexOf(startMarker,start+startMarker.length),-1,'Do not select an ambiguous registration block');
 const code=transformSync(coreSource.slice(start,end),{loader:'ts',target:'node24',format:'cjs'}).code;
 let assemblies=0,worlds=0;
 const extensions={worlds:[{id:'qq',create:()=>{worlds++;return {synthetic_world:true};}}]};
 const context={extensions,loaded,scopedClient:provider,join,APP_ROOT:'/synthetic/app',guardianChannels:{synthetic:true},
  scopedRoutes:{create:factory=>factory()},
  prepareScopedAssembly:options=>{assemblies++;return options;},
  readScopedFile:()=> 'SYNTHETIC_PUBLIC_PROFILE',EventLedger:class SyntheticLedger{}};
 runInNewContext('"use strict";\n'+code,context,{timeout:1000,filename:'actual-core-qq-registration.js'});
 return {create:()=>extensions.worlds[0].create({cfg:{vision:{enabled:true},privates:['synthetic']},dataDir:'/synthetic/data'}),counts:()=>({assemblies,worlds})};
}

test('actual core QQ factory binds live generation config through a real conversation turn',async t=>{
 const requests=[],deliveries=[];
 const loaded={rootDir:'/synthetic/home',memoryDir:'/synthetic/memory',dataDir:'/synthetic/data',config:{activeProvider:'primary',providers:{
  primary:{secret:'SYNTHETIC_SECRET_MUST_NOT_ENTER_REQUEST',spec:{model:'deepseek-flash',reasoningEffort:'high',maxTokens:8192}},
  secondary:{secret:'ANOTHER_SYNTHETIC_SECRET',spec:{model:'deepseek-flash',reasoningEffort:'low',maxTokens:4096}}
 }}};
 const provider={canInitiate:()=>true,respond:async request=>{requests.push(request);return {response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A synthetic reply.'}]}]}};}};
 const unavailableLoaded={...loaded,get config(){throw new ReferenceError('Synthetic configuration binding unavailable');}};
 const unavailable=actualQQFactory(source,{loaded:unavailableLoaded,provider});
 assert.throws(()=>unavailable.create(),/Synthetic configuration binding unavailable/,'A bad binding must fail at assembly, before the first incoming message');
 assert.deepEqual(unavailable.counts(),{assemblies:0,worlds:0});
 assert.equal(requests.length,0);
 const factory=actualQQFactory(source,{loaded,provider});
 const assembly=factory.create();
 assert.deepEqual(factory.counts(),{assemblies:1,worlds:1});
 assert.equal(assembly.client.canInitiate(),true);
 // This is the getter produced by the production factory, in an isolated scope
 // with `loaded` but no accidental global `cfg` to mask a broken binding.
 assert.deepEqual({...assembly.client.generationSettings()},{model:'deepseek-flash',reasoningEffort:'high',maxTokens:8192});
 const engine=new PrivateConversation({path:':memory:',client:assembly.client,profile:assembly.publicProfile,isAllowed:()=>true,
  send:async(peer,text)=>deliveries.push({peer,text})});
 t.after(()=>engine.close());
 const message=(peer,event)=>JSON.stringify({transport:{conversation:peer,message_id:event,sender_id:'910910002',time:1793318400},body:'Synthetic binding check.'});
 assert.equal((await engine.receive('910910002','binding-private',message('private:910910002','binding-private'))).status,'sent');
 assert.equal(requests[0].model,'deepseek-flash');
 assert.deepEqual(requests[0].reasoning,{effort:'high'});
 assert.equal(requests[0].max_output_tokens,8192);
 // A later group turn must use the current selected provider/spec, rather than
 // a boot-time snapshot or a build-local variable from a different function.
 loaded.config.activeProvider='secondary';
 assert.equal((await engine.receive('group:910920001','binding-group',message('group:910920001','binding-group'))).status,'sent');
 assert.deepEqual(requests[1].reasoning,{effort:'low'});
 assert.equal(requests[1].max_output_tokens,4096);
 loaded.config.providers.secondary.spec={model:'deepseek-flash',reasoningEffort:'high',maxTokens:2048};
 assert.equal((await engine.receive('910910002','binding-updated',message('private:910910002','binding-updated'))).status,'sent');
 assert.deepEqual(requests[2].reasoning,{effort:'high'});
 assert.equal(requests[2].max_output_tokens,2048);
 assert.equal(requests.length,3);
 assert.equal(deliveries.length,3);
 assert.equal(engine.db.prepare('SELECT count(*) AS n FROM turn_failures').get().n,0);
 assert.ok(!JSON.stringify(requests).includes('SYNTHETIC_SECRET'));
});
