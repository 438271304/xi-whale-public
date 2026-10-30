// Trusted local entry only. Never mounted as a model tool or HTTP write endpoint.
import {readFileSync,existsSync} from 'node:fs';
import {Workroom} from './workroom.mjs';
import {conversationScope} from './conversation-scope.mjs';
const args=process.argv.slice(2),action=args.shift();
const option=name=>{const index=args.indexOf('--'+name);return index<0?undefined:args[index+1];};
const db=option('db')??'C:/Users/USER/PersonalAgentRuntime/whale-v1/home/companion/scoped-chat/workroom.sqlite3';
const address=option('scope');if(!address||! /^(group|private):\d{5,15}$/.test(address))throw Error('Specify a transport scope with --scope');
const [kind,id]=address.split(':'),scope=conversationScope(kind,id),store=new Workroom(db);
try{
 let result;
 if(action==='dispatch'){
  const file=option('file');if(!file||!existsSync(file))throw Error('Dispatch requires --file');
  const raw=readFileSync(file);if(raw.length>12000)throw Error('Dispatch file limit');const request=JSON.parse(raw);
  if(Object.keys(request).some(k=>!['title','brief'].includes(k)))throw Error('Dispatch supports only title and brief');result=store.dispatch(scope,request);
 }else if(action==='tasks')result=store.tasks(scope);
 else if(action==='review'){
  const decision=option('decision');if(!['accept','changes'].includes(decision))throw Error('Use --decision accept|changes');
  result=store.review(scope,option('task'),decision==='accept',option('feedback'));
 }else if(action==='seed-development'){
  const title='潮汐小卡 · 开发验收合成作品';
  const previous=store.list(scope,true).find(p=>p.origin==='development-acceptance'&&p.title===title);
  if(previous){result={already_seeded:true,project_id:previous.id,version:previous.version};}
  else{
   const task=store.dispatch(scope,{title:'开发验收：工作间闭环',brief:'开发验收合成任务，由开发者准备；不是汐自发创作。创建静态潮汐卡、报告检查错误、修正、恢复版本并提交待审阅。'});
   let project=store.create(scope,{title,task_id:task.task_id,origin:'development-acceptance',files:{'index.html':'<h1>验收中的小卡</h1>','main.js':'const wave = ;'}});
   const firstCheck=store.check(scope,project.project_id);if(firstCheck.ok)throw Error('Broken JS unexpectedly passed');
   project=store.write(scope,project.project_id,project.version,[{path:'index.html',text:'<main class="card"><p class="eyebrow">开发验收合成作品 · 非汐自创</p><h1>给新想法，一小片海。</h1><svg viewBox="0 0 480 160" role="img" aria-label="静态海浪"><path d="M0 80 Q60 20 120 80 T240 80 T360 80 T480 80 V160 H0Z" fill="#80bbb9"/><path d="M0 105 Q60 55 120 105 T240 105 T360 105 T480 105 V160 H0Z" fill="#237c83"/></svg><p>创建、检查、修改、版本恢复、提交和明确发布的闭环验收。</p><small>这是一张静态小卡，脚本没有执行。</small></main>'},{path:'style.css',text:'body{margin:0;padding:36px 18px;background:#edf4f0;color:#193d45;font:17px/1.7 system-ui,sans-serif}.card{max-width:640px;margin:0 auto;padding:32px;border-radius:24px;background:#fff;border:1px solid #dce8e5}h1{font-weight:500;font-size:34px}.eyebrow{font-size:13px;color:#237c83}svg{display:block;width:100%;margin:24px 0;border-radius:16px}small{color:#607b7f}'},{path:'main.js',text:'// Development acceptance only. Syntax checked; never executed.\nconst wave = "static";'}]);
   const fixedVersion=project.version;
   project=store.write(scope,project.project_id,project.version,[{path:'draft.txt',text:'用于证明恢复不会删除旧版本的临时草稿'}]);
   project=store.restore(scope,project.project_id,fixedVersion,project.version);
   const submission=store.submit(scope,project.project_id,project.version,'开发验收合成作品：固定检查错误可见，修正与持久版本恢复通过。并非汐自创。',task.task_id);
   if(!submission.submitted)throw Error('Development submission failed');
   const review=store.review(scope,task.task_id,true,'开发者仅验收合成闭环，不代表汐自然使用满意度；未合并任何生产源码。');
   const publication=store.publish(scope,project.project_id,project.version,'trusted-local-development-acceptance');
   result={development_acceptance:true,task,project,initial_error_codes:firstCheck.errors.map(e=>e.code),fixed_version:fixedVersion,restored_version:project.version,receipt_id:submission.receipt_id,review,publication,not_authored_by_whale:true,qq_messages_sent:0};
  }
 }else throw Error('Use dispatch, tasks, review, or seed-development');
 console.log(JSON.stringify(result,null,2));
}finally{store.close();}
