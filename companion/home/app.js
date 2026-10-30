const $=id=>document.getElementById(id);
const text=(id,value)=>$(id).textContent=value;
function list(id,values,empty){const root=$(id);root.replaceChildren();for(const s of values?.length?values:[empty]){const li=document.createElement('li');li.textContent=s;root.append(li);}}
const names={'deepseek-bao-jing-shui-jiao.png':'困了，晚安','deepseek-bixin.png':'和你聊得来','deepseek-bu-lai.png':'不赖嘛','deepseek-da-ku.png':'有点委屈','deepseek-jushou-dazhaohu.png':'嗨，来啦','deepseek-touding-wenhao.png':'诶？','deepseek-zhangkai-shuangshou-huanhu.png':'好耶！'};
let loading=false,lifeLoading=false,innerLoading=false;
async function refresh(){if(loading)return;loading=true;$('refresh').disabled=true;void refreshLife();void Promise.resolve().then(refreshInnerLife);try{const r=await fetch('/api/home',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();text('fresh','读取于 '+new Date(d.at).toLocaleTimeString('zh-CN'));text('issues',d.issues.join(' · '));text('online',!d.runtime.online?'暂时联系不上':d.runtime.paused?'正在暂停':d.runtime.phase==='idle'?'在这里，等下一阵浪':'正在忙着');text('mood',d.card.mood||'心情，留给她自己写');text('energy',d.card.energy||'尚未记录精力，不估一个数字');text('today',d.card.today||'这一页留白，等汐自己来布置。');text('wish',d.card.wish||'等她冒出一个自己的主意。');text('cardtime',d.card_updated?'展示卡文件更新于 '+new Date(d.card_updated).toLocaleString('zh-CN'):'尚无展示卡 · 不等于没有心情');list('interests',d.card.interests,'尚未选择展示，不急着填满');list('learned',d.card.learned,'这里等她放进值得记住的小发现');text('collectioncount',`资料目录共 ${d.collection_count} 张图片 · 不是全部公开收藏`);const root=$('stickers');if(root.dataset.files!==JSON.stringify(d.stickers)){root.replaceChildren();root.dataset.files=JSON.stringify(d.stickers);for(const f of d.stickers){const fig=document.createElement('figure');fig.className='sticker';const img=document.createElement('img');img.src='/stickers/'+encodeURIComponent(f);img.alt=names[f]||'鲸鱼娘表情';img.loading='lazy';const cap=document.createElement('figcaption');cap.textContent=img.alt;fig.append(img,cap);root.append(fig);}}if(d.budget){const b=d.budget;text('spent','¥ '+b.settled.toFixed(3));text('budget',`今日已核算 ${b.calls} 次调用 · ${b.cap===null?'未设置每日费用上限':'每日上限 ¥'+b.cap}`);text('pending',`另有 ¥${b.pending.toFixed(2)} 未知费用预留（${b.pending_count} 笔，含历史未结项）`);}else{text('spent','暂不可读');text('budget','');text('pending','');}renderConversation(d);renderCognition(d);void refreshWorkroom();list('backups',d.backups.map(b=>new Date(b.at).toLocaleString('zh-CN')+' · '+(b.portable?'可迁移加密 · ':'旧本机加密 · ')+b.name),'尚未找到本机快照');}catch{text('fresh','读取失败 · 页面可能保留上次内容');text('issues','本地小窝服务暂时不可用。显示内容可能已过时。');}finally{loading=false;$('refresh').disabled=false;}}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});document.querySelectorAll('.panel').forEach(panel=>panel.hidden=panel.id!==b.dataset.tab);}));$('refresh').addEventListener('click',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);

