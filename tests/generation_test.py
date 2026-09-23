# -*- coding: utf-8 -*-
import importlib.util, json, tempfile, threading, unittest, urllib.request, urllib.error
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('generator', ROOT/'server/generator.py'); g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
GAME='roblox:universe:4538598064'; MODE=GAME+'/documented'
class GenerationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.old=g.JOBS;g.JOBS=Path(self.temp.name)
 def tearDown(self):g.JOBS=self.old;self.temp.cleanup()
 def test_context_and_mode_isolation(self):
  c=g.context_for(GAME,MODE);self.assertEqual(c['selectedMode']['id'],MODE);self.assertIn('description',c['originalGameRecord']);self.assertTrue(c['selectedMode']['sources'])
  with self.assertRaises(ValueError):g.context_for(GAME,'steam:728880/coop')
  with self.assertRaises(ValueError):g.context_for(GAME,None)
  steam=next(x for x in g.GAMES.values() if x['platform']=='steam' and len(x['modes'])>1)
  c=g.context_for(steam['id'],steam['modes'][0]);self.assertEqual(len(c['otherModesForBackgroundOnly']),len(steam['modes'])-1);self.assertIsNotNone(c['originalGameRecord'])
 def test_duplicate_click_and_busy(self):
  with patch.object(threading.Thread,'start'):
   a=g.create_job({'gameId':GAME,'modeId':MODE});b=g.create_job({'gameId':GAME,'modeId':MODE});self.assertEqual(a['id'],b['id'])
   with self.assertRaises(ValueError):g.create_job({'gameId':GAME,'modeId':MODE,'brief':'新要求'})
  prompt=(g.JOBS/a['id']/'planning-input.md').read_text();self.assertIn('(UPD) Phantom Ball',prompt);self.assertIn('otherModesForBackgroundOnly',prompt)
 def test_image_failure_keeps_plan_and_retry_skips_planning(self):
  with patch.object(threading.Thread,'start'): m=g.create_job({'gameId':GAME,'modeId':MODE})
  job=g.JOBS/m['id'];plan='\n'.join(g.REQUIRED)+'\n'+'原型建议规则。'*300
  def fake(job,prompt,out,stage):
   if stage=='planning':(job/out).write_text(plan)
   else:raise RuntimeError('图像工具失败')
  with patch.object(g,'run_cli',side_effect=fake) as runner:g.generate(job);self.assertEqual(runner.call_count,2)
  state=g.read_json(job/'job.json');self.assertTrue(state['planReady']);self.assertEqual(state['failedStage'],'image');self.assertEqual((job/'plan.md').read_text(),plan)
  with patch.object(g,'run_cli',side_effect=RuntimeError('仍不可用')) as runner:
   g.generate(job,True);self.assertEqual(runner.call_count,1);self.assertEqual(runner.call_args.args[3],'imaging')
 def test_http_origin_host_and_authorization(self):
  server=g.ThreadingHTTPServer(('127.0.0.1',0),g.Handler);oldport=g.PORT;oldorigins=g.ORIGINS;g.PORT=server.server_address[1];origin=f'http://127.0.0.1:{g.PORT}';g.ORIGINS={origin};threading.Thread(target=server.serve_forever,daemon=True).start()
  def call(path,headers={},data=None):
   req=urllib.request.Request(origin+path,headers=headers,data=data)
   try:
    with urllib.request.urlopen(req) as r:return r.status,r.read()
   except urllib.error.HTTPError as e:return e.code,e.read()
  try:
   self.assertEqual(call('/api/session',{'Origin':'https://evil.example'})[0],403)
   self.assertEqual(call('/api/session',{'Origin':origin,'Host':'attacker.example'})[0],403)
   self.assertEqual(call('/api/jobs',{'Origin':origin})[0],403)
   status,data=call('/api/session',{'Origin':origin});self.assertEqual(status,200);token=json.loads(data)['token']
   h={'Origin':origin,'Authorization':'Bearer '+token,'Content-Type':'application/json'}
   self.assertEqual(call('/api/jobs?gameId='+GAME+'&modeId='+MODE,h)[0],200)
   self.assertEqual(call('/api/jobs',h,b'{"gameId":"missing"}')[0],400)
   self.assertEqual(call('/api/jobs',{'Origin':'https://evil.example','Authorization':'Bearer '+token,'Content-Type':'application/json'},b'{}')[0],403)
   self.assertEqual(call('/api/jobs/'+'a'*32+'/../../.env',h)[0],404)
  finally:server.shutdown();server.server_close();g.PORT=oldport;g.ORIGINS=oldorigins
if __name__=='__main__':unittest.main()
