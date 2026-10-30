// Fixed local API, no arbitrary URL or file access and no accounting disclosures.
export function homeTools(workspaceTools, {fetcher=fetch}={}) {
  const fields={mood:{type:'string',maxLength:400},energy:{type:'string',maxLength:400},today:{type:'string',maxLength:400},wish:{type:'string',maxLength:400},interests:{type:'array',maxItems:8,items:{type:'string',maxLength:200}},learned:{type:'array',maxItems:8,items:{type:'string',maxLength:200}}};
  async function read() {
    try {
      const response=await fetcher('http://127.0.0.1:17790/api/home',{signal:AbortSignal.timeout(4000),redirect:'error'});
      if(!response.ok)throw Error('unavailable');
      const data=await response.json();
      return {status:'read',observed_at:data.at,card_updated:data.card_updated??null,card:data.card??{},stickers:data.stickers??[],issues:data.issues??[],scope:'Current home page data, not a screenshot. Budget, backups and private conversations are omitted.'};
    } catch {return {status:'unavailable',message:'小窝服务暂不可读；不表示卡片没保存。不要声称看过页面。'};}
  }
  return [
    {name:'home_read',description:'看看你的小窝当前实际展示的卡片和表情列表。返回网页数据，不是视觉截图。无参数，不需要外网。',tags:['read'],parameters:{type:'object',properties:{},additionalProperties:false},handler:async()=>JSON.stringify(await read())},
    {name:'home_update',description:'布置你自己的小窝展示卡。只写愿意展示的自己，不填家人或朋友私事。完整替换卡片：先home_read看旧内容，保留想保留的字段。写后读回核对，失败不谎报成功。不必每轮更新。',tags:['write'],parameters:{type:'object',properties:fields,additionalProperties:false},handler:async(args,ctx)=>{
      for(const [k,v] of Object.entries(args)){
        if(!Object.hasOwn(fields,k))return '[home update failed] Unknown field';
        if(['interests','learned'].includes(k)){
          if(!Array.isArray(v)||v.length>8||v.some(x=>typeof x!=='string'||x.length>200))return '[home update failed] Invalid list';
        }else if(typeof v!=='string'||v.length>400)return '[home update failed] Invalid text';
      }
      const writer=workspaceTools.find(t=>t.name==='write_file');
      if(!writer)return '[home update failed] Workspace writer unavailable';
      const receipt=await writer.handler({path:'projects/home/card.json',content:JSON.stringify(args,null,2)},ctx);
      if(!String(receipt).startsWith('[written]'))return receipt;
      const actual=await read();
      const verified=actual.status==='read'&&JSON.stringify(Object.entries(actual.card).sort())===JSON.stringify(Object.entries(args).sort());
      return JSON.stringify({saved:true,page_readback_verified:verified,page:actual});
    }}
  ];
}
