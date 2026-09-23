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

function reset(){clearTimeout(pollTimer);urls.forEach(URL.revokeObjectURL);urls=[];epoch++;busy=false;lastSignature='';}
async function request(path,opts={}){let r=await fetch(BASE+path,{...opts,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers},signal:AbortSignal.timeout(10000)});if(!r.ok){let e=await r.json().catch(()=>({}));let err=Error(e.error||'本机服务没有响应');err.connected=true;throw err;}return r;}
async function connect(){let r=await request('/api/session');let d=await r.json();if(!d.ready)throw Error('本机未找到 Codex CLI');token=d.token;return d;}
async function connectForGeneration(){const d=await connect();if(!d.imagePromptConfig)throw Object.assign(Error('生成服务正在等待当前任务完成后更新，请稍后重试。提示词配置已保留。'),{connected:true});return d;}
function fileLink(parent,title,name,blob){const a=document.createElement('a');const u=URL.createObjectURL(blob);urls.push(u);a.href=u;a.download=name;a.textContent=title;a.className='secondary';parent.append(a);}
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
function schedule(j,id){clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{try{let next=await (await request('/api/jobs/'+j.id)).json();if(id===epoch)showJob(next,id);}catch(e){if(id===epoch){$('#gen-connection').textContent='本机连接中断；重新连接后可恢复进度。';busy=false;$('#generate-plan').disabled=false;$('#generate-plan').textContent='生成策划';}}},5000);}
async function showJob(j,id,published=false){if(id!==epoch||!$('#generation-result'))return;
 const signature=JSON.stringify([j.id,j.status,j.planReady,j.imageReady,j.error,published]);if(signature===lastSignature){if(['queued','planning','imaging'].includes(j.status))schedule(j,id);return;}lastSignature=signature;urls.forEach(URL.revokeObjectURL);urls=[];
 const container=$('#generation-result');container.innerHTML=`<div class="gen-progress" role="status"><span class="${j.planReady?'done':''}">01 策划 ${j.planReady?'✓':''}</span><i>→</i><span class="${j.imageReady?'done':''}">02 参考图 ${j.imageReady?'✓':''}</span><p>${esc(j.error||j.message||'已生成')}</p></div><p class="gen-provenance">${published?'已发布成果':'本机成果'} · ${esc(j.createdAt?.slice(0,16).replace('T',' '))} · ${esc(j.imageChannel||'Codex 原生图片通道')}<br>${esc(j.imageModel||'原生工具未暴露型号选择')}${j.brief?'<br>本次要求：'+esc(j.brief):''}</p><div class="gen-downloads"></div><div class="gen-art"></div><div class="gen-doc"></div>`;
 const running=['queued','planning','imaging'].includes(j.status);busy=running;
 const b=$('#generate-plan');if(b){b.disabled=running;b.textContent=running?'正在生成…':'生成策划';}
 async function getFile(name){return published?fetch(j.base+name).then(r=>{if(!r.ok)throw Error('成果文件暂不可用');return r;}):request(`/api/jobs/${j.id}/${name}`);}
 try{
 if(j.planReady){let plan=await (await getFile('plan.md')).text();if(id!==epoch)return;
  $('.gen-doc').innerHTML='<details open class="plan-document"><summary>查看完整策划</summary><article>'+markdown(plan)+'</article></details>';
  fileLink($('.gen-downloads'),'下载策划','策划案.md',new Blob([plan],{type:'text/markdown'}));
  let prompt=await (await getFile('image-prompt.md')).blob();if(id!==epoch)return;fileLink($('.gen-downloads'),'下载本次生图提示词','参考图提示词.md',prompt);let used=await prompt.text();if(id!==epoch)return;const detail=document.createElement('details');detail.className='used-image-prompt';detail.innerHTML='<summary>查看本次实际生图提示词</summary><pre>'+esc(used)+'</pre>';$('.gen-doc').prepend(detail);
 }
 if(j.imageReady){let blob=await (await getFile('reference.png')).blob();if(id!==epoch)return;let u=URL.createObjectURL(blob);urls.push(u);$('.gen-art').innerHTML=`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${esc(j.gameName)}改编玩法参考图"></a><p class="muted">AI 生成的玩法参考图，供原型制作参考；请对照策划检查细节。</p>`;fileLink($('.gen-downloads'),'下载参考图','玩法参考图.png',blob);}
 if(j.status==='failed'&&!published){let retry=document.createElement('button');retry.className='secondary';retry.textContent=j.planReady?'重试参考图':'重试策划';$('.gen-downloads').append(retry);retry.onclick=async()=>{retry.disabled=true;try{const imagePrompt=currentImagePrompt();await connectForGeneration();let r=await request(`/api/jobs/${j.id}/retry`,{method:'POST',body:JSON.stringify({imagePrompt})});await showJob(await r.json(),id);}catch(e){retry.disabled=false;$('.gen-progress p').textContent=e.message;}};}
 }catch(e){if(id===epoch)$('.gen-progress p').textContent='成果已保留，读取遇到问题：'+e.message;}
 if(running&&id===epoch)schedule(j,id);
}
async function loadPublished(gameId,modeId,id){try{let r=await fetch('generated/index.json');if(!r.ok)return;let all=await r.json();let j=all.find(j=>j.gameId===gameId&&(j.modeId||'')===(modeId||''));if(j&&id===epoch)await showJob(j,id,true);}catch{}}
async function mount(g,m){reset();let id=epoch;const btn=$('#generate-plan'),host=$('#generation-panel');if(!btn||!host||!g)return;
 const modeId=m?.id||'',localUrl=BASE+'/'+location.hash;
 host.innerHTML=`<div class="gen-intro"><div><p class="eyebrow">从选题到可制作的方案</p><h3>策划案 + 玩法参考图</h3><p>按你的策划模板，结合当前${m?'模式':'游戏'}的全部资料生成，再根据策划绘制一张参考图。</p></div><span class="gen-mode">${esc(m?.name||'候选游戏 · 先核验模式')}</span></div><label class="gen-brief">改编要求 <span>选填</span><textarea id="gen-brief" rows="2" maxlength="4000" placeholder="默认保留核心玩法，改为单人独立对抗 NPC；网页端，每次 2–5 分钟。"></textarea></label><section class="image-prompt-config"><div class="image-prompt-heading"><h4>生图提示词</h4><button id="gen-image-reset" class="secondary" type="button">恢复默认</button></div><p id="gen-image-help">可以直接修改画风、镜头、画幅、界面和场景要求。<code>{{完整策划案}}</code>会在生成时自动替换；删除它后，系统会把策划附在末尾。修改用于下一次生成或重试参考图，已开始的任务使用启动时的配置。</p><label for="gen-image-prompt">完整提示词</label><textarea id="gen-image-prompt" rows="10" maxlength="16000" disabled aria-describedby="gen-image-help gen-image-prompt-status" placeholder="正在加载默认提示词…"></textarea><p id="gen-image-prompt-status" role="status">正在加载…</p></section><div class="gen-connect"><span id="gen-connection" role="status">正在连接本机生成服务…</span><button id="gen-reconnect" class="text-button">重新连接</button></div><div id="gen-offline" hidden><p>首次使用请在电脑上打开项目中的「启动生成服务.command」，保持 Codex 已登录。若浏览器询问本地网络访问，请允许连接。</p><a class="secondary" href="${esc(localUrl)}" target="_blank" rel="noopener">打开本机工作台 ↗</a><p class="muted">本机工作台和线上使用相同资料，避免浏览器拦截跨站本地连接。生成使用本机 Codex 额度；页面关闭后任务仍继续。</p></div><p class="gen-footnote">流程：Codex CLI 生成策划 → Codex 原生 image_gen 生成参考图。原生通道不提供型号选择，无法保证指定 GPT Image 2.5。成果先保存在本机。</p><div class="gen-prompt-links"><a href="prompts/planning.md" target="_blank" rel="noopener">策划模板 ↗</a><a href="prompts/reference-image.md" target="_blank" rel="noopener">参考图提示词 ↗</a></div><div id="generation-result"></div>`;
 async function reconnect(){try{await connect();if(id!==epoch)return;$('#gen-connection').textContent='已连接本机 · 可生成策划与参考图';$('#gen-offline').hidden=true;let jobs=await (await request('/api/jobs?'+new URLSearchParams({gameId:g.id,modeId}))).json();if(id!==epoch)return;if(jobs.length)await showJob(jobs[0],id);else await loadPublished(g.id,modeId,id);}catch{if(id!==epoch)return;$('#gen-connection').textContent='未连接本机生成服务';$('#gen-offline').hidden=false;await loadPublished(g.id,modeId,id);}}
 initImageEditor(g.id,modeId,id);
 $('#gen-reconnect').onclick=reconnect;
 btn.onclick=async()=>{if(busy)return;busy=true;btn.disabled=true;btn.textContent='正在启动…';host.scrollIntoView({behavior:'smooth',block:'start'});try{const imagePrompt=currentImagePrompt();await connectForGeneration();const r=await request('/api/jobs',{method:'POST',body:JSON.stringify({gameId:g.id,modeId,brief:$('#gen-brief').value.trim(),imagePrompt})});if(id!==epoch)return;$('#gen-connection').textContent='已连接本机 · 任务已启动';$('#gen-offline').hidden=true;await showJob(await r.json(),id);}catch(e){if(id!==epoch)return;busy=false;btn.disabled=false;btn.textContent='生成策划';$('#gen-connection').textContent=e.message.includes('fetch')?'无法连接本机，请打开生成服务或本机工作台。':e.message;$('#gen-offline').hidden=!!e.connected;}};
 await reconnect();
}
window.RiffleGeneration={mount,reset};
})();
