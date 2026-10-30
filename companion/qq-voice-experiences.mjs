// A machine transcript is a source-linked observation of received speech.
// It never replaces the original QQ message, changes its speaker, or claims
// that the account sending a recording is the person whose voice it contains.
export function rememberQQVoice(cognition,result){
 const source=result?.source,segments=result?.transcript?.segments;
 if(!['transcribed','partial'].includes(result?.status)||!source||!Array.isArray(segments)||!segments.some(s=>s.state==='transcribed'&&s.text))return {status:'not-recorded'};
 if(!/^(group|private):\d{5,15}$/.test(source.scope)||!/^\d{5,15}$/.test(source.author_id)||!Number.isSafeInteger(source.at)||!Number.isSafeInteger(source.index)||!result.media?.sha256)throw Error('Voice observation lacks original source');
 const payload={source,media:{sha256:result.media.sha256,duration_seconds:result.media.duration_seconds},machine_transcription:true,recording_voice_identity_verified:false,
  segments:segments.map(({start_ms,end_ms,text,state})=>({start_ms,end_ms,text,state})),whole_record_processed:result.whole_record_processed,
  unprocessed_ranges:result.transcript.unprocessed_ranges,audio_understood:false,non_speech_understood:false,notice:result.notice};
 const record=cognition.store.recordMessage({scope:source.scope,event:'voice:'+source.event+':'+source.index,role:'user',senderId:source.author_id,at:source.at,
  text:JSON.stringify(payload),source:'received-qq-machine-speech',revisionKind:'enrichment',sourceRef:{event:source.event,index:source.index,media_sha256:result.media.sha256},
  metadata:{original_event:source.event,record_index:source.index,machine_transcription:true,recording_voice_identity_verified:false}});
 return {status:'recorded',...record};
}
