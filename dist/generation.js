(()=>{'use strict';
const BASE='http://127.0.0.1:8771';
let token='',epoch=0,pollTimer,urls=[],busy=false,lastSignature='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);

let defaultImagePromptPromise;
function defaultImagePrompt(){if(!defaultImagePromptPromise)defaultImagePromptPromise=fetch('prompts/reference-image.md?v=20260923-portrait-en').then(r=>{if(!r.ok)throw Error('默认提示词加载失败');return r.text();}).catch(e=>{defaultImagePromptPromise=null;throw e;});return defaultImagePromptPromise;}
function currentImagePrompt(){const field=$('#gen-image-prompt');if(!field||field.disabled)throw Object.assign(Error('生图提示词尚未加载，请稍后重试或恢复默认。'),{connected:true});if(!field.value.trim())throw Object.assign(Error('请填写生图提示词，或点击恢复默认。'),{connected:true});return field.value;}
// Only migrate the exact previous default; customized prompts remain overrides.
const LEGACY_IMAGE_DEFAULT_SHA256='8252db12c4893c9e5fecfe236c6b613f0dcc9fc56332505d32f647fa39f77056';
async function isLegacyImageDefault(text){
 if(text===null)return false;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text.trim()));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')===LEGACY_IMAGE_DEFAULT_SHA256;
}
async function initImageEditor(gameId,modeId,id){
 const key='riffle.imagePrompt.v1:'+gameId+'/'+modeId,field=$('#gen-image-prompt'),note=$('#gen-image-prompt-status');
 let baseline=null;
 function save(){try{if(field.value===baseline)localStorage.removeItem(key);else localStorage.setItem(key,field.value);note.textContent=field.value===baseline?'使用默认提示词 · 手机竖屏 9:16、英文界面':'已自动保存 · 仅当前浏览器、当前游戏模式';}catch{note.textContent='浏览器未允许保存；本次生成仍会使用当前内容。';}}
 field.oninput=save;
 $('#gen-image-reset').onclick=async()=>{try{const text=await defaultImagePrompt();if(id!==epoch)return;baseline=text;field.value=text;field.disabled=false;save();}catch(e){if(id===epoch)note.textContent=e.message+'，请再试一次。';}};
 try{
  let saved=null;try{saved=localStorage.getItem(key);}catch{}
  const migrate=await isLegacyImageDefault(saved);
  const useDefault=saved===null||migrate;
  const text=useDefault?await defaultImagePrompt():saved;
  if(id!==epoch)return;
  if(useDefault)baseline=text;
  field.value=text;field.disabled=false;
  if(migrate){try{localStorage.removeItem(key);}catch{}}
  note.textContent=useDefault?'使用默认提示词 · 手机竖屏 9:16、英文界面':'已恢复当前游戏模式的自定义配置';
 }catch(e){if(id===epoch)note.textContent=e.message+'，点击恢复默认重新加载。';}
}

