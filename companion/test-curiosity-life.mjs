import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CuriosityLife} from './curiosity-life.mjs';import {UnifiedCognition} from './cognition-tools.mjs';
import {guardQQWorld} from './qq-event-policy.mjs';
const root=mkdtempSync(join(tmpdir(),'whale-life-')),cognition=new UnifiedCognition(root),sent=[];let now=Date.parse('2036-10-13T12:00:00+08:00'),round=0,cycle=0,shareRound=0;
const conversationDb=new DatabaseSync(':memory:');conversationDb.exec('CREATE TABLE turns(peer TEXT,event TEXT,role TEXT,text TEXT,at INTEGER,state TEXT,PRIMARY KEY(peer,event,role))');
const service={paused:false,closed:false,cognition,engine:{db:conversationDb,queues:new Map(),revisions:new Map(),profile:'synthetic'},initiate:async(scope,event,text,{send})=>send({target:{kind:scope.kind,id:scope.id},text})};
let watched={groups:['900000002'],users:[]};
const world={handleEvent:async()=>({accepted:true}),getWatched:()=>watched,setWatched:(groups,users)=>{watched={groups,users};},sendToTarget:async(target,value)=>sent.push({target,...value})};
guardQQWorld(world,{bot_id:'910710001',group_id:'900000002',follow_configured_groups:true},()=>new Date(now));
const result=(name,args)=>({response:{status:'completed',output:[{type:'function_call',name,call_id:String(++round),arguments:JSON.stringify(args)}]}});
const client={canInitiate:()=>true,respond:async req=>{
 if(req.tools.some(tool=>tool.name==='finish_life_share'))return {response:{status:'completed',output:[{type:'function_call',name:'finish_life_share',call_id:'share-'+(++shareRound),arguments:JSON.stringify({decision:'share',text:JSON.parse(req.input.find(item=>item.role==='user').content).draft,reason:'Preserve the fixture draft for transport assertions.'})}]}};
 const step=round%4;if(step===0){cycle++;return result('choose_activity',{topic:'Tides',why:'I am curious'});}if(step===1)return result('public_fetch',{url:'https://www.hko.gov.hk/'});if(step===2)return result('save_discovery',{summary:'The moon contributes to tides; source read '+cycle,reflection:{kind:'interest',key:'tides',value:'I would like to compare tides '+cycle,reason:'This activity read the public source'}});return result('share_discovery',{text:'今天新读到潮汐知识 '+cycle,recipient:'family',recipient_reason:'This particular tide detail may interest the family.'});}};
const config={path:join(root,'life.sqlite3'),service,social:{inbound:()=>0},world,policy:{bot_id:'910710001',group_id:'900000002'},client,topics:()=>[],clock:()=>now,tools:[{name:'public_fetch',description:'synthetic reader',parameters:{type:'object',properties:{url:{type:'string'}},required:['url']},handler:()=>JSON.stringify({status:'ok',sources:[{url:'https://www.hko.gov.hk/',title:'Tides',excerpt:'The moon contributes to tides.'}]})}]};
const life=new CuriosityLife(config);life.resume();const first=await life.tick();assert.equal(first.status,'sent',JSON.stringify({first,rows:life.recent(),round}));assert.equal(sent.length,1);assert.equal(life.recent()[0].state,'completed');assert.equal(cognition.store.search({query:'tides'}).records.length,1);assert.equal(cognition.store.getState({kind:'interest'})[0].basis,'linked-experience');
now+=31*60000;assert.equal((await life.tick()).status,'sent');assert.equal(sent.length,2);
now+=31*60000;const third=await life.tick();assert.equal(third.status,'saved-share-deferred');assert.equal(sent.length,2);
assert.equal(life.recent()[0].state,'completed');assert.equal(life.db.prepare('SELECT count(*) n FROM discoveries').get().n,3); // Exploration continues while unanswered sharing takes a break.
now=Date.parse('2036-10-14T01:00:00+08:00');assert.equal((await life.tick()).status,'ineligible-or-not-due');assert.equal(sent.length,2);
await life.pause();assert.equal(life.eligible(),false);await life.close();
const badRoot=mkdtempSync(join(tmpdir(),'whale-life-empty-'));const bad=new CuriosityLife({...config,path:join(badRoot,'life.sqlite3'),clock:()=>Date.parse('2036-10-13T12:00:00+08:00'),client:{canInitiate:()=>true,respond:async()=>result('save_discovery',{summary:'Invented result'})},tools:[]});bad.resume();assert.equal((await bad.tick()).status,'failed');assert.equal(bad.db.prepare('SELECT count(*) n FROM discoveries').get().n,0);await bad.close();
cognition.close();conversationDb.close();
console.log('PASS autonomous choose→read→save→share, evidence-required completion, continued opportunities without human reply, pacing/dedup/night/pause, unified discovery memory; fake model/network/QQ');
