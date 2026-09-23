# -*- coding: utf-8 -*-
"""Explicitly copy one completed local job into the publishable static site."""
import json, re, shutil, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if len(sys.argv)!=2 or not re.fullmatch('[a-f0-9]{32}',sys.argv[1]):raise SystemExit('用法：python3 scripts/publish_generated.py <任务ID>')
job=ROOT/'.local/jobs'/sys.argv[1];meta=json.loads((job/'job.json').read_text())
if meta['status']!='complete':raise SystemExit('只能发布完整完成的任务')
base=ROOT/'dist/generated';target=base/job.name;target.mkdir(parents=True,exist_ok=True)
for name in ['plan.md','reference.png','image-prompt.md','context.json','planning-input.md']:shutil.copy2(job/name,target/name)
if (job/'image-template.md').exists():shutil.copy2(job/'image-template.md',target/'image-template.md')
meta={k:v for k,v in meta.items() if k not in {'fingerprint','error'}};meta['base']='generated/'+job.name+'/'
(target/'manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
index=base/'index.json';items=json.loads(index.read_text()) if index.exists() else []
items=[x for x in items if x['id']!=meta['id']];items.insert(0,meta);index.write_text(json.dumps(items,ensure_ascii=False,indent=2))
print('已准备发布：'+str(target))
