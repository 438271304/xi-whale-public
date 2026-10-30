// Called only on transport-admitted OneBot image segments, never model-supplied URLs.
import {trustedImageUrl,secureImageFetch} from './qq-image-download.mjs';
export function qqScopedAttachments({fetcher=fetch,maxBytes=8*1024*1024}={}){
 let active=0;
 return async(message,{limit=4}={})=>{
  const count=Number.isInteger(limit)?Math.max(0,Math.min(4,limit)):0;
  const all=(message.message??[]).filter(s=>['image','mface','bface','sface'].includes(s.type)),segments=all.slice(0,count),images=[];
  const states=[];Object.defineProperty(images,'intake',{value:states,enumerable:false});
  if(all.length>count)states.push({state:'not-received',reason:count<4?'batch-image-limit':'per-message-image-limit',count:all.length-count});
  if(active>=2){for(let i=0;i<segments.length;i++)states.push({index:i,state:'not-received',reason:'download-busy'});return images;}
  active++;
  try{for(const [index,segment] of segments.entries()){
   let reader;
   try{
    const source=segment.data?.url??segment.data?.file;
    if(!source){states.push({index,state:'not-received',reason:'missing-transport-url'});continue;}
    let url;try{url=trustedImageUrl(source);}catch{states.push({index,state:'not-received',reason:'untrusted-transport-url'});continue;}
    const response=await (fetcher===fetch?secureImageFetch(url.href,{signal:AbortSignal.timeout(8000),maxBytes}):fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(8000)}));
    if(!response.ok){states.push({index,state:'not-received',reason:'http-rejected',http_status:response.status});continue;}
    if(!/^(image\/(png|jpeg|gif|webp)|application\/octet-stream)(;|$)/i.test(response.headers.get('content-type')??'')){states.push({index,state:'not-received',reason:'unsupported-content-type'});continue;}
    reader=response.body?.getReader();if(!reader){states.push({index,state:'not-received',reason:'empty-response'});continue;}
    const chunks=[];let total=0;
    while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>maxBytes)throw Error('Image too large');chunks.push(part.value);}
    const bytes=Buffer.concat(chunks);
    // Ensure malformed bytes do not make ConversationService discard the text message.
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const gif=['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString());
    const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(bytes.length>=12&&(png||jpeg||gif||webp)){images.push(bytes);states.push({index,state:'received',analysis:'not-analyzed'});}
    else states.push({index,state:'not-received',reason:'invalid-image-signature'});
   }catch(error){states.push({index,state:'not-received',reason:error?.message==='Image too large'?'image-too-large':error?.message==='unsafe-image-address'?'unsafe-network-address':error?.message==='download-timeout'||['AbortError','TimeoutError'].includes(error?.name)?'download-timeout':'download-failed'});}
   finally{await reader?.cancel().catch(()=>{});}
  }}finally{active--;}
  return images;
 };
}
