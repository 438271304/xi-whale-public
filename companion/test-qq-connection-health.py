import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'home'))
from qq_health import qq_connection
for module,lamps,expected in [
    ('active',[{'state':'online'},{'state':'offline'}],True),
    ('active',[{'state':'error'},{'state':'online'}],False),
    ('active',[],False),('inactive',[{'state':'online'}],False),
]:
    actual=qq_connection({'worlds':[dict(id='qq',status=module,lamps=lamps)]})
    assert actual['qq_connected'] is expected,actual
assert qq_connection({'worlds':[]})['qq_connected'] is False
print('PASS viewer requires actual protocol link; module/roster online alone never means connected')
