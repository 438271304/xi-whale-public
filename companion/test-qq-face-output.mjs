import assert from 'node:assert/strict';
import {selectNativeFaces,findNativeFaces,buildNativeMessage,nativeSummary} from './qq-face-output.mjs';

let network=0;const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{network++;throw Error('Pure packing must not fetch');};
try{
 assert.deepEqual(selectNativeFaces([66]),[{id:'66',name:'爱心'}]);
 assert.deepEqual(selectNativeFaces(['000066',351,512]).map(face=>face.name),['爱心','敲敲','王者召唤']);
 assert.deepEqual(selectNativeFaces([0,0]),[{id:'0',name:'惊讶'},{id:'0',name:'惊讶'}]);
 for(const ids of [[],[66,66,66,66],null,'66',[999999],['😊'],['[CQ:face,id=66]'],['66,large=1'],[-1],[1.5],[NaN],[Infinity],['1e2'],[{}]])assert.throws(()=>selectNativeFaces(ids));

 assert.equal(findNativeFaces('爱心').matches[0].id,'66');
 assert.equal(findNativeFaces('/菜狗').matches[0].id,'317');
 assert.equal(findNativeFaces('骚扰').matches[0].name,'戳一戳');
 assert.deepEqual(findNativeFaces('000066').matches,[{id:'66',name:'爱心',aliases:[]}]);
 assert.equal(findNativeFaces('999999').total,0);
 assert.equal(findNativeFaces('not a known face').matches.length,0);
 const first=findNativeFaces(''),second=findNativeFaces('',first.next_offset);
 assert.equal(first.matches.length,20);assert.equal(first.total,407);assert.equal(first.next_offset,20);assert.equal(second.matches.length,20);assert.notEqual(first.matches[0].id,second.matches[0].id);
 assert.match(first.source.version,/snowluma-2\.1\.1/);assert.equal(findNativeFaces('',99999).matches.length,0);
 for(const args of [[null],[66],['x'.repeat(101)],['',-1],['',0.5],['',NaN],['','20']])assert.throws(()=>findNativeFaces(...args));

 const selected=selectNativeFaces([66]);
 assert.deepEqual(buildNativeMessage({faces:selected}),[{type:'face',data:{id:'66'}}]);
 assert.deepEqual(buildNativeMessage({faces:[351]}),[{type:'face',data:{id:'351'}}]);
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
 const mixed=buildNativeMessage({text:'看这个',faces:selected,imageBytes:bytes,replyMessageId:-123});
 assert.deepEqual(mixed,[{type:'reply',data:{id:'-123'}},{type:'text',data:{text:'看这个'}},{type:'face',data:{id:'66'}},{type:'image',data:{file:'base64://'+bytes.toString('base64')}}]);
 assert.deepEqual(Buffer.from(mixed[3].data.file.slice(9),'base64'),bytes);
 assert.deepEqual(buildNativeMessage({imageBytes:new Uint8Array([1,2,3])}),[{type:'image',data:{file:'base64://AQID'}}]);
 assert.deepEqual(buildNativeMessage({text:'[CQ:face,id=66][CQ:image,file=file:///secret]'}),[{type:'text',data:{text:'[CQ:face,id=66][CQ:image,file=file:///secret]'}}]);
 assert.equal(buildNativeMessage({text:'Literal',replyMessageId:'-99999999999999999999'})[0].data.id,'-99999999999999999999');
 for(const input of [{},{text:''},{text:' \n '},{replyMessageId:1},{text:[]},{faces:[{id:66,name:'伪造名'}]},{faces:[{id:66,name:'爱心',cq:'injected'}]},{faces:[{id:'[CQ:face,id=66]'}]},{faces:['😊']},{faces:[999999]},{text:'x',replyMessageId:'[CQ:reply,id=1]'},{text:'x',replyMessageId:1.5},{text:'x',replyMessageId:'1\n2'},{imageBytes:'https://example.org/image.png'},{imageBytes:'C:/secret'},{imageBytes:'base64://AQID'},{imageBytes:Buffer.alloc(0)},{imageBytes:[]},{imageBytes:Buffer.alloc(8*1024*1024+1)}])assert.throws(()=>buildNativeMessage(input));
 let getters=0;const hostile={};Object.defineProperty(hostile,'id',{enumerable:true,get(){getters++;return 66;}});assert.throws(()=>buildNativeMessage({faces:[hostile]}));assert.equal(getters,0);
 const summary=nativeSummary(selected);assert.match(summary,/QQ原生表情/);assert.match(summary,/爱心（编号66）/);assert.match(summary,/名称来源/);assert.match(summary,/snowluma-2\.1\.1/);
 assert.equal(nativeSummary([]),'');assert.throws(()=>nativeSummary([{id:66,name:'假名字'}]));assert.equal(network,0);
 console.log('PASS mapped native-face selection, bounded name/alias/ID lookup, pure face/text/image/reply packing, literal CQ text, canonical names, injection/unknown refusal, named provenance memory summary; no network/model/QQ');
}finally{globalThis.fetch=originalFetch;}
