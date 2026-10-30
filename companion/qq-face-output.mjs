// Pure native-face selection and OneBot packing. No transport, URLs or CQ parser.
import faceMap from './qq-face-map.json' with {type:'json'};

const source=Object.freeze({kind:'pinned-qq-native-face-map',version:faceMap.version});
const PAGE_SIZE=20,MAX_IMAGE_BYTES=8*1024*1024;
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key)?.value;
function nativeId(value){
 const valid=typeof value==='string'?/^\d{1,6}$/.test(value):typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=999999;
 if(!valid)throw Error('Use a mapped numeric native QQ face ID');
 const id=String(Number(value));
 if(!Object.hasOwn(faceMap.names,id))throw Error('Unknown native QQ face ID');
 return id;
}
export function selectNativeFaces(ids){
 if(!Array.isArray(ids)||ids.length<1||ids.length>3)throw Error('Select one to three native QQ faces');
 return ids.map(value=>{const id=nativeId(value);return {id,name:faceMap.names[id]};});
}
function checkedFaces(faces){
 if(!Array.isArray(faces)||faces.length>3)throw Error('Use up to three selected native QQ faces');
 if(!faces.length)return [];
 return faces.map(value=>{
  if(value&&typeof value==='object'){
   if(Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!['id','name'].includes(key)))throw Error('Invalid selected native face');
   const selected=selectNativeFaces([own(value,'id')])[0],givenName=own(value,'name');
   if(givenName!==undefined&&givenName!==selected.name)throw Error('Selected native face name does not match its mapped ID');
   return selected;
  }
  return selectNativeFaces([value])[0];
 });
}
export function findNativeFaces(query,offset=0){
 if(typeof query!=='string'||query.length>100)throw Error('Use a short native QQ face search query');
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid face search offset');
 const needle=query.trim().replace(/^\//,'').toLowerCase();
 const numeric=/^\d{1,6}$/.test(needle)?String(Number(needle)):null;
 const matches=Object.entries(faceMap.names).sort(([a],[b])=>Number(a)-Number(b)).filter(([id,name])=>!needle||(numeric!==null?id===numeric:[name,...(faceMap.aliases?.[id]??[])].some(label=>label.toLowerCase().includes(needle))));
 return {matches:matches.slice(offset,offset+PAGE_SIZE).map(([id,name])=>({id,name,aliases:[...(faceMap.aliases?.[id]??[])]})),total:matches.length,next_offset:offset+PAGE_SIZE<matches.length?offset+PAGE_SIZE:null,source:{...source}};
}
function replyId(value){
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('Invalid quoted QQ message ID');return String(value);}
 if(typeof value!=='string'||! /^-?\d{1,20}$/.test(value))throw Error('Invalid quoted QQ message ID');
 return value;
}
export function buildNativeMessage({text='',faces=[],imageBytes=null,replyMessageId=null}={}){
 if(typeof text!=='string')throw Error('QQ text must be a literal string');
 const selected=checkedFaces(faces),message=[];
 let image=null;
 if(imageBytes!==null){
  if(!(imageBytes instanceof Uint8Array)||!imageBytes.byteLength||imageBytes.byteLength>MAX_IMAGE_BYTES)throw Error('An image must contain bounded existing bytes, not a URL/path');
  image=Buffer.from(imageBytes).toString('base64');
 }
 if(!text.trim()&&!selected.length&&image===null)throw Error('A QQ message needs text, a native face or image bytes');
 if(replyMessageId!==null)message.push({type:'reply',data:{id:replyId(replyMessageId)}});
 if(text.length)message.push({type:'text',data:{text}});
 for(const face of selected)message.push({type:'face',data:{id:face.id}});
 if(image!==null)message.push({type:'image',data:{file:'base64://'+image}});
 return message;
}
export function nativeSummary(faces){
 const selected=checkedFaces(faces);if(!selected.length)return '';
 return '[QQ原生表情：'+selected.map(face=>face.name+'（编号'+face.id+'）').join('、')+'；名称来源：'+source.kind+' / '+source.version+'；目录名称不代表已知发送者心理]';
}