function renderConversation(d){
 const c=d.conversations;
 if(d.runtime.online&&!d.runtime.paused&&d.runtime.qq_connected!==true)text('online','核心在线 · QQ连接待恢复');
 else if(d.runtime.online&&!d.runtime.paused&&d.runtime.qq_route_ready===false)text('online','QQ已连接 · 聊天服务待恢复');
 if(!c?.available){text('chatstate','聊天状态暂不可读');text('chatcounts','');text('chatlast','');text('chatdetail','不能据此判断她没收到消息。');return;}
 const labels={accepted:'收到，结果待确认',completed:'最近一轮已发送',quiet:'最近一轮选择安静',expired:'最近一轮未发送：许可失效或暂停',failed:'最近一轮处理或发送未完成'};
 text('chatstate',!c.received?'新模块尚未收到聊天':labels[c.last_state]||'状态待确认');
 text('chatcounts',`收到 ${c.received} 轮 · 确认发送 ${c.sent_turns} 轮 · 安静 ${c.quiet} 轮`);
 text('chatlast',c.last_received_at?'最近收到：'+new Date(c.last_received_at).toLocaleString('zh-CN'):'正常聊天后，这里会更新。');
 text('chatdetail',`未完成 ${c.failed} 轮 · 中止 ${c.expired} 轮 · 投递不确定 ${c.uncertain} 轮`+(c.unresolved?' · 较早未结项 '+c.unresolved+' 轮，需核对':'')+(c.processing_candidates?' · 近期 '+c.processing_candidates+' 轮结果待确认':''));
}

async function refreshWorkroom(){
 try{
  const response=await fetch('/api/workroom',{cache:'no-store'});if(!response.ok)throw Error();
  const data=await response.json(),root=$('workroom-projects');root.replaceChildren();
  text('workroom-status',data.projects.length?'展示 '+data.projects.length+' 件作品／半成品':'还没有作品，半成品也可以直接展示。');
  for(const project of data.projects){
   if(!/^[0-9a-f-]{36}$/.test(project.id))continue;
   const card=document.createElement('article'),title=document.createElement('h2'),label=document.createElement('p'),version=document.createElement('small'),link=document.createElement('a');
   title.textContent=project.title;label.textContent=project.label;version.textContent=(project.snapshot_kind==='draft'?'基于版本 '+project.version+' 的独立草稿':'版本 '+project.version)+' · '+new Date(project.at).toLocaleString('zh-CN');
   link.textContent='打开作品';link.href=/^\/workroom\/[0-9a-f-]{36}(?:\?(?:draft=[0-9a-f-]{36}|version=\d+))?$/.test(project.url)?project.url:'/workroom/'+project.id;link.target='_blank';link.rel='noopener noreferrer';link.className='workroom-open';
   const validation=document.createElement('p');const progress={saved:'已保存',queued:'排队中',running:'进行中',completed:'已完成',awaiting_review:'已产出（历史状态）',failed:'未完成',paused:'已暂停',cancelled:'已取消',interrupted:'已中断',conflict:'版本有分支'};validation.textContent='进度：'+(progress[project.progress]||'待核对')+'；'+(project.validation||'未验证运行');card.append(title,label,version,validation,document.createElement('br'),link);root.append(card);
  }
 }catch{text('workroom-status','作品架暂时读不到，请稍后刷新。');$('workroom-projects').replaceChildren();}
}

