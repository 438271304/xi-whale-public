// Single assembly point for the replacement QQ path. Construction never connects QQ.
import {join} from 'node:path';
import {isolatedQQRoute} from './isolated-qq-route.mjs';
import {conversationExtras,importStickerSeeds} from './conversation-extras.mjs';
import {qqScopedAttachments} from './qq-scoped-attachments.mjs';
import {migrateScopedHistory} from './migrate-scoped-history.mjs';
import {bindRouteLifecycle} from './route-lifecycle.mjs';
import {createImageAnalyzer} from './image-analysis.mjs';
import imageCapabilities from './image-capabilities.json' with {type:'json'};
import {publicTopics} from './social-rhythm.mjs';
import socialConfig from './social-config.json' with {type:'json'};
export function prepareScopedAssembly({world,root,workspace,sourceData,client,publicProfile,operatingContract,policy,ledger,ownsLedger=false,manifest,assets,fetcher=fetch,clock}){
 if(typeof publicProfile!=='string'||!publicProfile.trim())throw Error('Reviewed public identity required');
 const route=isolatedQQRoute(world,{root,client,publicProfile,operatingContract,policy,ledger,ownsLedger,clock,startPaused:true,
  socialConfig,socialTopics:()=>publicTopics(workspace),
  imageAnalyzer:createImageAnalyzer({client,visionEnabled:imageCapabilities.vision_enabled===true}),
  extraTools:conversationExtras({workspace,notesRoot:join(root,'notes'),familyGroup:policy.group_id,fetcher,workroomPath:join(root,'workroom.sqlite3'),policy,publicClient:client}),
  attachments:qqScopedAttachments({fetcher})});
 // Synchronous factory required by WorldDefinition.create; no transport has started.
 try{
  const stickers=importStickerSeeds(route.service.media,{manifest,assets});
  const history=migrateScopedHistory(route.service.history,sourceData);
  const cognition=route.service.cognition.sync();
  let lifecycle;
  return {...route,get closed(){return route.closed;},receipt:{status:'prepared-paused-not-started',stickers,history,cognition},
   attachCore(core){
    if(lifecycle)throw Error('Core lifecycle already attached');
    if(!core?.bus?.isPaused())throw Error('Pause core before attaching isolated QQ');
    lifecycle=bindRouteLifecycle(core.bus,route);return lifecycle;
   },
   async drain(){if(lifecycle)await lifecycle.drain();await route.pause();}
  };
 }catch(error){void route.world.stop().catch(()=>{});throw error;}
}
