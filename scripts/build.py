#!/usr/bin/env python3
"""Merge portable source snapshots into a mode-scoped, cross-platform topic library."""
import argparse,copy,json,re,hashlib
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
def read(p): return json.loads(p.read_text())
def save(p,d): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
FAMILIES=[
 ('combat','动作攻防','击退与淘汰','knockback','用位移、碰撞或击退改变对手的生存空间。','NPC 需要判断距离、危险边缘与攻击时机。'),
 ('combat','动作攻防','瞄准与资源限制','shoot','瞄准攻击与躲避，同时管理武器、弹药或射击机会。','NPC 需要选目标、控制命中率并遵守弹药规则。'),
 ('combat','动作攻防','读招与反击','duel','依据对手动作选择进攻、防守、闪避与反击。','NPC 需要有可读的意图、反应延迟与失误。'),
 ('space','空间与节奏','共享威胁与传递','relay','把同一个危险物或倒计时压力传给另一位参与者。','NPC 需要识别威胁、判断传递时机，不能提前知道隐藏目标。'),
 ('space','空间与节奏','建造与有限干扰','build','各自推进建造，通过有限干扰改变对手处境。','NPC 需要选择搭建位置，并决定何时释放干扰。'),
 ('space','空间与节奏','竞速与路线争夺','race','在路径、检查点或比赛名次上竞争，部分模式允许干扰。','NPC 需要走合法路线，处理障碍、超越与恢复。'),
 ('resource','资源与策略','回合决策与瞄准','turn','轮流规划移动、攻击或资源投入，再接受结果。','NPC 需要评估合法行动及近期收益。'),
 ('resource','资源与策略','卡牌与隐蔽信息','cards','用手牌、资源和规则组合竞争，双方掌握的信息可能不同。','NPC 只能使用自己的信息，对未知状态做估计。'),
 ('resource','资源与策略','占领、争抢与经营','territory','通过争抢资源、占领空间或破坏对手发展取得优势。','NPC 需要平衡扩张、收益与防守。'),
 ('space','空间与节奏','控球、攻门与守分','sport','控制共享球的方向，攻破对手目标并守住自己的得分或生命。','NPC 需要预判球的路线、选择进攻角度并及时回防。'),
 ('judgment','判断与表达','寻找、推理与博弈','puzzle','通过线索、猜测或搜寻争取更早完成目标。','NPC 的解题过程必须有依据，避免全知答案。'),
 ('judgment','判断与表达','表达、欺骗与评价','social','利用表达、隐藏意图、协商或他人评价争胜。','NPC 需要连贯行为与情境理解，通常应先缩小规则。'),
 ('judgment','判断与表达','独立表现与比成绩','performance','各自完成操作，再比较表现或得分。','需先确认是否需要场上 NPC；纯分数比较可能属于影子挑战。'),
 ('review','待整理资料','模式待拆分','mixed','现有卡片尚不能归入明确的独立对抗模板。','先拆分合作、组队与个人竞争模式，再评估 NPC。'),
 ('archive','非目标资料','合作、生活与共同成长','other','保留原始资料用于追溯，本轮不作为独立对抗选题。','若另有独立对抗模式，需要单独提供规则依据。')]

def family(text,scope):
 if scope=='excluded':return 'other'
 pairs=[('relay','反弹|来球|传递|炸弹|传物|relay|ball'),('build','搭建|搭塔|建造.*干扰|障碍.*竞争|stack|tower|build-and'),('cards','卡牌|手牌|凑目标|牌库|deck|card|麻将|mahjong'),('turn','轮流|回合|瞄准.*射击|artillery|tactics'),('knockback','击退|击落|击飞|淘汰|knock|arena-elimination'),('shoot','射击|狙击|枪|瞄准|shooter|weapon'),('duel','格斗|近战|反击|读招|连击|duel|fighter'),('race','竞速|赛车|赛道|race|racing|跑酷'),('territory','占领|领土|资源|经营|帝国|成长|偷取|争抢|conquest|empire|steal'),('social','欺骗|投票|配音|表达|创作|协商|social|deception'),('puzzle','猜|解谜|搜索|搜寻|寻宝|推理|puzzle|search'),('performance','成绩|节奏|高尔夫|钓鱼|rhythm|score|golf')]
 for k,p in pairs:
  if re.search(p,text,re.I):return k
 return 'mixed'

