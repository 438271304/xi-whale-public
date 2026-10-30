import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
export function trustedImageUrl(raw){
 if(typeof raw!=='string'||raw.length>8192)throw Error('untrusted-image-url');
 let url;try{url=new URL(raw);}catch{throw Error('untrusted-image-url');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='qpic.cn'||url.hostname.endsWith('.qpic.cn')||['multimedia.nt.qq.com','multimedia.nt.qq.com.cn'].includes(url.hostname)))throw Error('untrusted-image-url');return url;
}
export function publicImageAddress(address){
 const family=isIP(address);
 if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2))||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
 return false;
}
export async function secureImageFetch(raw,{signal,maxBytes=8*1024*1024,resolver=lookup,requestImpl=request,validateUrl=trustedImageUrl,headers={}}={}){
 const url=validateUrl(raw);signal?.throwIfAborted();
 let abort;
 const stopped=new Promise((_,reject)=>{abort=()=>reject(Error('download-timeout'));signal?.addEventListener('abort',abort,{once:true});});
 let addresses;try{addresses=await Promise.race([resolver(url.hostname,{all:true,verbatim:true}),stopped]);}finally{signal?.removeEventListener('abort',abort);}
 signal?.throwIfAborted();
 if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!publicImageAddress(a.address)))throw Error('unsafe-image-address');
 const selected=addresses.find(a=>a.family===4)??addresses[0];
 return new Promise((resolve,reject)=>{
  let ended=false;const finish=(error,response)=>{if(ended)return;ended=true;signal?.removeEventListener('abort',cancel);error?reject(error):resolve(response);};
  const complete=(body,status,headers)=>{try{if(!Number.isInteger(status)||status<200||status>599)throw Error();finish(null,new Response([204,205,304].includes(status)?null:body,{status,headers}));}catch{finish(Error('download-failed'));}};
  const cancel=()=>{req.destroy();finish(Error('download-timeout'));};
  const req=requestImpl(url,{method:'GET',headers,servername:url.hostname,rejectUnauthorized:true,signal,lookup:(_host,options,callback)=>callback(null,options?.all?[{address:selected.address,family:selected.family}]:selected.address,...(options?.all?[]:[selected.family]))},response=>{
   const status=response.statusCode??502,headers={'content-type':String(response.headers['content-type']??'')};
   if(status<200||status>=300){response.resume();complete(null,status,headers);return;}
   if(Number(response.headers['content-length']??0)>maxBytes){req.destroy();finish(Error('Image too large'));return;}
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy();finish(Error('Image too large'));}else chunks.push(chunk);});
   response.on('end',()=>complete(Buffer.concat(chunks),status,headers));response.on('error',()=>finish(Error('download-failed')));
  });
  req.on('error',()=>finish(Error(signal?.aborted?'download-timeout':'download-failed')));signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}req.end();
 });
}
