const partMixer=(()=>{
 let rows=[],initial=[],initialMaster=-2,solo=-1,key='',master=0,source='';const buses=new Map();
 const box=document.createElement('fieldset');box.innerHTML='<legend>声部ミキサー</legend><p>再生する声部・伴奏を選択できます。楽譜の左の声部名をタップすると音のオン／オフ（オフは薄く表示）、右クリック（iPhone・iPadでは長押し）でその声部の音量を調整できます。音色変更は次の再生から反映します。</p><select id="mix-preset"><option value="all">全パート</option><option value="choir">合唱のみ</option><option value="choir,piano">合唱＋伴奏</option><option value="solo,piano">独唱＋伴奏</option><option value="none">全消音</option></select> 全体音量 <input id="mix-master" type="range" min="-36" max="0" value="-2"><span id="mix-master-value">−2 dB</span><div id="mix-rows"></div><p><button id="mix-reset" type="button">楽譜の初期値に戻す</button> <button id="mix-export" type="button">この設定を楽譜に保存</button></p><p id="mix-message" role="status"></p>';
 document.getElementById('vocal-tone').closest('nav').before(box);
 const save=()=>{try{localStorage.setItem(key,JSON.stringify({rows,master,v:2}))}catch{};update();paint();refreshPop()};
 const audible=i=>rows[i].on&&(solo<0||solo===i);
 const message=text=>{document.getElementById('mix-message').textContent=text};
 // Part names at the left of each system toggle that part's sound; muted names are faded.
 const labelNodes=new Set();
 function labels(engine){
  for(const n of labelNodes)if(!n.isConnected)labelNodes.delete(n);
  const instruments=engine.Sheet.Instruments;
  for(const page of engine.GraphicSheet?.MusicPages||[])for(const system of page.MusicSystems)system.labels?.forEach((instrument,label)=>{
   const i=instruments.indexOf(instrument);if(i<0)return;
   for(const text of label?.SVGNode?.querySelectorAll?.('text')||[]){text.classList.add('part-label');text.dataset.part=i;labelNodes.add(text)}
  });
  paint();
 }
 function paint(){for(const t of labelNodes){const r=rows[Number(t.dataset.part)];t.style.opacity=r&&!r.on?'.3':''}}
 const hitLabel=(x,y)=>{const pad=matchMedia('(pointer: coarse)').matches?14:6;return [...labelNodes].find(t=>{const r=t.getBoundingClientRect();return r.width&&x>=r.left-pad&&x<=r.right+pad&&y>=r.top-pad&&y<=r.bottom+pad})};
 document.addEventListener('score-tap',e=>{
  const hit=hitLabel(e.detail.x,e.detail.y),r=hit&&rows[Number(hit.dataset.part)];if(!r)return;
  r.on=!r.on;save();draw();refreshPop();message(`${r.name}：音を${r.on?'オン':'オフ'}にしました`);
 });
 // Right-click (long press on touch screens) on a part name opens a small volume panel for that part.
 let pop=null,popPart=-1;
 function closePop(){pop?.remove();pop=null;popPart=-1}
 function refreshPop(){
  if(!pop)return;const r=rows[popPart];if(!r){closePop();return}
  pop.querySelector('.mix-pop-on').checked=r.on;pop.querySelector('.mix-pop-level').value=r.db;
  pop.querySelector('.mix-pop-value').textContent=(r.db>0?'+':'')+r.db+' dB';
  pop.querySelector('.mix-pop-solo').textContent=solo===popPart?'単独試聴を解除':'このパートだけ聴く';
 }
 function openPop(i,x,y){
  closePop();const r=rows[i];if(!r)return;popPart=i;
  pop=document.createElement('div');pop.id='mix-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-label',r.name+' の音量');
  pop.innerHTML='<button type="button" class="mix-pop-close" aria-label="閉じる">×</button><strong></strong><label class="mix-pop-row"><input type="checkbox" class="mix-pop-on"> 音を出す</label><div class="mix-pop-row"><input type="range" class="mix-pop-level" min="-24" max="12" step="1"><span class="mix-pop-value"></span></div><div class="mix-pop-row"><button type="button" class="mix-pop-solo"></button><button type="button" class="mix-pop-zero">0 dBに戻す</button></div>';
  pop.querySelector('strong').textContent=r.name;
  const level=pop.querySelector('.mix-pop-level');level.setAttribute('aria-label',r.name+' 音量');
  const set=f=>{f(rows[i]);save();draw();refreshPop()};
  pop.querySelector('.mix-pop-on').onchange=e=>set(r=>{r.on=e.target.checked});
  level.oninput=()=>set(r=>{r.db=Number(level.value)});
  pop.querySelector('.mix-pop-zero').onclick=()=>set(r=>{r.db=0});
  pop.querySelector('.mix-pop-solo').onclick=()=>{solo=solo===i?-1:i;update();draw();refreshPop()};
  pop.querySelector('.mix-pop-close').onclick=closePop;
  document.body.append(pop);refreshPop();
  const w=pop.offsetWidth,h=pop.offsetHeight,m=8;
  pop.style.left=Math.max(m,Math.min(innerWidth-w-m,x+4))+'px';pop.style.top=Math.max(m,y+12+h<=innerHeight?y+12:y-12-h)+'px';
 }
 document.addEventListener('contextmenu',e=>{
  const hit=hitLabel(e.clientX,e.clientY);if(!hit)return;
  e.preventDefault();openPop(Number(hit.dataset.part),e.clientX,e.clientY);
 });
 // iOS Safari has no contextmenu event, so a touch held for half a second opens the panel instead
 // of the tap toggle; the click that ends the press is swallowed.
 let press=null,swallow=false;
 document.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='touch'||!hitLabel(e.clientX,e.clientY))return;
  const {clientX:x,clientY:y}=e,hit=hitLabel(x,y);
  press={x,y,timer:setTimeout(()=>{press=null;swallow=true;setTimeout(()=>{swallow=false},800);openPop(Number(hit.dataset.part),x,y)},500)};
 });
 const cancelPress=()=>{if(press){clearTimeout(press.timer);press=null}};
 document.addEventListener('pointermove',e=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)cancelPress()});
 document.addEventListener('pointerup',cancelPress);document.addEventListener('pointercancel',cancelPress);
 document.addEventListener('click',e=>{
  if(swallow){swallow=false;e.stopPropagation();e.preventDefault();return}
  if(pop&&!pop.contains(e.target))closePop();
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closePop()});
 document.querySelector('main').addEventListener('scroll',closePop,{passive:true});
 function update(){for(const [i,g] of buses)g.gain.setTargetAtTime(audible(i)?10**(rows[i].db/20):0,g.context.currentTime,.02)}
 // Score defaults, in priority order: score-viewer fields > varied standard MIDI fields > part names.
 const FIELD='score-viewer:part:',MASTER='score-viewer:master',clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const toneFromProgram=p=>p>=1&&p<=8?'piano':p===69?'oboe':p===23?'harmonica':null;
 function scoreDefaults(d,parts){
  let from='パート名から推測';
  // Exporters write the same volume/program to every part by default; only differing values are a choice.
  const midi=parts.map(p=>p.querySelector('midi-instrument')),num=(m,tag)=>Number(m?.querySelector(tag)?.textContent);
  const vols=midi.map(m=>num(m,'volume')),progs=midi.map(m=>num(m,'midi-program')),varied=a=>new Set(a.filter(Number.isFinite)).size>1;
  if(varied(vols)){const top=Math.max(...vols.filter(Number.isFinite));rows.forEach((r,i)=>{if(vols[i]>0)r.db=clamp(Math.round(40*Math.log10(vols[i]/top)),-24,12)});from='楽譜の音量指定（MIDI）'}
  if(varied(progs))rows.forEach((r,i)=>{const t=toneFromProgram(progs[i]);if(t&&t!==r.tone){r.tone=t;from='楽譜の音量・音色指定（MIDI）'}});
  const tones=new Set([...document.getElementById('vocal-tone').options].map(o=>o.value)),fields=new Map();
  for(const f of d.querySelectorAll('identification miscellaneous-field'))if(f.getAttribute('name')?.startsWith('score-viewer:'))fields.set(f.getAttribute('name'),f.textContent);
  rows.forEach(r=>{
   const text=fields.get(FIELD+r.id);if(!text)return;
   const v=Object.fromEntries(text.split(';').map(s=>s.split('=').map(x=>x.trim())).filter(x=>x.length===2));
   if(tones.has(v.tone))r.tone=v.tone;if(Number.isFinite(Number(v.db))&&v.db!=='')r.db=clamp(Math.round(Number(v.db)),-24,12);if(v.on==='yes'||v.on==='no')r.on=v.on==='yes';
   from='楽譜の指定（ビューアー用）';
  });
  const m=Number(fields.get(MASTER));if(fields.has(MASTER)&&Number.isFinite(m))master=clamp(Math.round(m),-36,0);
  return from;
 }
 function load(xml){const d=new DOMParser().parseFromString(xml,'application/xml');let h=2166136261;for(const c of xml)h=Math.imul(h^c.charCodeAt(0),16777619);key='requiem-mixer-v1-'+(h>>>0);solo=-1;buses.clear();const parts=[...d.querySelectorAll('part-list > score-part')];rows=parts.map(p=>{const name=p.querySelector('part-name')?.textContent||p.id;const s=name.toLowerCase();const group=/piano|pianoforte|伴奏/.test(s)?'piano':/solo|solista|独唱/.test(s)?'solo':'choir';const voice=/sopr/.test(s)?'soprano':/alt[oi]|contralt[oi]/.test(s)?'alto':/tenor|tenori/.test(s)?'tenor':/bass|bassi/.test(s)?'bass':null;return {id:p.id,name,group,on:true,db:0,tone:voice?'requiem-'+voice+'-'+(group==='solo'?'solo':'choir'):'piano'}});master=-2;source=scoreDefaults(d,parts);initial=rows.map(r=>({...r}));initialMaster=master;let local=false;try{const s=JSON.parse(localStorage.getItem(key));if(s?.rows?.length===rows.length){rows=rows.map((r,i)=>({...r,...s.rows[i]}));master=s.v!==2&&s.master===-12?master:s.master??master;local=true}}catch{};draw();message('初期値：'+source+(local?'（この端末で変更した設定を使用中）':''))}
 function draw(){const host=document.getElementById('mix-rows');host.replaceChildren();rows.forEach((r,i)=>{const line=document.createElement('div');line.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0';const check=document.createElement('input');check.type='checkbox';check.checked=r.on;check.onchange=()=>{r.on=check.checked;save()};const label=document.createElement('label');label.append(check,document.createTextNode(r.name+' ['+r.id+']'));const button=document.createElement('button');button.textContent=solo===i?'単独試聴を解除':'このパートだけ聴く';button.onclick=()=>{solo=solo===i?-1:i;update();draw()};const level=document.createElement('input');level.type='range';level.min=-24;level.max=12;level.value=r.db;level.setAttribute('aria-label',r.name+' 音量');const value=document.createElement('span');value.textContent=r.db+' dB';level.oninput=()=>{r.db=Number(level.value);value.textContent=r.db+' dB';save()};const tone=document.getElementById('vocal-tone').cloneNode(true);tone.removeAttribute('id');tone.setAttribute('aria-label',r.name+' 音色');tone.value=r.tone;tone.onchange=()=>{r.tone=tone.value;save()};line.append(label,button,level,value,tone);host.append(line)});document.getElementById('mix-master').value=master;document.getElementById('mix-master-value').textContent=master+' dB';paint()}
 const applyMaster=()=>{if(output)output.gain.setTargetAtTime(.65*10**(master/20),audioContext.currentTime,.02)};
 document.getElementById('mix-master').oninput=e=>{master=Number(e.target.value);document.getElementById('mix-master-value').textContent=master+' dB';applyMaster();save()};
 document.getElementById('mix-preset').onchange=e=>{solo=-1;rows.forEach(r=>r.on=e.target.value==='all'||e.target.value.split(',').includes(r.group));save();draw()};
 document.getElementById('mix-reset').onclick=()=>{if(!rows.length)return;solo=-1;rows=initial.map(r=>({...r}));master=initialMaster;try{localStorage.removeItem(key)}catch{};update();applyMaster();draw();message('楽譜の初期値に戻しました（'+source+'）')};
 // Writes the current mixer into <identification><miscellaneous> as score-viewer fields; the music is untouched.
 function withSettings(xml){
  const d=new DOMParser().parseFromString(xml,'application/xml'),root=d.documentElement,make=tag=>d.createElement(tag);
  let id=root.querySelector(':scope > identification');
  if(!id){id=make('identification');root.insertBefore(id,root.querySelector(':scope > defaults, :scope > credit, :scope > part-list'))}
  let misc=id.querySelector(':scope > miscellaneous');if(!misc){misc=make('miscellaneous');id.append(misc)}
  for(const f of [...misc.children])if(f.getAttribute('name')?.startsWith('score-viewer:'))f.remove();
  const field=(name,value)=>{const f=make('miscellaneous-field');f.setAttribute('name',name);f.textContent=value;misc.append(f)};
  field(MASTER,String(master));for(const r of rows)field(FIELD+r.id,`tone=${r.tone}; db=${r.db}; on=${r.on?'yes':'no'}`);
  // Chrome keeps the original declaration when serializing, Safari drops it; write exactly one.
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*\?>\s*/,'');
 }
 document.getElementById('mix-export').onclick=async()=>{
  if(!scoreXML||!rows.length){message('楽譜を開いてから保存してください');return}
  const blob=new Blob([withSettings(scoreXML)],{type:'application/xml'});
  if(typeof window.showSaveFilePicker==='function'){
   try{const handle=await window.showSaveFilePicker({id:'score-viewer-xml',suggestedName:scoreFilename,types:[{description:'MusicXML',accept:{'application/xml':['.musicxml','.xml']}}]});const stream=await handle.createWritable();try{await stream.write(blob);await stream.close()}catch(e){try{await stream.abort()}catch{}throw e}message(`「${handle.name}」に保存しました。次に開いたときは、この設定が初期値になります。`)}
   catch(e){message(e.name==='AbortError'?'保存をキャンセルしました':'保存エラー: '+e.message)}
  }else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=scoreFilename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000);message('ダウンロード先に保存しました。元の楽譜と置き換えると、次からこの設定が初期値になります。')}
 };
 function bus(context,destination,i,live){const g=context.createGain();g.gain.value=audible(i)?10**(rows[i].db/20):0;g.connect(destination);if(live)buses.set(i,g);return g}
 return {load,bus,labels,withSettings,tone:i=>rows[i]?.tone||'piano',master:()=>.65*10**(master/20),reset:()=>buses.clear()};
})();