STEAM_MAP = {'arena-elimination': 'knockback', 'b-arena-combat': 'knockback', 'c-move-survival': 'knockback', 'ranged-duel': 'shoot', 'build-duel': 'duel', 'e-fighting-duel': 'duel', 'c-hot-potato': 'relay', 'c-ball-return': 'relay', 'build-race': 'build', 'physics-stacking': 'build', 'race-interference': 'race', 'a-height-race': 'race', 'e-race-finish': 'race', 'turn-tactics': 'turn', 'tableau-engine': 'cards', 'deck-building': 'cards', 'd-hand-shedding': 'cards', 'd-hand-completion': 'cards', 'economy-negotiation': 'territory', 'asymmetric-factions': 'territory', 'a-map-development': 'territory', 'e-realtime-conquest': 'territory', 'hidden-role': 'social', 'social-disruption': 'social', 'd-prompt-vote': 'social', 'b-puzzle-grid': 'puzzle', 'b-puzzle-collection': 'puzzle', 'c-search-race': 'puzzle', 'd-trivia-elimination': 'puzzle', 'e-competitive-deduction': 'puzzle', 'd-score-duel': 'performance', 'd-score-race': 'performance', 'd-sports-score': 'sport', 'e-sports-match': 'sport', 'd-minigame-series': 'mixed', 'e-party-challenge': 'mixed'}

def rb_assessment(a,tid):
 text=' '.join(a.get(k,'') for k in ('summary','rules','result','multiplayer'))
 base=dict(level='unknown',scope='unclear',reason='资料尚不足以确认独立玩家对抗及完整的结果规则。',npcTasks='先明确对手的输入、行为、信息和胜负。',risks='不能凭游戏名称或对抗题材认定有独立 PvP。',prototype='锁定具体模式后，再验证 NPC 的替代行为。',reviewMethod='text_rule_screen',playtestStatus='untested',nativeBotSupport='not_assessed',sourceIds=sorted({s for f in ('rules','result','multiplayer') for s in a.get('evidence',{}).get(f,[])}),basis='现有文本初筛；评级为设计推断，未经原型测试。')
 if re.search('队友|团队|组队|敌队|小队|分队|共同防守|协作|合作',a.get('multiplayer','')):
  base.update(level='not_applicable',scope='non_target',reason='当前多人描述包含人类队友协作或阵营分工，先排除本轮独立对抗。')
 elif re.search('角色扮演|社交|展示|交易|共同建设|参观|一起.*探索',a.get('multiplayer','')) and not re.search('对抗|攻击|争夺|获胜',text):
  base.update(level='not_applicable',scope='non_target',reason='当前卡片主要是社交、交易或共同生活，未提供独立竞技规则。')
 return base