function renderCognition(d){
 const c=d.cognition;if(!c?.available){text('cognition-state','成长记录暂不可读');return;}
 const labels={awaiting_review:'已产出（历史状态）',working:'进行中',ready:'已准备',sending:'正在送达',completed:'已完成',paused:'已暂停',cancelled:'已取消',interrupted:'中断待续',failed:'待处理',quiet:'选择安静',planning:'想做什么',reading:'正在阅读',unfinished:'暂未完成','delivery-uncertain':'送达待核对','continuation-requested':'准备续做','awaiting-input':'等新想法'};
 const states=x=>Object.entries(x||{}).map(([k,v])=>(labels[k]||'其他')+' '+v).join(' · ')||'暂无记录';
 text('cognition-state','同一个汐，带着经历继续相处');
 text('cognition-memory',`已索引 ${c.memory.messages??0} 条经历、${c.memory.attachments??0} 张附件，${c.memory.state_versions??0} 次自我状态记录`);
 text('cognition-tasks','作品进度：'+states(c.tasks)+'；异步工坊：'+states(c.workshop?.states)+(c.workshop?.execution_enabled?(c.workshop?.dsh_execution_enabled?'（离线执行、DSH规划与公开资料读取可用）':'（本机离线执行可用）'):'（执行尚未开放）'));text('cognition-life','探索活动：'+states(c.activities)+'；待续公开问题：'+states(c.public_followups)+(c.bilibili?.tools_installed?'；B站：公开字幕／'+(c.bilibili.frame_decoder_installed?'两帧画面抽样':'画面解码依赖缺失')+(c.bilibili.speech_model_installed?'／按片段本地语音转写已配置':'／语音转写依赖未齐')+'；不代表完整视听理解':''));
 const z=c.qzone,read=z?.read?.state,pub=z?.publication?.state;
 text('cognition-space',z?.tools_installed?'QQ空间：文字草稿／发表通道已接；'+(read==='read'?'已读取自己的动态':read==='not-read'?'尚未读取':read==='login-error'||read==='identity-mismatch'?'账号连接待处理':'读取待核对')+'；'+(pub==='verified'?'正文已回读确认，未独立确认可见范围':pub==='uncertain'?'发表结果待核对，不会自动重发':'尚无确认发表回执'):'QQ空间通道尚未接入');
 text('cognition-last',c.latest_activity?'最近活动记录：'+new Date(c.latest_activity).toLocaleString('zh-CN'):'自主探索尚无活动记录');
}

