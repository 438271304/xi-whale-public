// Wrap existing QQ history tools with explicit query coverage; never infer total from a page.
import {historyFetchTool,historyArchiveTool} from './qq-history-fetch.mjs';
export function installHistoryCoverage(world,options){
 const original=world.tools;
 world.tools=function(){return [...original.call(this).map(tool=>{
  if(!['qq_read_history','qq_grep_history'].includes(tool.name))return tool;
  return {...tool,description:tool.description+' Returned rows are a bounded query, NOT the entire conversation. For earlier history remove unintended time filters and use the numeric conversation id. Empty results do not prove no history exists.',handler:async(args,ctx)=>{
   const result=await tool.handler(args,ctx);
   return `[History query scope: conversation=${args.conversation??'all locally recorded QQ conversations'}; from=${args.from_time??'no lower time bound'}; to=${args.to_time??'no upper time bound'}; limit=${args.limit??(tool.name==='qq_read_history'?50:5)}. This is NOT a total message count. Local records may omit offline/uncollected messages. Do not claim earlier messages never existed.]\n${result}`;
  }};
 }),historyFetchTool(this,options),historyArchiveTool(this,options)];};return world;
}
