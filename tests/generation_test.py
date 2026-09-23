# -*- coding: utf-8 -*-
import importlib.util,json,tempfile,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('generator',ROOT/'server/generator.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
GAME='roblox:universe:4538598064';MODE=GAME+'/documented'
PLAN='# 示例策划\n'+'\n'.join(g.REQUIRED)+'\n'+'明确的原型建议规则。'*180
class GenerationTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.old=g.JOBS;g.JOBS=Path(self.temp.name)
 def tearDown(self):g.JOBS=self.old;self.temp.cleanup()
 def job(self):
  with patch.object(threading.Thread,'start'):m=g.create_job({'gameId':GAME,'modeId':MODE})
  return g.JOBS/m['id']
 def ready(self):
  job=self.job();g.save_plan(job,PLAN,0,'测试初稿');g.update(job,status='plan_ready');return job
 def fake_plan(self,job,prompt,out,stage):
  self.assertIn('ai-draft.md',prompt);(job/'ai-draft.md').write_text(PLAN[:700]);self.assertEqual(g.workspace(job)['aiDraft'],PLAN[:700]);(job/out).write_text(PLAN)
 def test_context_and_mode_isolation(self):
  c=g.context_for(GAME,MODE);self.assertEqual(c['selectedMode']['id'],MODE);self.assertIn('description',c['originalGameRecord']);self.assertTrue(c['selectedMode']['sources'])
  with self.assertRaises(ValueError):g.context_for(GAME,'steam:728880/coop')
  with self.assertRaises(ValueError):g.context_for(GAME,None)
 def test_plan_finishes_without_image_and_exposes_draft(self):
  job=self.job()
  with patch.object(g,'run_cli',side_effect=self.fake_plan) as cli:g.plan_worker(job,True)
  self.assertEqual(cli.call_count,1);m=g.workspace(job);self.assertEqual(m['status'],'plan_ready');self.assertEqual(m['plan'],PLAN);self.assertEqual(m['planRevision'],1);self.assertFalse(m['imageReady']);self.assertFalse((job/'image-prompt.md').exists())
 def test_dedup_and_global_lock(self):
  job=self.job()
  with patch.object(threading.Thread,'start'):
   self.assertEqual(g.create_job({'gameId':GAME,'modeId':MODE})['id'],job.name)
   with self.assertRaises(ValueError):g.create_job({'gameId':GAME,'modeId':MODE,'brief':'新方向'})
  g.update(job,status='revising')
  with self.assertRaises(ValueError):g.create_job({'gameId':GAME,'modeId':MODE})
 def test_manual_save_during_initial_is_never_overwritten(self):
  job=self.job()
  def run(job,prompt,out,stage):g.save_plan(job,'玩家自己写的规则',0);(job/out).write_text(PLAN)
  with patch.object(g,'run_cli',side_effect=run):g.plan_worker(job,True)
  d=g.workspace(job);self.assertEqual(d['plan'],'玩家自己写的规则');self.assertEqual(d['proposal'],PLAN);self.assertTrue(d['proposalId'])
 def test_suggestions_queue_during_initial(self):
  job=self.job();g.revise(job,{'message':'改成 90 秒一局'})
  def run(job,prompt,out,stage):(job/out).write_text(PLAN if stage=='planning' else PLAN+'\n90 秒一局')
  with patch.object(g,'run_cli',side_effect=run) as cli:g.plan_worker(job,True)
  self.assertEqual(cli.call_count,2);d=g.workspace(job);self.assertEqual(d['plan'],PLAN);self.assertIn('90 秒',d['proposal']);self.assertEqual(d['messages'][0]['status'],'done')
 def test_optimistic_save_history_and_stale_image(self):
  job=self.ready();g.update(job,imageReady=True,imageRevision=1)
  g.save_plan(job,PLAN+'\n我的规则',1)
  with self.assertRaises(g.Conflict):g.save_plan(job,'过期正文',1)
  d=g.workspace(job);self.assertEqual(d['planRevision'],2);self.assertTrue(d['imageStale']);self.assertEqual((job/'versions/1.md').read_text(),PLAN)
 def test_image_requires_explicit_action_and_snapshots_current_plan(self):
  job=self.ready();g.save_plan(job,PLAN+'\n新规则',1)
  with patch.object(threading.Thread,'start'):
   d=g.start_image(job,{'revision':2,'imagePrompt':'水彩 {{完整策划案}}'})
  self.assertEqual(d['status'],'imaging');self.assertEqual((job/'image-plan.md').read_text(),PLAN+'\n新规则');self.assertEqual((job/'image-prompt.md').read_text(),'水彩 '+PLAN+'\n新规则')
  g.save_plan(job,PLAN+'\n生图期间编辑',2)
  def image(job,prompt,out,stage):(job/'reference.png').write_bytes(b'\x89PNG\r\n\x1a\n'+b'x'*10001)
  with patch.object(g,'run_cli',side_effect=image):g.image_worker(job)
  d=g.workspace(job);self.assertTrue(d['imageStale']);self.assertEqual(d['imageRevision'],2);self.assertEqual(d['planRevision'],3)
 def test_image_rejects_stale_revision_pending_proposal_and_busy(self):
  job=self.ready()
  with self.assertRaises(g.Conflict):g.start_image(job,{'revision':0})
  g.update(job,proposalId='pending')
  with self.assertRaises(ValueError):g.start_image(job,{'revision':1})
  g.update(job,proposalId=None,status='revising')
  with self.assertRaises(ValueError):g.start_image(job,{'revision':1})
 def test_image_failure_keeps_plan_and_previous_image(self):
  job=self.ready();(job/'image-prompt.md').write_text('原图提示词');image=b'\x89PNG\r\n\x1a\n'+b'p'*11000;(job/'reference.png').write_bytes(image);g.update(job,imageReady=True,imageRevision=1)
  with patch.object(threading.Thread,'start'):g.start_image(job,{'revision':1})
  with patch.object(g,'run_cli',side_effect=RuntimeError('图片失败')):g.image_worker(job)
  self.assertEqual((job/'image-prompt.md').read_text(),'原图提示词');self.assertEqual((job/'reference.png').read_bytes(),image);self.assertEqual((job/'plan.md').read_text(),PLAN);self.assertEqual(g.workspace(job)['failedStage'],'image')
 def test_default_and_custom_render(self):
  template=g.image_template();self.assertEqual(template,(ROOT/'dist/prompts/reference-image.md').read_text());rendered=g.render_image_prompt(template,PLAN)
  self.assertIn('手机竖屏（9:16）',rendered);self.assertIn('画面内所有文字使用英文',rendered);self.assertNotIn('{{',rendered);self.assertNotIn('16:9',rendered)
  self.assertEqual(g.render_image_prompt('画 {{完整策划案}}','{{风格、角色或参考图；未填时按策划确定}}'),'画 {{风格、角色或参考图；未填时按策划确定}}')
  self.assertTrue(g.render_image_prompt('水彩',PLAN).endswith(PLAN))
  for bad in ['',[], '字'*16001]:
   with self.assertRaises(ValueError):g.image_template(bad)
 def test_http_edit_proposal_history_and_auth(self):
  server=g.ThreadingHTTPServer(('127.0.0.1',0),g.Handler);oldport=g.PORT;oldorigins=g.ORIGINS;g.PORT=server.server_address[1];origin=f'http://127.0.0.1:{g.PORT}';g.ORIGINS={origin};threading.Thread(target=server.serve_forever,daemon=True).start()
  def call(path,data=None,headers=None):
   h=headers or {'Origin':origin,'Authorization':'Bearer '+g.TOKEN,'Content-Type':'application/json'}
   req=urllib.request.Request(origin+path,headers=h,data=json.dumps(data).encode() if data is not None else None)
   try:
    with urllib.request.urlopen(req) as r:return r.status,json.loads(r.read())
   except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
  try:
   self.assertEqual(call('/api/session',headers={'Origin':'https://evil.example'})[0],403)
   self.assertEqual(call('/api/session',headers={'Origin':origin,'Host':'evil.example'})[0],403)
   self.assertEqual(call('/api/jobs',headers={'Origin':origin})[0],403)
   self.assertEqual(call('/api/session')[1]['workflowVersion'],2)
   job=self.ready();prefix='/api/jobs/'+job.name
   code,d=call(prefix+'/plan',{'plan':'字'*16000,'revision':1});self.assertEqual(code,200);self.assertEqual(d['planRevision'],2)
   self.assertEqual(call(prefix+'/plan',{'plan':'过期','revision':1})[0],409)
   (job/'proposal.md').write_text(PLAN+'\nAI 建议');g.update(job,proposalId='proposal')
   self.assertEqual(call(prefix+'/proposal',{'apply':True,'proposalId':'old','revision':2})[0],409)
   code,d=call(prefix+'/proposal',{'apply':True,'proposalId':'proposal','revision':2});self.assertEqual(code,202);self.assertIn('AI 建议',d['plan']);self.assertIsNone(d['proposalId'])
   self.assertEqual(call(prefix+'/version?revision=1')[1]['plan'],PLAN)
   self.assertEqual(call(prefix+'/restore',{'version':1,'revision':3})[1]['planRevision'],4)
   self.assertEqual(call(prefix+'/workspace')[1]['plan'],PLAN)
   self.assertEqual(call(prefix+'/version?revision=../job')[0],400)
   with patch.object(g,'plan_worker'):
    self.assertEqual(call(prefix+'/revise',{'message':'减少技能'})[0],202)
    self.assertEqual(call(prefix+'/image',{'revision':4})[0],400)
   g.update(job,status='plan_ready',messages=[])
   with patch.object(g,'image_worker'):
    code,d=call(prefix+'/image',{'revision':4,'imagePrompt':'竖屏水彩 {{完整策划案}}'});self.assertEqual(code,202);self.assertEqual(d['status'],'imaging')
    self.assertEqual((job/'image-prompt.md').read_text(),'竖屏水彩 '+PLAN)
  finally:server.shutdown();server.server_close();g.PORT=oldport;g.ORIGINS=oldorigins
if __name__=='__main__':unittest.main()