function lifeTime(value){
 if(!Number.isFinite(value)||value<0)return '时间尚未记下';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '时间尚未记下';
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
function renderLife(data){
 const posts=$('life-posts'),steps=$('life-heartbeats');posts.replaceChildren();steps.replaceChildren();
 if(!data?.available){
  text('life-connection',data?.status==='temporarily-unavailable'?'记录暂时读不到':'尚未连接');
  text('life-post-empty',data?.status==='temporarily-unavailable'?'她留下的文字暂时读不到，稍后再来看看。':'生活记录尚未连接，这里先留一点空白。');
  $('life-post-empty').hidden=false;text('life-next','下一次考虑机会，等记录接通后再看。');return;
 }
 text('life-connection','这些是她选择留下的记录');
 const entries=Array.isArray(data.posts)?data.posts.slice(0,12):[];
 $('life-post-empty').hidden=entries.length>0;text('life-post-empty','她还没有选择把短文放在这里，不急着填满。');
 for(const post of entries){
  if(typeof post.text!=='string')continue;
  const card=document.createElement('article'),body=document.createElement('p'),time=document.createElement('time');card.className='life-post';
  body.textContent=post.text.slice(0,1200);time.textContent=lifeTime(post.created);
  if(Number.isFinite(post.created))time.dateTime=new Date(post.created).toISOString();card.append(body,time);posts.append(card);
 }
 const choices={create:'摆弄自己的小作品',rest:'安静待一会儿',quiet:'安静待一会儿',explore:'去看看感兴趣的事',exploration:'去看看感兴趣的事',journal:'留一点自己的文字',reflect:'回望今天的小发现',review:'回望今天的小发现',share:'想起一件想分享的事',corner:'给小角落留一段话',publish:'给小角落留一段话',later:'留到以后再想',discard:'这次先放下',keep_quiet:'安静待一会儿'};
 const states={finished:'已留下记录',thinking:'正在考虑',completed:'已留下记录',done:'已留下记录',quiet:'选择安静',running:'正在慢慢做',failed:'这次暂未完成',interrupted:'暂时停下',paused:'暂时停下',skipped:'这次先歇一歇'};
 for(const heartbeat of (Array.isArray(data.heartbeats)?data.heartbeats:[]).slice(0,6)){
  const item=document.createElement('li'),title=document.createElement('p'),reason=document.createElement('p'),time=document.createElement('time');
  title.className='life-step-title';title.textContent=(choices[heartbeat.choice]||'给自己留一点时间')+(states[heartbeat.state]?' · '+states[heartbeat.state]:'');
  reason.className='life-step-reason';reason.textContent=typeof heartbeat.reason==='string'?heartbeat.reason.slice(0,180):'这次没有另外展示原因。';
  time.textContent=lifeTime(heartbeat.at);if(Number.isFinite(heartbeat.at))time.dateTime=new Date(heartbeat.at).toISOString();
  item.append(title,reason,time);steps.append(item);
 }
 if(!steps.childElementCount){const item=document.createElement('li');item.textContent='还没有留下最近活动的记录。';steps.append(item);}
 text('life-next',Number.isFinite(data.next_at)&&data.next_at>Date.now()?'下一次考虑机会：'+lifeTime(data.next_at):'下一次考虑机会，等她再留个时间。');
}
async function refreshLife(){
 if(lifeLoading)return;lifeLoading=true;
 try{const response=await fetch('/api/life',{cache:'no-store'});if(!response.ok)throw Error();renderLife(await response.json());}
 catch{renderLife({available:false,status:'temporarily-unavailable'});}
 finally{lifeLoading=false;}
}

function renderInnerLife(data){
 const inner=data?.inner_state,interests=data?.interests,sharing=data?.sharing,availability=data?.availability;
 const state=inner?.state;
 text('inner-mood',!inner?.available?'状态记录暂时读不到':state?.mood||'还没有记下这类心情');
 const energy={low:'想慢一点',steady:'精力平稳',high:'有些精神'},curiosity={quiet:'暂时安静',curious:'有点好奇',absorbed:'正被什么吸引'};
 text('inner-energy',state?[energy[state.energy],curiosity[state.curiosity]].filter(Boolean).join(' · '):'留白不表示她没有想法。');
 text('inner-time',state?.at?'记录于 '+lifeTime(state.at)+' · 第 '+state.revision+' 版':'等她自己有想留下的状态。');
 const items=interests?.items??[];
 list('inner-interests',items.map(item=>(item.text||item.interpretation||'一件尚未写清的小事')+(item.at?' · '+lifeTime(item.at):'')),interests?.available?'这里暂时留白。':'兴趣记录暂时读不到。');
 const labels={queued:'先留着',sending:'投递中',sent:'已发送',uncertain:'结果待确认',discarded:'已经放下',deferred:'等待时机'},names={family:'家庭群',father:'老爹',mother:'妈妈'};
 text('inner-share-counts',sharing?.available?Object.entries(sharing.counts??{}).map(([key,value])=>(labels[key]||key)+' '+value).join(' · ')||'还没有留下联系意图。':'联系记录暂时读不到。');
 const targets=Object.entries(sharing?.recipients??{}).filter(([,v])=>v?.state).map(([key,value])=>names[key]+'：'+(labels[value.state]||value.state)+(value.updated?' · '+lifeTime(value.updated):''));
 list('inner-share-targets',targets,sharing?.available?'一个念头可以只说给一个人。':'暂时无法确认上次联系。');
 text('inner-contact',['father','mother'].map(key=>{const value=availability?.[key];return names[key]+'：'+(!value?.available?'暂停状态暂不可读':!value.active?'可以主动联系':value.expires?'暂停至 '+lifeTime(value.expires):'按明确请求暂停主动联系');}).join('；'));
}
async function refreshInnerLife(){
 if(innerLoading)return;innerLoading=true;
 try{const response=await fetch('/api/inner-life',{cache:'no-store'});if(!response.ok)throw Error();renderInnerLife(await response.json());}
 catch{renderInnerLife(null);}finally{innerLoading=false;}
}
