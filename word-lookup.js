/* Tap a lyric or direction in the score to see its meaning. Sources: the score's own
   word list (a local JSON file, kept on this device) first, then the built-in term list. */
const wordLookup=(()=>{
 const $=id=>document.getElementById(id);
 const LANGS={it:'イタリア語',de:'ドイツ語',fr:'フランス語',en:'英語',la:'ラテン語'};
 let terms=new Map(),words=new Map(),wordsInfo=null,storeKey='',popup=null,active=[];
 const lyricNodes=new WeakMap();
 // Keys are compared lower-cased, without surrounding punctuation; fold() also drops accents.
 const token=s=>s.replace(/^[^\p{L}\p{N}]+/u,'').replace(/[^\p{L}\p{N}'’]+$/u,'');
 const norm=s=>s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g,"'").split(/\s+/).map(token).filter(Boolean).join(' ');
 const fold=s=>norm(s).replace(/æ/g,'ae').replace(/œ/g,'oe').normalize('NFD').replace(/\p{M}/gu,'');
 function table(entries){const t=new Map();for(const [k,v] of Object.entries(entries||{})){if(!v||typeof v!=='object')continue;const e={...v,key:k};t.set(norm(k),e);if(!t.has(fold(k)))t.set(fold(k),e)}t.delete('');return t}
 const ready=fetch('music-terms.json').then(r=>r.json()).then(j=>{terms=table(j.entries)}).catch(e=>console.error('music-terms.json',e));
 // Lyrics use only the score's word list; the term list would mislabel e.g. German "in" as Italian.
 const find=(k,lyrics)=>{for(const [t,src] of lyrics?[[words,'words']]:[[words,'words'],[terms,'terms']]){const e=t.get(norm(k))||t.get(fold(k));if(e)return {entry:e,src}}return null};
 // Longest matching phrase first, so "poco a poco cresc." becomes two entries.
 function segment(text,lyrics=false){
  const toks=text.replace(/[—–/,;:!?¡¿]/g,' ').split(/\s+/).filter(t=>/[\p{L}]/u.test(t)),found=[],unknown=[];
  for(let i=0;i<toks.length;){
   let n=Math.min(6,toks.length-i),hit=null;
   for(;n>0&&!(hit=find(toks.slice(i,i+n).join(' '),lyrics));n--);
   if(hit){found.push({text:toks.slice(i,i+n).map(token).join(' '),...hit});i+=n;continue}
   // Split elisions (dell'atto → dell' + atto) and hyphenated words; no lookbehind for older iOS.
   const parts=toks[i].replace(/['’]/g,"'\n").split(/\n|-/).filter(p=>/[\p{L}]/u.test(p)),sub=parts.length>1?parts.map(p=>({p,h:find(p,lyrics)})):[];
   if(sub.some(s=>s.h))for(const s of sub)s.h?found.push({text:s.p,...s.h}):unknown.push(token(s.p));
   else unknown.push(token(toks[i]));
   i++;
  }
  return {found,unknown:unknown.filter(Boolean)};
 }
 const chordLike=/^[A-H][♭♯#b]?(m|maj|min|dim|aug|sus|add|ø|°|\+)?[\d()♭♯#b+°ø/A-Hmajsudi]*$/;
 const dynamic=/^(p{1,4}|f{1,4}|m[pf]|s?f+z?|sfp|fp|rfz?)$/;
 function lookupable(text){
  if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))return false;
  const toks=text.split(/\s+/).map(token).filter(Boolean);
  return dynamic.test(text.trim())||toks.some(t=>/\p{L}{2}/u.test(t)&&!chordLike.test(t));
 }
 function index(engine){
  close();const nodes=new Map();
  for(const measure of engine.GraphicSheet?.MeasureList.flat()||[])for(const staffEntry of measure?.staffEntries||[])for(const lyric of staffEntry.LyricsEntries||[]){
   const node=lyric.GraphicalLabel?.SVGNode,entry=lyric.LyricsEntry;if(!node||!entry)continue;
   lyricNodes.set(node,{entry,nodes});nodes.set(entry,node);
  }
  for(const text of engine.container?.querySelectorAll('svg text')||[])
   if(!text.classList.contains('part-label')&&(lyricNodes.has(text.parentNode)||lookupable(text.textContent)))text.classList.add('word-lookup');
 }
 function target(x,y){
  const pad=matchMedia('(pointer: coarse)').matches?14:6;let best=null,bestD=Infinity;
  for(const t of document.querySelectorAll('#score-frame text.word-lookup')){
   const r=t.getBoundingClientRect();if(!r.width)continue;
   const dx=Math.max(r.left-x,0,x-r.right),dy=Math.max(r.top-y,0,y-r.bottom);if(dx>pad||dy>pad)continue;
   const d=dx*dx+dy*dy;if(d<bestD){best=t;bestD=d}
  }
  return best;
 }
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 function describe(item){
  const e=item.entry,box=el('div','word-entry'),mode=$('word-lang').value,head=el('div','word-term');
  head.append(el('strong','',item.text));
  const meta=[e.full&&'→ '+e.full,LANGS[e.lang]].filter(Boolean).join('・');if(meta)head.append(el('small','',' '+meta));
  box.append(head);
  if(e.lemma&&norm(e.lemma)!==norm(item.text))box.append(el('div','word-sub','原形：'+e.lemma));
  if(e.ipa)box.append(el('div','word-sub','発音：['+e.ipa.replace(/^\[|\]$/g,'')+']'));
  const ja=mode!=='en'&&e.ja,en=mode!=='ja'&&e.en,fallback=!ja&&!en&&(e.ja||e.en);
  if(ja)box.append(el('div','word-ja',e.ja));if(en)box.append(el('div','word-en',e.en));
  if(fallback)box.append(el('div',e.ja?'word-ja':'word-en',e.ja||e.en));
  if(e.note)box.append(el('div','word-note',e.note));
  const alt=[].concat(mode!=='en'?e.alt?.ja||[]:[],mode!=='ja'?e.alt?.en||[]:[]);
  if(alt.length)box.append(el('div','word-alt','ほかの意味：'+alt.join('／')));
  box.append(el('div','word-src',item.src==='words'?'曲の単語帳':'音楽用語辞書'));
  return box;
 }
 function close(){popup?.remove();popup=null;for(const n of active)n.classList.remove('word-active');active=[]}
 async function show(text){
  await ready;close();
  const lyric=lyricNodes.get(text.parentNode);let label=text.textContent.trim(),detail='',result;
  if(lyric){
   const syllables=lyric.entry.Word?.Syllables||[lyric.entry],whole=syllables.map(s=>s.Text).join('');
   label=whole;if(syllables.length>1)detail=syllables.map(s=>s.Text).join('-');
   const hit=find(whole,true);result=hit?{found:[{text:token(whole),...hit}],unknown:[]}:segment(whole,true);
   active=syllables.map(s=>lyric.nodes.get(s)?.querySelector('text')).filter(Boolean);
  }else{result=segment(label);active=[text]}
  for(const n of active)n.classList.add('word-active');
  popup=el('div','');popup.id='word-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','単語の意味');
  const closeButton=el('button','word-close','×');closeButton.setAttribute('aria-label','閉じる');closeButton.onclick=close;
  const head=el('div','word-head');head.append(el('strong','',label));if(detail)head.append(el('small','',' '+detail));
  popup.append(closeButton,head);
  for(const item of result.found)popup.append(describe(item));
  if(result.unknown.length)popup.append(el('div','word-unknown',(result.found.length?'未登録：':'辞書・単語帳に未登録です：')+result.unknown.join(' ')));
  if(!wordsInfo&&lyric)popup.append(el('div','word-hint','歌詞の意味は「設定」→「単語の意味」から曲の単語帳を読み込むと表示されます。'));
  const copy=el('button','word-copy','原文をコピー');copy.onclick=async()=>{try{await navigator.clipboard.writeText(label);copy.textContent='コピーしました'}catch{copy.textContent='コピーできませんでした'}};
  popup.append(copy);document.body.append(popup);
  place(text);
 }
 function place(text){
  const r=text.getBoundingClientRect(),w=popup.offsetWidth,h=popup.offsetHeight,m=8;
  const below=r.bottom+m+h<=innerHeight||r.top-m-h<0;
  popup.style.left=Math.max(m,Math.min(innerWidth-w-m,r.left+r.width/2-w/2))+'px';
  popup.style.top=Math.max(m,below?r.bottom+m:r.top-m-h)+'px';
 }
 // A tap on a word shows its meaning; any other tap on the score is passed on as "score-tap".
 document.addEventListener('click',e=>{
  if(popup?.contains(e.target))return;
  if(!$('score-frame').contains(e.target)){close();return}
  const text=$('word-tap').checked&&target(e.clientX,e.clientY);
  if(text){show(text);return}
  close();document.dispatchEvent(new CustomEvent('score-tap',{detail:{x:e.clientX,y:e.clientY}}));
 });
 // A listener on the frame itself makes SVG text tappable in iOS Safari.
 $('score-frame').addEventListener('click',()=>{});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
 document.querySelector('main').addEventListener('scroll',close,{passive:true});
 addEventListener('resize',close);

 function setStatus(){
  $('word-status').textContent=!storeKey?'楽譜を開くと、その曲の単語帳を読み込めます。':wordsInfo?`単語帳：${wordsInfo.title}（${wordsInfo.count}語）`:'この曲の単語帳はまだ読み込んでいません（音楽用語辞書は使えます）。';
  $('word-clear').hidden=!wordsInfo;
 }
 function useWords(json,name){
  if(!json||typeof json.entries!=='object'||Array.isArray(json.entries))throw Error('単語帳の形式ではありません（entries がありません）');
  words=table(json.entries);wordsInfo={title:json.title||name,count:Object.keys(json.entries).length};
 }
 function load(title,filename){
  close();words=new Map();wordsInfo=null;storeKey=title||filename?'score-viewer-words-v1-'+(title||filename):'';
  if(storeKey)try{const saved=JSON.parse(localStorage.getItem(storeKey));if(saved)useWords(saved.json,saved.name)}catch{}
  setStatus();
 }
 $('word-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
   if(!storeKey)throw Error('先に楽譜を開いてください');
   if(file.size>2*1024*1024)throw Error('2 MB以下の単語帳を選んでください');
   const json=JSON.parse(await file.text());useWords(json,file.name);
   try{localStorage.setItem(storeKey,JSON.stringify({name:file.name,json}))}catch{}
   setStatus();
  }catch(err){$('word-status').textContent='単語帳エラー: '+(err instanceof SyntaxError?'JSONとして読めません':err.message)}
 };
 $('word-clear').onclick=()=>{try{localStorage.removeItem(storeKey)}catch{}words=new Map();wordsInfo=null;close();setStatus()};
 for(const [id,key] of [['word-tap','score-viewer-word-tap'],['word-lang','score-viewer-word-lang']]){
  const c=$(id),prop=c.type==='checkbox'?'checked':'value';
  try{const v=localStorage.getItem(key);if(v!==null)c[prop]=prop==='checked'?v==='1':v}catch{}
  c.addEventListener('change',()=>{try{localStorage.setItem(key,prop==='checked'?(c.checked?'1':'0'):c.value)}catch{}close()});
 }
 setStatus();
 return {index,load,lookup:text=>ready.then(()=>segment(text))};
})();
