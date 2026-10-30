const $=id=>document.getElementById(id);
const text=(id,value)=>$(id).textContent=value;
function list(id,values,empty){const root=$(id);root.replaceChildren();for(const s of values?.length?values:[empty]){const li=document.createElement('li');li.textContent=s;root.append(li);}}
const names={'deepseek-bao-jing-shui-jiao.png':'困了，晚安','deepseek-bixin.png':'和你聊得来','deepseek-bu-lai.png':'不赖嘛','deepseek-da-ku.png':'有点委屈','deepseek-jushou-dazhaohu.png':'嗨，来啦','deepseek-touding-wenhao.png':'诶？','deepseek-zhangkai-shuangshou-huanhu.png':'好耶！'};
const capabilityGroups={public_web:'看世界',ordinary_tieba:'看世界',claw:'看世界',bilibili_subtitles:'读视频',bilibili_frames:'读视频',bilibili_speech:'读视频',qzone_read:'自己的空间',qzone_publish:'自己的空间',own_workshop:'自己动手',proactive_faces:'主动交流',proactive_images:'主动交流',own_profile:'自己的模样',qq_voice:'听语音'};
const capabilityCodes={
 'service-closed':'服务已关闭','service-paused':'服务目前暂停','route-not-ready':'聊天入口还未就绪','adapter-not-connected':'这个入口尚未接通','credential-reader-not-configured':'尚未配置所需平台凭证','reader-not-connected':'读取入口尚未接通','frame-dependencies-unavailable':'画面读取组件未齐','speech-dependencies-unavailable':'本机语音组件未齐','workshop-paused':'工作间暂停中','workshop-runtime-unavailable':'工作间执行器未就绪',
 'access-unavailable':'这次平台访问未成功','rate-limited':'这次访问遇到频率限制','reader-unavailable':'这次读取入口不可用','unsupported-source':'当前入口尚不支持该来源','no-usable-source':'这次没有取得可用内容','identity-mismatch':'当前账号与预期不符','login-error':'平台登录尚未接通','api-error':'这次平台接口未完成','invalid-response':'这次平台结果无法确认','closed':'入口已关闭','not-authorized':'该次操作尚未获授权','context-denied':'该次操作条件不满足','service-restart-after-send-reservation':'服务重启前的发送结果未确认',
 'not-configured':'还未配置','not-connected':'入口尚未接通','runtime-unavailable':'暂时读不到运行状态','paused':'目前暂停中','credential-missing':'缺少平台凭证','credentials-missing':'缺少平台凭证',
 'ordinary-access-unverified':'普通贴吧访问尚未验证','ordinary-tieba-unverified':'普通贴吧访问尚未验证','access-denied':'平台没有允许这次访问','http-403':'平台没有允许这次访问',
 'duration-over-limit':'语音超过本次五分钟转写范围','decoder-unavailable':'本机转写尚未就绪','voice-read-or-transcription-failed':'本次语音读取或转写未完成','wav-base64-unavailable':'桥接未返回可转写的音频','invalid-wav':'本次音频格式未能确认','invalid-transcript':'本次转写结果未能核验','speech-not-fully-transcribed':'本次没有取得完整语音文字','dependency-missing':'本机所需组件未齐','model-missing':'本机转写模型未齐','timeout':'这次等待超时','readback-unconfirmed':'发出后的结果仍未确认','readback-uncertain':'修改后的结果仍未确认',
 'uncertain':'结果仍未确认','failed':'这次尝试没有完成','interrupted':'这次尝试中断','failed-before-send':'发送前已停止','failed-or-uncertain':'这次操作未能确认结果',
 'provider-first-response-timeout':'等待模型响应超时','no-public-subtitles':'这段视频没有公开字幕','unavailable':'这次未能读取','configuration-incomplete':'配置还未齐全'
};
function capabilityTime(value){if(value===null||value===undefined)return '时间未记录';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'时间未记录';}
function renderCapabilities(data){
 const root=$('capability-cards');root.replaceChildren();root.dataset.stale=String(data?.status==='unavailable');
 text('capability-fresh',data?.observed_at?'读取于 '+capabilityTime(data.observed_at)+(data.status==='partial'?' · 有些信息尚不可读':''):'当前运行信息尚不可读');
 if(!Array.isArray(data?.items)||!data.items.length){const empty=document.createElement('p');empty.className='life-empty';empty.textContent='还没读到能力现状，先保留未知。';root.append(empty);return;}
 for(const item of data.items){
  if(!Object.hasOwn(capabilityGroups,item.key))continue;
  const card=document.createElement('article');card.className='capability-card';
  const label=document.createElement('div');label.className='label';label.textContent=capabilityGroups[item.key];
  const heading=document.createElement('h3');heading.textContent=item.label;
  const chips=document.createElement('div');chips.className='capability-chips';
  const config=item.configuration??{};
  for(const [key,yes,no,unknown] of [['configured','已配置','未配置','配置未知'],['available','此刻可用','此刻不可用','可用状态未知'],['autonomous','能自己用','自主入口未接','自主入口未知']]){
   const value=config[key],chip=document.createElement('span');chip.dataset.state=value===true?'yes':value===false?'no':'unknown';chip.textContent=value===true?yes:value===false?no:unknown;chips.append(chip);
  }
  const scope=document.createElement('p');scope.className='capability-scope';scope.textContent=item.scope||'具体范围尚未记录。';
  const timeline=document.createElement('dl');timeline.className='capability-history';
  const row=(title,value)=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value;timeline.append(dt,dd);};
  row('最近成功',item.last_success?capabilityTime(item.last_success.at):item.history_available===false?'历史记录暂不可读':'还没有可确认的记录');
  if(item.last_failure)row('最近未完成',capabilityTime(item.last_failure.at)+' · '+(capabilityCodes[item.last_failure.code]||'该次结果未确认完成'));
  if(item.blocker)row(item.blocker.basis==='latest-attempt'?'上次遇到的阻碍':'当前缺口',(capabilityCodes[item.blocker.code]||'具体原因尚未归类')+' · '+capabilityTime(item.blocker.observed_at));
  if(config.observed_at)row('运行观察',capabilityTime(config.observed_at));
  card.append(label,heading,chips,scope,timeline);root.append(card);
 }
}
let loading=false,lifeLoading=false,innerLoading=false;
$('life-open-workroom').addEventListener('click',()=>document.querySelector('[data-tab="workroom"]').click());
async function refresh(){if(loading)return;loading=true;$('refresh').disabled=true;void refreshLife();void Promise.resolve().then(refreshInnerLife);try{const r=await fetch('/api/home',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();text('fresh','读取于 '+new Date(d.at).toLocaleTimeString('zh-CN'));text('issues',d.issues.join(' · '));text('online',!d.runtime.online?'暂时联系不上':d.runtime.paused?'正在暂停':d.runtime.phase==='idle'?'在这里，等下一阵浪':'正在忙着');text('mood',d.card.mood||'心情，留给她自己写');text('energy',d.card.energy||'尚未记录精力，不估一个数字');text('today',d.card.today||'这一页留白，等汐自己来布置。');text('wish',d.card.wish||'等她冒出一个自己的主意。');text('cardtime',d.card_updated?'展示卡文件更新于 '+new Date(d.card_updated).toLocaleString('zh-CN'):'尚无展示卡 · 不等于没有心情');list('interests',d.card.interests,'尚未选择展示，不急着填满');list('learned',d.card.learned,'这里等她放进值得记住的小发现');text('collectioncount',`资料目录共 ${d.collection_count} 张图片 · 不是全部公开收藏`);const root=$('stickers');if(root.dataset.files!==JSON.stringify(d.stickers)){root.replaceChildren();root.dataset.files=JSON.stringify(d.stickers);for(const f of d.stickers){const fig=document.createElement('figure');fig.className='sticker';const img=document.createElement('img');img.src='/stickers/'+encodeURIComponent(f);img.alt=names[f]||'鲸鱼娘表情';img.loading='lazy';const cap=document.createElement('figcaption');cap.textContent=img.alt;fig.append(img,cap);root.append(fig);}}if(d.budget){const b=d.budget;text('spent','¥ '+b.settled.toFixed(3));text('budget',`今日已核算 ${b.calls} 次调用 · ${b.cap===null?'未设置每日费用上限':'每日上限 ¥'+b.cap}`);text('pending',`另有 ¥${b.pending.toFixed(2)} 未知费用预留（${b.pending_count} 笔，含历史未结项）`);}else{text('spent','暂不可读');text('budget','');text('pending','');}renderConversation(d);renderCognition(d);renderCapabilities(d.capabilities);void refreshWorkroom();list('backups',d.backups.map(b=>new Date(b.at).toLocaleString('zh-CN')+' · '+(b.portable?'可迁移加密 · ':'旧本机加密 · ')+b.name),'尚未找到本机快照');}catch{text('capability-fresh','本次读取失败 · 以下可能是上次记录');$('capability-cards').dataset.stale='true';text('fresh','读取失败 · 页面可能保留上次内容');text('issues','本地小窝服务暂时不可用。显示内容可能已过时。');}finally{loading=false;$('refresh').disabled=false;}}
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
 const spaceRead=d.capabilities?.items?.find(x=>x.key==='qzone_read'),spaceWrite=d.capabilities?.items?.find(x=>x.key==='qzone_publish');
 text('cognition-space','QQ空间：'+(spaceRead?.last_success?'最近读回 '+capabilityTime(spaceRead.last_success.at):'尚无可读的成功读取记录')+'；'+(spaceWrite?.last_success?'最近确认发表 '+capabilityTime(spaceWrite.last_success.at):'尚无可读的确认发表记录')+'。当前可用性与未完成记录见“能做什么”。');
 text('cognition-last',c.latest_activity?'最近活动记录：'+new Date(c.latest_activity).toLocaleString('zh-CN'):'自主探索尚无活动记录');
}

