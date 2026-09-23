import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
d=json.loads((root/'dist/library.json').read_text());g={x['id']:x for x in d['games']};m=d['modes'];t={x['id'] for x in d['templates']}
assert len(g)==len(d['games'])==8749
assert len(m)==1552
assert sum(bool(x['modes']) for x in g.values())==1530
for mid,x in m.items():
 assert x['gameId'] in g and mid in g[x['gameId']]['modes']
 assert x['templateId'] in t
 assert x['platform']==g[x['gameId']]['platform']
 if x['scope']=='eligible':
  assert x['npcSuitability']['level'] in ['high','medium','low']
  assert x['npcSuitability']['scope']=='independent'
  assert not {'teams','cooperation'}&set(x['relationships'])
 assert set(x['npcSuitability']['sourceIds'])<={s['id'] for s in x['sources'] if s.get('verification') in ('text_read','video_observed')}
assert m['steam:2211170/versus']['scope']=='excluded'
assert m['roblox:universe:2619619496/documented']['scope']=='excluded'
assert m['roblox:universe:4777817887/documented']['npcSuitability']['level']=='high'
assert m['roblox:universe:3266003774/documented']['scope']=='pending'
for scope,counts in d['meta']['scopeCounts'].items():
 ms=[x for x in m.values() if x['scope']==scope]
 assert counts=={'modes':len(ms),'games':len({x['gameId'] for x in ms})}
assert all(x['maxPlayers'] is None for x in m.values() if x['platform']=='roblox')
print('PASS: identities, source preservation, scope separation, independent opposition, evidence, counts, unknown player capacity')