function markdown(text){ // Render only a small, escaped Markdown subset. No raw HTML or executable URLs.
 const lines=text.split('\n');let out='',table=false,list=false;
 const inline=t=>esc(t).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
 for(let line of lines){let isTable=line.trim().startsWith('|');if(table&&!isTable){out+='</tbody></table></div>';table=false;}let li=line.match(/^\s*(?:\d+\.|-)\s+(.+)$/);if(list&&!li){out+='</ul>';list=false;}
 if(isTable){if(/^\|[\s:|\-]+\|?$/.test(line.trim()))continue;if(!table){out+='<div class="plan-table"><table><tbody>';table=true;}out+='<tr>'+line.trim().replace(/^\||\|$/g,'').split('|').map(c=>'<td>'+inline(c.trim())+'</td>').join('')+'</tr>';}
 else if(/^#{1,3}\s/.test(line)){let n=Math.min(4,line.match(/^#+/)[0].length+1);out+=`<h${n}>${inline(line.replace(/^#+\s*/,''))}</h${n}>`;}
 else if(li){if(!list){out+='<ul>';list=true;}out+='<li>'+inline(li[1])+'</li>';}
 else if(line.trim())out+='<p>'+inline(line)+'</p>';
 }return out+(list?'</ul>':'')+(table?'</tbody></table></div>':'');
}
const ACTIVE=['queued','planning','revising','imaging'];
let current=null,revision=0,dirty=false,saving=null,saveTimer,editing=false,step=1,selectedView='current',cacheKey='',polling=false,renderedImage='',jobList=[];
function reset(){clearTimeout(pollTimer);clearTimeout(saveTimer);urls.forEach(URL.revokeObjectURL);urls=[];epoch++;current=null;revision=0;dirty=false;saving=null;editing=false;polling=false;renderedImage='';document.body.classList.remove('writing');}
async function request(path,opts={}){const r=await fetch(BASE+path,{...opts,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers},signal:AbortSignal.timeout(15000)});if(!r.ok){const e=await r.json().catch(()=>({}));throw Object.assign(Error(e.error||'本机服务没有响应'),{code:r.status});}return r;}
async function connect(){const d=await(await request('/api/session')).json();token=d.token;if(d.workflowVersion!==2)throw Error('请重新启动本机生成服务以使用新版编辑工作台。');return d;}
function downloadFile(name,text,type='text/markdown'){const u=URL.createObjectURL(new Blob([text],{type}));urls.push(u);const a=document.createElement('a');a.href=u;a.download=name;a.click();}
function feedback(message){const el=$('#work-feedback');if(el)el.textContent=message;}
function showStep(n,remember=true){step=n;document.body.classList.toggle('writing',n!==1);document.querySelectorAll('[data-work-pane]').forEach(e=>e.hidden=Number(e.dataset.workPane)!==n);$('#topic-reference').hidden=n!==1;document.querySelectorAll('[data-work-step]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.workStep)===n);b.setAttribute('aria-current',Number(b.dataset.workStep)===n?'step':'false');});$('#main').scrollTop=0;if(remember)try{localStorage.setItem(cacheKey+':step',String(n));}catch{};}
function draftCache(){if(!current||current.published)return;try{localStorage.setItem(cacheKey+':draft',JSON.stringify({jobId:current.id,revision,text:$('#plan-editor').value}));}catch{feedback('浏览器不能保存恢复副本，请保持页面打开并及时保存。');}}
function markDirty(){dirty=true;draftCache();$('#plan-save-state').textContent='编辑中 · 正在准备保存';clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(e=>feedback(e.message)),800);}
async function save(){
 if(saving){await saving;if(dirty)return save();return;}
 if(!dirty||!current||current.published)return;
 const id=epoch,job=current.id,text=$('#plan-editor').value,base=revision;
 if(!text.trim())throw Error('正文为空，未覆盖已保存版本。');
 const task=(async()=>{try{const d=await(await request('/api/jobs/'+job+'/plan',{method:'POST',body:JSON.stringify({plan:text,revision:base})})).json();if(id!==epoch)return;
 revision=d.planRevision;dirty=$('#plan-editor').value!==text;current=d;
 if(dirty)draftCache();else{try{localStorage.removeItem(cacheKey+':draft');}catch{}}
 $('#conflict-box').hidden=true;renderState(d,id);$('#plan-save-state').textContent=dirty?'正在保存后续编辑…':'已保存 · 版本 '+revision;
 }catch(e){if(id===epoch){$('#plan-save-state').textContent='未保存 · 浏览器副本已保留';if(e.code===409){$('#conflict-box').hidden=false;$('#conflict-latest').textContent=(await(await request('/api/jobs/'+job+'/workspace')).json()).plan;}}throw e;}})();saving=task;try{await task;}finally{if(saving===task)saving=null;}
 if(dirty)return save();
}
function documentText(){if(selectedView==='proposal')return current?.proposal||'';if(selectedView==='draft')return current?.aiDraft||'';return dirty?$('#plan-editor').value:(current?.plan||current?.aiDraft||'');}
function renderDocument(){if(!current)return;const html=documentText()?markdown(documentText()):'<div class="document-empty"><span>✦</span><h3>策划正文将在这里展开</h3><p>正在查阅资料，正文会按章节显示。</p></div>';if($('#plan-preview').innerHTML!==html)$('#plan-preview').innerHTML=html;$('#plan-preview').hidden=editing;$('#plan-editor').hidden=!editing;$('#edit-plan').textContent=editing?'完成直接编辑':'直接编辑';$('#edit-plan').disabled=current.published||selectedView!=='current';document.querySelectorAll('[data-doc-view]').forEach(b=>b.classList.toggle('selected',b.dataset.docView===selectedView));}
async function loadImage(j,id){const key=[j.id,j.imageRevision,j.imageGeneratedAt||j.createdAt,j.published].join('/');if(!j.imageReady||j.status==='imaging'||renderedImage===key)return;renderedImage=key;try{const r=j.published?await fetch(j.base+'reference.png'):await request('/api/jobs/'+j.id+'/reference.png');if(!r.ok)throw Error('图片读取失败');const blob=await r.blob();if(id!==epoch)return;const u=URL.createObjectURL(blob);urls.push(u);$('#image-result').innerHTML='<img alt="玩法参考图" src="'+u+'"><a class="secondary" download="玩法参考图.png" href="'+u+'">下载参考图</a>'; }catch(e){renderedImage='';feedback(e.message);}}
function renderState(j,id){if(id!==epoch)return;const changedJob=current&&current.id!==j.id;current=j;const running=ACTIVE.includes(j.status);
 if(!dirty&&!saving){revision=j.planRevision??(j.planReady?1:0);const next=j.plan||j.aiDraft||'';if($('#plan-editor').value!==next)$('#plan-editor').value=next;}
 $('#work-status').textContent=j.error||j.message||'策划已就绪';$('#work-status').classList.toggle('is-error',!!j.error);
 $('#plan-save-state').textContent=dirty?'本地编辑尚未保存':j.planReady?'已保存 · 版本 '+revision:'AI 正在整理初稿';
 $('#generate-plan').textContent='打开策划工作台';$('#start-plan').textContent='打开策划工作台';
 $('#plan-retry').hidden=!(j.status==='failed'&&!j.planReady);$('#new-plan').disabled=running;
 $('#chat-message').disabled=!!j.published;$('#send-revision').disabled=!!j.published||j.status==='imaging';
 $('#chat-note').textContent=j.status==='planning'||j.status==='queued'?'可以先写下要求，初稿完成后会继续修改。':j.status==='revising'?'正在修改策划，你也可以继续编辑正文。':'告诉 AI 你想改什么。';
 $('#chat-log').innerHTML=(j.messages||[]).map(m=>'<div class="chat-turn"><p class="chat-user">'+esc(m.text)+'</p><p class="chat-answer">'+esc(({queued:'已收到，等待处理。',running:'正在修改…',done:j.proposalId?'修改好了，请查看修改稿。':'本次修改已处理。',failed:'修改未完成，请重新提交。'})[m.status]||m.status)+'</p></div>').join('');
 $('#proposal-bar').hidden=!j.proposalId;$('#proposal-note').textContent=j.proposalId&&j.proposalBaseRevision!==j.planRevision?'修改稿基于版本 '+j.proposalBaseRevision+'，正文已更新。请先对照；应用会替换正文并保留历史版本。':'修改稿不会自动替换正文，确认后才会使用。';$('#proposal-apply').disabled=running||j.published;$('#proposal-discard').disabled=running||j.published;
 $('#doc-proposal').hidden=!j.proposalId;$('#doc-draft').hidden=!j.aiDraft&&!['planning','revising'].includes(j.status);if(selectedView==='proposal'&&!j.proposalId||selectedView==='draft'&&!j.aiDraft&&!['planning','revising'].includes(j.status))selectedView='current';
 const select=$('#plan-history'),chosen=select.value;const historyHTML='<option value="">版本记录</option>'+(j.versions||[]).slice().reverse().map(v=>'<option value="'+v.revision+'">V'+v.revision+' · '+esc(v.label)+'</option>').join('');if(select.innerHTML!==historyHTML){select.innerHTML=historyHTML;select.value=chosen;}$('#restore-version').disabled=!select.value||j.published;
 $('#generate-image').disabled=!j.planReady||running||!!j.proposalId||j.published;$('#generate-image').textContent=j.status==='imaging'?'正在生成参考图…':j.imageReady?'按当前策划重新生图':'生成参考图';
 $('#image-plan-label').textContent=j.planReady?'使用已保存的策划 · 版本 '+(j.planRevision??1):'请先完成并保存策划';
 $('#image-notice').textContent=j.proposalId?'还有修改稿待处理，请先应用或放弃。':j.status==='imaging'?'正在使用版本 '+j.imageRequestedRevision+' 生图；继续编辑会让本次图片对应旧版本。':j.imageStale?'策划已更新，这张图对应旧版本。可按最新策划重新生成。':j.imageReady?'参考图已完成，可下载并交给开发。':'检查策划与生图提示词后，再点击生成参考图。';
 $('#download-plan').disabled=!j.planReady&&!dirty;$('#continue-image').disabled=!j.planReady||!!j.proposalId||running||j.published;
 if(changedJob)renderedImage='';renderDocument();loadImage(j,id);
}
async function refresh(id){if(id!==epoch||!current||current.published||polling)return;polling=true;const job=current.id;try{const d=await(await request('/api/jobs/'+job+'/workspace')).json();if(id===epoch&&current?.id===job)renderState(d,id);}catch(e){if(id===epoch)feedback('连接中断；编辑副本保留，可重新连接后保存。');}finally{if(id===epoch){polling=false;clearTimeout(pollTimer);pollTimer=setTimeout(()=>refresh(id),2500);}}}
async function attach(j,id){if(id!==epoch)return;current=null;dirty=false;revision=0;renderedImage='';selectedView='current';editing=false;const d=j.published?j:await(await request('/api/jobs/'+j.id+'/workspace')).json();if(id!==epoch)return;renderState(d,id);
 try{const cached=JSON.parse(localStorage.getItem(cacheKey+':draft')||'null');if(cached&&cached.jobId===d.id&&cached.text!==d.plan){$('#plan-editor').value=cached.text;revision=cached.revision;dirty=true;editing=true;feedback('已恢复未保存的浏览器编辑副本，请保存或对照最新正文。');renderDocument();}}catch{}
 refresh(id);
}
async function mount(g,m){reset();const id=epoch,modeId=m?.id||'',host=$('#generation-panel');if(!host)return;cacheKey='riffle.workspace.v2:'+g.id+'/'+modeId;
 host.innerHTML=`<nav class="work-steps" aria-label="制作流程"><button data-work-step="1"><span>01</span><b>选择选题</b><small>了解玩法与改编方向</small></button><button data-work-step="2"><span>02</span><b>编辑策划</b><small>生成、阅读与直接编辑</small></button><button data-work-step="3"><span>03</span><b>生成参考图</b><small>确认策划后单独生图</small></button></nav><div class="work-meta"><span id="gen-connection">正在连接本机…</span><button id="gen-reconnect" class="text-button">重新连接</button><span id="work-status" role="status">先选择模式，再开始策划。</span></div><p id="work-feedback" role="status"></p><div id="gen-offline" hidden>打开项目中的「启动生成服务.command」后即可生成与编辑。<a href="${BASE+'/'+location.hash}" target="_blank" rel="noopener">打开本机工作台 ↗</a></div>
 <section data-work-pane="1" class="work-setup"><div><p class="eyebrow">选题已选中</p><h3>${esc(g.displayName||g.name)}</h3><p>${esc(m?.name||'候选游戏 · 先核验模式')}</p></div><label>改编方向 <span>选填</span><textarea id="gen-brief" maxlength="4000" rows="2" placeholder="例如：保留核心对抗，改成单人对抗 NPC；每局 2 分钟。"></textarea></label><button id="start-plan" class="primary">生成策划案 →</button><p class="setup-hint">先生成文字策划，不会自动生图。下方可查看原作规则与适配依据。</p></section>
 <section data-work-pane="2" hidden><div class="work-toolbar"><div><p class="eyebrow">PLAN STUDIO</p><h3>把想法变成可制作的规则</h3></div><div class="toolbar-actions"><select id="job-history" aria-label="策划记录"><option value="">当前策划</option></select><button id="new-plan" class="secondary">新建策划</button><button id="continue-image" class="primary" disabled>下一步：参考图 →</button></div></div><div class="plan-studio"><section class="plan-paper"><div class="paper-tools"><div class="doc-views"><button data-doc-view="current" class="selected">当前正文</button><button data-doc-view="draft" id="doc-draft" hidden>AI 生成中</button><button data-doc-view="proposal" id="doc-proposal" hidden>修改稿</button></div><button id="edit-plan" class="secondary">直接编辑</button></div><div id="proposal-bar" class="proposal-bar" hidden><span id="proposal-note">修改稿不会自动替换正文，确认后才会使用。</span><button id="proposal-preview" class="text-button">查看修改稿</button><button id="proposal-apply" class="primary">使用这个版本</button><button id="proposal-discard" class="text-button">保留当前正文</button></div><div id="conflict-box" class="conflict-box" hidden><b>正文在别处更新了。你的编辑仍在下方。</b><details><summary>对照最新已保存正文</summary><pre id="conflict-latest"></pre></details><button id="save-over-latest" class="secondary">保留我的编辑为新版本</button></div><article id="plan-preview" class="plan-prose"><div class="document-empty"><span>✦</span><h3>开始你的第一份策划</h3><p>点击「生成策划案」，再在这里阅读与编辑。</p></div></article><label class="sr-only" for="plan-editor">策划正文</label><textarea id="plan-editor" maxlength="60000" spellcheck="false" hidden></textarea><div class="paper-footer"><span id="plan-save-state">尚未生成</span><button id="save-plan" class="text-button">保存正文</button><button id="download-plan" class="text-button" disabled>下载策划</button><button id="plan-retry" class="secondary" hidden>重试策划</button></div><div class="version-tools"><select id="plan-history" aria-label="历史版本"><option value="">版本记录</option></select><button id="restore-version" class="text-button" disabled>恢复所选版本</button></div></section><section class="revision-sidebar"><h3>修改策划</h3><p id="chat-note">告诉 AI 你想改什么。</p><div id="chat-log" aria-live="polite"></div><label for="chat-message">你的修改要求</label><textarea id="chat-message" rows="5" maxlength="4000" placeholder="在这里输入修改要求"></textarea><button id="send-revision" class="primary">帮我修改</button></section></div></section>
 <section data-work-pane="3" hidden><div class="work-toolbar"><div><p class="eyebrow">VISUAL REFERENCE</p><h3>给确定的玩法一张画面</h3><p id="image-plan-label">请先保存策划</p></div><button id="back-to-plan" class="secondary">← 返回编辑策划</button></div><div class="image-studio"><section class="image-controls"><h4>生图提示词</h4><p id="gen-image-help">默认手机竖屏 9:16、英文界面。可自由修改；<code>{{完整策划案}}</code>会自动填入当前已保存正文。</p><label for="gen-image-prompt">完整提示词</label><textarea id="gen-image-prompt" rows="16" maxlength="16000" disabled aria-describedby="gen-image-help gen-image-prompt-status"></textarea><div class="image-prompt-heading"><p id="gen-image-prompt-status"></p><button id="gen-image-reset" class="text-button">恢复默认</button></div><button id="generate-image" class="primary" disabled>生成参考图</button><p id="image-notice" role="status"></p><details><summary>生成方式与模板</summary><p>使用本机 Codex 原生图片通道；工具未暴露型号选择，无法保证指定 GPT Image 2.5。成果保存在本机。</p><a href="prompts/planning.md" target="_blank" rel="noopener">策划模板 ↗</a><button id="download-image-prompt" class="text-button">下载实际生图提示词</button></details></section><section class="image-canvas"><div id="image-result"><div class="image-placeholder"><span>9:16</span><p>参考图会显示在这里</p><small>先确认策划，再决定画面</small></div></div></section></div></section>`;
 const action=fn=>async()=>{try{feedback('');await fn();}catch(e){if(id===epoch)feedback(e.message);}};
 let starting=false;
 async function start(force=false){if(starting)return;if(current&&!force){showStep(2);return;}starting=true;try{await save();await connect();const j=await(await request('/api/jobs',{method:'POST',body:JSON.stringify({gameId:g.id,modeId,brief:$('#gen-brief').value.trim()})})).json();await attach(j,id);if(id!==epoch)return;showStep(2);await listJobs();}finally{starting=false;}}
 async function listJobs(){jobList=await(await request('/api/jobs?'+new URLSearchParams({gameId:g.id,modeId}))).json();if(id!==epoch)return;$('#job-history').innerHTML='<option value="">策划记录</option>'+jobList.map(j=>'<option value="'+j.id+'">'+esc(j.createdAt.slice(5,16).replace('T',' '))+' · '+esc(j.brief?.slice(0,16)||'默认改编')+'</option>').join('');$('#job-history').value=current?.id||'';}
 async function reconnect(){try{await connect();if(id!==epoch)return;$('#gen-connection').textContent='已连接本机';$('#gen-offline').hidden=true;await listJobs();if((!current||current.published)&&jobList.length){await attach(jobList[0],id);let s=2;try{s=Number(localStorage.getItem(cacheKey+':step'))||2;}catch{}showStep(s);}else if(current&&!current.published){await refresh(id);}}catch(e){if(id!==epoch)return;$('#gen-connection').textContent=e.message;$('#gen-offline').hidden=false;if(!current){try{const all=await(await fetch('generated/index.json')).json();const j=all.find(x=>x.gameId===g.id&&(x.modeId||'')===modeId);if(j){const plan=await(await fetch(j.base+'plan.md')).text();await attach({...j,plan,published:true,planRevision:1},id);feedback('当前为已发布成果，只读。连接本机后可打开本机策划。');}}catch{}}}}
 $('#gen-reconnect').onclick=action(reconnect);$('#generate-plan').onclick=action(()=>start());$('#start-plan').onclick=action(()=>start());$('#new-plan').onclick=action(()=>start(true));
 document.querySelectorAll('[data-work-step]').forEach(b=>b.onclick=action(async()=>{await save();showStep(Number(b.dataset.workStep));}));
 $('#continue-image').onclick=action(async()=>{await save();showStep(3);});$('#back-to-plan').onclick=()=>showStep(2);
 $('#plan-editor').oninput=markDirty;$('#save-plan').onclick=action(save);$('#edit-plan').onclick=action(async()=>{if(!current){await start();return;}if(editing)await save();editing=!editing;renderDocument();});
 document.querySelectorAll('[data-doc-view]').forEach(b=>b.onclick=action(async()=>{if(editing)await save();editing=false;selectedView=b.dataset.docView;renderDocument();}));
 $('#download-plan').onclick=()=>downloadFile('策划案.md',dirty?$('#plan-editor').value:current?.plan||'');
 $('#send-revision').onclick=action(async()=>{const input=$('#chat-message'),message=input.value.trim();if(!message)throw Error('请写下修改要求');if(!current)await start();await save();const d=await(await request('/api/jobs/'+current.id+'/revise',{method:'POST',body:JSON.stringify({message})})).json();if(id!==epoch)return;input.value='';renderState(d,id);});
 $('#proposal-preview').onclick=()=>{editing=false;selectedView='proposal';renderDocument();};
 async function proposal(apply){await save();const d=await(await request('/api/jobs/'+current.id+'/proposal',{method:'POST',body:JSON.stringify({apply,proposalId:current.proposalId,revision})})).json();if(id===epoch){selectedView='current';renderState(d,id);}}
 $('#proposal-apply').onclick=action(()=>proposal(true));$('#proposal-discard').onclick=action(()=>proposal(false));
 $('#plan-history').onchange=()=>$('#restore-version').disabled=!$('#plan-history').value;$('#restore-version').onclick=action(async()=>{await save();const d=await(await request('/api/jobs/'+current.id+'/restore',{method:'POST',body:JSON.stringify({version:Number($('#plan-history').value),revision})})).json();if(id===epoch)renderState(d,id);});
 $('#save-over-latest').onclick=action(async()=>{const latest=await(await request('/api/jobs/'+current.id+'/workspace')).json();if(id!==epoch)return;revision=latest.planRevision;await save();});
 $('#job-history').onchange=action(async()=>{const target=$('#job-history').value;if(!target)return;await save();await attach({id:target},id);});
 $('#plan-retry').onclick=action(async()=>{const d=await(await request('/api/jobs/'+current.id+'/retry',{method:'POST',body:'{}'})).json();if(id===epoch)renderState(d,id);});
 $('#generate-image').onclick=action(async()=>{await save();const imagePrompt=currentImagePrompt();const d=await(await request('/api/jobs/'+current.id+'/image',{method:'POST',body:JSON.stringify({revision,imagePrompt})})).json();if(id===epoch)renderState(d,id);});
 $('#download-image-prompt').onclick=action(async()=>{if(!current)throw Error('尚未生成参考图');const r=current.published?await fetch(current.base+'image-prompt.md'):await request('/api/jobs/'+current.id+'/image-prompt.md');if(!r.ok)throw Error('尚未生成实际生图提示词');downloadFile('实际生图提示词.md',await r.text());});
 initImageEditor(g.id,modeId,id);showStep(1,false);await reconnect();
}
window.addEventListener('beforeunload',e=>{if(dirty){draftCache();e.preventDefault();e.returnValue='';}});
window.RiffleGeneration={mount,reset};
})();