function lifeTime(value){
 if(!Number.isFinite(value)||value<0)return '时间尚未记下';
 const date=new Date(value);if(Number.isNaN(date.getTime()))return '时间尚未记下';
 return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
function lifeFacts(row){
 const levels={'search-lead':'搜索线索','page-text':'网页正文','thread-posts':'帖子正文',subtitles:'字幕','speech-transcript':'机器语音转写','sampled-frames':'抽样画面','metadata-only':'简介',unknown:'范围未记录'};
 const parts=[];
 if(Number.isSafeInteger(row.saved_source_count))parts.push('已保存 '+row.saved_source_count+' 条来源记录');
 if(row.reading_levels)parts.push(...Object.entries(row.reading_levels).filter(([,count])=>Number.isSafeInteger(count)&&count>0).map(([level,count])=>(levels[level]||'范围未知')+' '+count));
 return parts.join(' · ')||'尚无可确认的阅读记录';
}
function lifeOutcome(row){
 if(row.outcome==='creative-continuation-saved')return '已留下部分创作进度';
 if(row.outcome==='creative-workspace-updated')return '已保存创作步骤，执行结果另看工作间';
 if(row.state==='failed')return '本次未完成';
 if(['interrupted','paused'].includes(row.state))return '本次中断，保留已有记录';
 if(row.state==='thinking')return '机会已开始，结果尚未记录';
 if(row.activity_state==='completed'&&['explore','exploration'].includes(row.choice))return '发现已保存，问题未必已解决';
 if(row.activity_state==='unfinished')return '机会结束，仍有未完步骤';
 return row.state==='finished'?'本次机会已结束':'结果待核对';
}
function renderLife(data){
 const posts=$('life-posts'),steps=$('life-heartbeats');posts.replaceChildren();steps.replaceChildren();
 if(!data?.available){
  text('life-connection',data?.status==='temporarily-unavailable'?'记录暂时读不到':'尚未连接');
  text('life-post-empty',data?.status==='temporarily-unavailable'?'她留下的文字暂时读不到，稍后再来看看。':'生活记录尚未连接，这里先留一点空白。');
  $('life-post-empty').hidden=false;text('life-next','下一次考虑机会，等记录接通后再看。');text('life-last-record','最近记录日期尚不可读');
  for(const id of ['life-explorations','life-attempts','life-creative'])list(id,[],'记录暂不可读，不能据此判断没有活动。');return;
 }
 text('life-connection','这些是她选择留下的记录');
 text('life-last-record',data.last_recorded_day?'最近记录日期：'+data.last_recorded_day+' · '+lifeTime(data.last_recorded_at):'尚无有效时间的生活记录');
 const entries=Array.isArray(data.posts)?data.posts.slice(0,12):[];
 $('life-post-empty').hidden=entries.length>0;text('life-post-empty','她还没有选择把短文放在这里，不急着填满。');
 for(const post of entries){
  if(typeof post.text!=='string')continue;
  const card=document.createElement('article'),body=document.createElement('p'),time=document.createElement('time');card.className='life-post';
  body.textContent=post.text.slice(0,1200);time.textContent=lifeTime(post.created);
  if(Number.isFinite(post.created))time.dateTime=new Date(post.created).toISOString();card.append(body,time);posts.append(card);
 }
 const choices={create:'摆弄自己的小作品',rest:'安静待一会儿',quiet:'安静待一会儿',explore:'去看看感兴趣的事',exploration:'去看看感兴趣的事',journal:'留一点自己的文字',reflect:'回望今天的小发现',review:'回望今天的小发现',share:'想起一件想分享的事',corner:'给小角落留一段话',publish:'给小角落留一段话',later:'留到以后再想',discard:'这次先放下',keep_quiet:'安静待一会儿'};
 for(const heartbeat of (Array.isArray(data.heartbeats)?data.heartbeats:[]).slice(0,6)){
  const item=document.createElement('li'),title=document.createElement('p'),reason=document.createElement('p'),time=document.createElement('time');
  title.className='life-step-title';title.textContent=(choices[heartbeat.choice]||'给自己留一点时间')+' · '+lifeOutcome(heartbeat);
  reason.className='life-step-reason';reason.textContent=['explore','exploration'].includes(heartbeat.choice)?lifeFacts(heartbeat):'这里只展示已记录的状态。';
  time.textContent=lifeTime(heartbeat.at);if(Number.isFinite(heartbeat.at))time.dateTime=new Date(heartbeat.at).toISOString();
  item.append(title,reason,time);steps.append(item);
 }
 if(!steps.childElementCount){const item=document.createElement('li');item.textContent='还没有留下最近活动的记录。';steps.append(item);}
 const activities=Array.isArray(data.activities)?data.activities:[];
 const explored=activities.filter(row=>row.kind==='explore').slice(0,3).map(row=>lifeTime(row.updated)+' · '+(row.state==='completed'?'发现已保存':row.state==='failed'?'本次未完成':row.state==='interrupted'?'本次中断':'尚有未完步骤')+'；'+lifeFacts(row));
 list('life-explorations',explored,data.coverage?.activity_metadata_available?'最近几次机会中暂无探索记录。':'探索记录尚未接通。');
 const toolNames={public_fetch:'网页读取',public_search:'公开搜索',bilibili_read:'视频资料读取',bilibili_listen:'片段语音转写',bilibili_search:'视频搜索',bilibili_status:'视频入口检查',tieba_status:'帖子入口检查',tieba_list:'帖子列表',tieba_thread:'主题帖读取',tieba_floor:'楼层读取'};
 const attemptStates={ok:'返回成功',empty:'没有结果',partial:'只取得部分',failed:'本次失败',unavailable:'入口不可用',unconfigured:'入口未连接',interrupted:'本次中断'};
 list('life-attempts',(Array.isArray(data.attempts)?data.attempts:[]).slice(0,3).map(row=>lifeTime(row.at)+' · '+(toolNames[row.tool]||'读取尝试')+'：'+(attemptStates[row.status]||'状态待核对')),data.coverage?.attempt_metadata_available?'尚未记录新的读取尝试。':'尝试记录尚未接通，旧记录不倒推。');
 const creativeSteps={'space-opened':'查看了自己的工作间','saved-step':'已保存或提交一步，执行结果待核对','partial-step-saved':'留下部分进度，可以接着做'};
 list('life-creative',activities.filter(row=>row.kind==='create').slice(0,3).map(row=>lifeTime(row.updated)+' · '+(creativeSteps[row.creative_step]||(['failed','interrupted','unfinished'].includes(row.state)?'这次创作尚未完成':'创作机会已有记录，作品结果待核对'))),data.coverage?.activity_metadata_available?'最近几次机会中暂无创作记录。':'创作机会记录尚未接通。');
 text('life-next',data.schedule_state==='scheduled'&&Number.isFinite(data.next_at)?'下次考虑时间：'+lifeTime(data.next_at):data.schedule_state==='due'?'记录的考虑时间已到，是否开始以实际机会为准。':'尚无当前下次考虑时间。');
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
 const targets=Object.entries(sharing?.recipients??{}).filter(([,v])=>v?.state).map(([key,value])=>(names[key]||value.label||'其他联系对象')+'：'+(labels[value.state]||value.state)+(value.updated?' · '+lifeTime(value.updated):''));
 list('inner-share-targets',targets,sharing?.available?'一个念头可以只说给一个人。':'暂时无法确认上次联系。');
 const contactRows=[...['father','mother'].map(key=>({label:names[key],...availability?.[key]})),...(availability?.others??[])];
 text('inner-contact',contactRows.map(value=>(value.label||'好友')+'：'+(!value.available?'暂停状态暂不可读':!value.active?'未记录主动暂停':value.expires?'暂停至 '+lifeTime(value.expires):'按明确请求暂停主动联系')).join('；'));
}
async function refreshInnerLife(){
 if(innerLoading)return;innerLoading=true;
 try{const response=await fetch('/api/inner-life',{cache:'no-store'});if(!response.ok)throw Error();renderInnerLife(await response.json());}
 catch{renderInnerLife(null);}finally{innerLoading=false;}
}