def build():
 steam=read(ROOT/'data/steam-source.json');rb=read(ROOT/'data/roblox-source.json');reviews=read(ROOT/'data/roblox-reviews.json');games={};modes={}
 for g in steam['games']:
  games[g['id']]={k:g.get(k) for k in ('id','name','displayName','url','icon')};games[g['id']].update(platform='steam',modes=[],description=g.get('shortDescription') or g.get('description',''))
 st={x['id']:x for x in steam['templates']}
 for mid,original in steam['modes'].items():
  m=copy.deepcopy(original);a=m['npcSuitability'];scope='eligible' if a['level'] in ('high','medium','low') and a['scope']=='independent' else 'excluded' if a['level']=='not_applicable' else 'pending'
  ts=[{**st[x['templateId']],'scope':x['scope']} for x in steam['links'] if x['modeId']==mid]
  m.update(platform='steam',scope=scope,originalTemplates=ts,sourceId=mid)
  m['templateId']='other' if scope=='excluded' else next((STEAM_MAP[x['id']] for x in ts if x['id'] in STEAM_MAP),family(m['name']+' '+m['summary'],scope))
  specific={'steam:743450/main':'social','steam:2622000/main':'cards','steam:774461/main':'social','steam:1495860/main':'social','steam:5053820/main':'performance','steam:1755580/main':'social','steam:94400/main':'duel','steam:1812090/escape-race':'puzzle'}
  if scope!='excluded' and mid in specific:m['templateId']=specific[mid]
  if not re.search('[\u4e00-\u9fff]',m['name']):m['originalModeName']=m['name'];m['name']=ts[0]['name'] if ts else '原卡记录的模式'
  modes[mid]=m;games[m['gameId']]['modes'].append(mid)
 for g in rb['games']:
  gid='roblox:'+g['id'];games[gid]={'id':gid,'name':g['name'],'displayName':g.get('displayName',g['name']),'url':g['url'],'icon':g.get('icon'),'platform':'roblox','modes':[],'description':g.get('description','')}
 rt={x['id']:x for x in rb['templates']}
 for oldid,a in rb['analyses'].items():
  gid='roblox:'+oldid;mid=gid+'/documented';npc=rb_assessment(a,a['primaryTemplateId']);review=reviews.get(oldid)
  if review:
   assert review['fingerprint']==hashlib.sha256(json.dumps(a,ensure_ascii=False,sort_keys=True).encode()).hexdigest(), 'Roblox review stale: '+oldid
   npc.update({k:v for k,v in review.items() if k!='fingerprint'})
  scope='eligible' if npc['level'] in ('high','medium','low') else 'excluded' if npc['level']=='not_applicable' else 'pending'
  ts=[{**rt[x['templateId']],'scope':x['scope']} for x in rb['links'] if x['gameId']==oldid]
  m=copy.deepcopy(a);m.update(id=mid,gameId=gid,platform='roblox',scope=scope,name=review.get('modeName','已记录的玩法范围') if review else '已记录的玩法范围',sourceId=oldid,npcSuitability=npc,originalTemplates=ts,templateId=family(' '.join(x['name'] for x in ts),scope),minPlayers=None,maxPlayers=None,participation=[],relationships=[],status='text_reviewed',playerCountNote='原资料未按模式确认人数；服务器容量不作为参与人数。')
  if review and review.get('templateId'):m['templateId']=review['templateId']
  modes[mid]=m;games[gid]['modes'].append(mid)
 cats={};templates=[]
 for cat,cn,tn,tid,desc,task in FAMILIES:
  cats[cat]={'id':cat,'name':cn};templates.append({'id':tid,'category':cat,'name':tn,'description':desc,'npcTask':task})
 for m in modes.values():
  if m['scope']=='eligible':assert m['npcSuitability']['sourceIds']
  trusted={s['id'] for s in m['sources'] if s.get('verification') in ('text_read','video_observed')}
  assert set(m['npcSuitability']['sourceIds'])<=trusted,m['id']
 assert len(games)==len(steam['games'])+len(rb['games'])
 def stats(ms):return {'modes':len(ms),'games':len({m['gameId'] for m in ms})}
 meta={'builtAt':datetime.now(timezone.utc).isoformat(),'catalogCount':len(games),'analysisCount':sum(bool(g['modes']) for g in games.values()),'modeCount':len(modes),'platforms':{p:{'catalog':sum(g['platform']==p for g in games.values()),'analyzed':sum(g['platform']==p and bool(g['modes']) for g in games.values())} for p in ('steam','roblox')},'scopeCounts':{s:stats([m for m in modes.values() if m['scope']==s]) for s in ('eligible','pending','excluded')},'assessmentCounts':{s:stats([m for m in modes.values() if m['npcSuitability']['level']==s]) for s in ('high','medium','low','unknown','not_applicable')},'sourceBuilds':{'steam':steam['meta']['builtAt'],'roblox':rb['meta']['builtAt']}}
 d={'schemaVersion':1,'meta':meta,'games':list(games.values()),'modes':modes,'categories':list(cats.values()),'templates':templates}
 (ROOT/'dist/prompts').mkdir(parents=True, exist_ok=True)
 for prompt in (ROOT/'prompts').glob('*.md'):(ROOT/'dist/prompts'/prompt.name).write_text(prompt.read_text())
 save(ROOT/'dist/library.json',d); (ROOT/'dist/data.js').write_text('window.TOPIC_LIBRARY='+json.dumps(d,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')+';\n');save(ROOT/'data/summary.json',meta);print(json.dumps(meta,ensure_ascii=False))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--import-local',type=Path);args=parser.parse_args()
 if args.import_local:
  for p in ('steam','roblox'):save(ROOT/f'data/{p}-source.json',read(args.import_local/f'{p}-library/dist/library.json'))
 build()
