"""Read only the pinned QQ plugin's protocol lamp; never infer it from roster."""
def qq_connection(worlds):
    rows=worlds.get('worlds',[]) if isinstance(worlds,dict) else worlds
    qq=next((w for w in rows if w.get('id')=='qq'),{})
    lamps=qq.get('lamps')
    protocol=lamps[0].get('state','unknown') if isinstance(lamps,list) and lamps and isinstance(lamps[0],dict) else 'unknown'
    return dict(qq=qq.get('status'),qq_connected=qq.get('status')=='active' and protocol=='online',qq_protocol_state=protocol)
