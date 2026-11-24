/* Tap a lyric or direction in the score to see its meaning. Sources: the score's own
   word list (a local JSON file, kept on this device) first, then the built-in term list. */
const wordLookup=(()=>{
 const $=id=>document.getElementById(id);
 const LANGS={it:'イタリア語',de:'ドイツ語',fr:'フランス語',en:'英語',la:'ラテン語'};
 let terms=new Map(),words=new Map(),wordsInfo=null,storeKey='',popup=null,active=[];
 const lyricNodes=new WeakMap();
 // Whole words from the original MusicXML. Hiding empty staves draws each system as its own
 // slice of bars, so a word that runs over a system break (fa-sci-no | ri-bi-le) is cut there in
 // OSMD's model. Key: part index|bar index|verse|n-th lyric of that verse in the bar.
 let sourceWords=new Map();
 function source(xml){
  sourceWords=new Map();
  try{
   const d=new DOMParser().parseFromString(xml,'application/xml');
   const lines=new Map();
   [...d.querySelectorAll('score-partwise > part')].forEach((part,pi)=>{
    const open=new Map();
    [...part.children].filter(e=>e.tagName==='measure').forEach((m,mi)=>{
     const nth=new Map();
     for(const n of m.querySelectorAll(':scope > note'))for(const l of n.querySelectorAll(':scope > lyric')){
      const verse=l.getAttribute('number')||'1',voice=n.querySelector(':scope > voice')?.textContent||'1';
      const text=[...l.children].filter(e=>e.tagName==='text'||e.tagName==='elision').map(e=>e.textContent).join('');
      if(!text)continue;
      const k=nth.get(verse)||0;nth.set(verse,k+1);
      const syl=l.querySelector(':scope > syllabic')?.textContent||'single',ok=voice+'|'+verse;
      let word;
      if(syl==='begin'||!open.has(ok)&&syl!=='single')word=[];else word=syl==='single'?[]:open.get(ok);
      if(!word.length){const lk=pi+'|'+ok;if(!lines.has(lk))lines.set(lk,[]);lines.get(lk).push(word)}
      word.push({text,bar:mi});
      if(syl==='begin'||syl==='middle')open.set(ok,word);else open.delete(ok);
      sourceWords.set([pi,mi,verse,k].join('|'),{word,text,pos:word.length-1});
     }
    });
   });
   // Each chain of syllables knows the words of its whole line (one part, voice and verse), so a
   // tapped lyric can be shown inside its phrase.
   for(const chains of lines.values()){
    const tokens=[];
    for(const c of chains){c.start=tokens.length;c.line=tokens;tokens.push(...c.map(x=>x.text).join('').split(SPACE).filter(Boolean))}
   }
  }catch(e){console.error('word-lookup source',e)}
 }
 // "lio ad" is one sung syllable from two words; an elision mark (‿) also separates words.
 const SPACE=/[\s‿]+/,PHRASE_END=/[.;:!?…]["'»”’)\]]*$/,PHRASE_REACH=8;
 // The phrase around syllable `pos` of a chain: from the last sentence mark (. ; : ! ?) before it
 // to the next one after it, at most PHRASE_REACH words on each side. Commas do not end a phrase
 // ("Non piangere," alone says too little).
 function phraseOf(chain,pos){
  const tokens=chain.line,i=chain.start+chain.slice(0,pos).map(x=>x.text).join('').split(SPACE).length-1;
  if(!tokens||!tokens[i])return null;
  let a=i,b=i;
  while(a>0&&i-a<PHRASE_REACH&&!PHRASE_END.test(tokens[a-1]))a--;
  while(b<tokens.length-1&&b-i<PHRASE_REACH&&!PHRASE_END.test(tokens[b]))b++;
  return {words:tokens.slice(a,b+1),at:i-a};
 }
 // Keys are compared lower-cased, without surrounding punctuation; fold() also drops accents.
 const token=s=>s.replace(/^[^\p{L}\p{N}]+/u,'').replace(/[^\p{L}\p{N}'’]+$/u,'');
 const norm=s=>s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g,"'").split(/\s+/).map(token).filter(Boolean).join(' ');
 const fold=s=>norm(s).replace(/æ/g,'ae').replace(/œ/g,'oe').normalize('NFD').replace(/\p{M}/gu,'');
 function table(entries){const t=new Map();for(const [k,v] of Object.entries(entries||{})){if(!v||typeof v!=='object')continue;const e={...v,key:k};t.set(norm(k),e);if(!t.has(fold(k)))t.set(fold(k),e)}t.delete('');return t}
 const ready=fetch('music-terms.json?v=3').then(r=>r.json()).then(j=>{terms=table(j.entries)}).catch(e=>console.error('music-terms.json',e));
 // Lyrics use only the score's word list; the term list would mislabel e.g. German "in" as Italian.
 const find=(k,lyrics)=>{for(const [t,src] of lyrics?[[words,'words']]:[[words,'words'],[terms,'terms']]){const e=t.get(norm(k))||t.get(fold(k));if(e)return {entry:e,src}}return null};
 // Longest matching phrase first, so "poco a poco cresc." becomes two entries.
 function segment(text,lyrics=false){
  const toks=text.replace(/[—–/,;:!?¡¿]/g,' ').split(/\s+/).filter(t=>/[\p{L}]/u.test(t)),found=[],unknown=[],order=[];
  const hitAt=item=>{found.push(item);order.push(item)},miss=text=>{if(text){unknown.push(text);order.push({text})}};
  for(let i=0;i<toks.length;){
   let n=Math.min(6,toks.length-i),hit=null;
   for(;n>0&&!(hit=find(toks.slice(i,i+n).join(' '),lyrics));n--);
   if(hit){hitAt({text:toks.slice(i,i+n).map(token).join(' '),...hit});i+=n;continue}
   // Split elisions (dell'atto → dell' + atto) and hyphenated words; no lookbehind for older iOS.
   const parts=toks[i].replace(/['’]/g,"'\n").split(/\n|-/).filter(p=>/[\p{L}]/u.test(p)),sub=parts.length>1?parts.map(p=>({p,h:find(p,lyrics)})):[];
   if(sub.some(s=>s.h))for(const s of sub)s.h?hitAt({text:s.p,...s.h}):miss(token(s.p));
   else miss(token(toks[i]));
   i++;
  }
  return {found,unknown,order};
 }
 // Word-by-word table in text order: the original on top, the English below; it wraps like text.
 const glossEntry=new WeakMap();
 // Scroll inside the popup only; the score behind it stays where it is.
 function scrollPopup(target){popup.scrollTo({top:Math.max(0,target.offsetTop-8),behavior:'smooth'})}
 function gloss(order,lang){
  const box=el('div','word-gloss');box.setAttribute('role','group');box.setAttribute('aria-label','対応表（単語を押すと解説へ移動）');
  // The translation rows follow the "対応表の訳" setting: English, Japanese or both.
  const mode=$('gloss-lang').value,rows=mode==='both'?['ja','en']:[mode];
  const first={en:t=>t.split(/;\s*/)[0],ja:t=>t.split(/[／;；、]/)[0]};
  const cell=(tag,top,lines,cls)=>{const c=el(tag,'word-gloss-cell'+(cls?' '+cls:''));c.append(el('span','word-gloss-src',top));rows.forEach((r,i)=>c.append(el('span','word-gloss-'+r,lines[i])));return c};
  box.append(cell('div',LANGS[lang]||'原文',rows.map(r=>r==='ja'?'日本語':'英語'),'word-gloss-legend'));
  for(const item of order){
   if(!item.entry){box.append(cell('div',item.text,rows.map(()=>'—'),'word-gloss-unknown'));continue}
   const e=item.entry,c=cell('button',item.text,rows.map(r=>{const t=e[r]||e[r==='ja'?'en':'ja'];return t?first[e[r]?r:(r==='ja'?'en':'ja')](t):'—'}));c.type='button';c.dataset.entry='';glossEntry.set(c,item.entry);box.append(c);
  }
  return box;
 }
 const chordLike=/^[A-H][♭♯#b]?(m|maj|min|dim|aug|sus|add|ø|°|\+)?[\d()♭♯#b+°ø/A-Hmajsudi]*$/;
 const dynamic=/^(p{1,4}|f{1,4}|m[pf]|s?f+z?|sfp|fp|rfz?)$/;
 function lookupable(text){
  if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))return false;
  const toks=text.split(/\s+/).map(token).filter(Boolean);
  return dynamic.test(text.trim())||toks.some(t=>/\p{L}{2}/u.test(t)&&!chordLike.test(t));
 }
 function index(engine){
  close();const nodes=new Map(),nth=new Map();
  const sheet=engine.Sheet,offset=engine.measureOffset||0;
  for(const measure of engine.GraphicSheet?.MeasureList.flat()||[])for(const staffEntry of measure?.staffEntries||[])for(const lyric of staffEntry.LyricsEntries||[]){
   const node=lyric.GraphicalLabel?.SVGNode,entry=lyric.LyricsEntry;if(!node||!entry)continue;
   // Find this syllable in the original MusicXML to recover the whole word.
   let full=null,pos=0;
   const pi=sheet?.Instruments.indexOf(measure.ParentStaff?.ParentInstrument),sm=measure.parentSourceMeasure;
   const mi=sheet&&sm?sheet.SourceMeasures.indexOf(sm)+offset:-1,verse=String(entry.VerseNumber??'1');
   if(pi>=0&&mi>=0){
    const base=[pi,mi,verse].join('|'),k=nth.get(base)||0;nth.set(base,k+1);
    let hit=sourceWords.get(base+'|'+k);
    if(!hit||hit.text!==entry.Text)for(let j=0;(hit=sourceWords.get(base+'|'+j));j++)if(hit.text===entry.Text)break;
    full=hit?.word||null;pos=hit?.pos??0;
   }
   lyricNodes.set(node,{entry,nodes,full,pos});nodes.set(entry,node);
  }
  for(const text of engine.container?.querySelectorAll('svg text')||[])
   if(scoreLabels.folded(text.textContent))text.classList.add('word-lookup','note-fold');
   else if(!text.classList.contains('part-label')&&(lyricNodes.has(text.parentNode)||lookupable(text.textContent)))text.classList.add('word-lookup');
 }
 // With word lookup off, folded notes still open: their full text is otherwise unreadable.
 function target(x,y,foldsOnly){
  const pad=matchMedia('(pointer: coarse)').matches?14:6;let best=null,bestD=Infinity;
  for(const t of document.querySelectorAll(foldsOnly?'#score-frame text.note-fold':'#score-frame text.word-lookup')){
   const r=t.getBoundingClientRect();if(!r.width)continue;
   const dx=Math.max(r.left-x,0,x-r.right),dy=Math.max(r.top-y,0,y-r.bottom);if(dx>pad||dy>pad)continue;
   const d=dx*dx+dy*dy;if(d<bestD){best=t;bestD=d}
  }
  return best;
 }
 const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
 // Pronunciation with the device's own voices only (localService), so no text leaves the device.
 // Latin is read with an Italian voice; church Latin is close to Italian pronunciation.
 const VOICES={female:['Alice','Federica','Paola','Emma','Anna','Petra','Helena','Amélie','Audrey','Aurélie','Marie','Samantha','Karen','Moira','Tessa','Serena','Kate','Kathy','Victoria','Flo','Sandy','Shelley','Grandma'],
  male:['Luca','Cosimo','Paolo','Markus','Yannick','Martin','Jacques','Thomas','Daniel','Arthur','Oliver','Alex','Aaron','Fred','Ralph','Albert','Tom','Eddy','Reed','Rocko','Grandpa']};
 const localVoices=()=>'speechSynthesis' in window?speechSynthesis.getVoices().filter(v=>v.localService):[];
 if('speechSynthesis' in window)speechSynthesis.getVoices();  // starts loading the voice list
 // "Markus (Enhanced)", "Markus（拡張）" (Japanese UI) and "Eddy (German (Germany))" all reduce to the first word.
 const baseName=v=>v.name.split(/\s*[(（]/)[0].trim();
 function pickVoice(list,lang,gender){
  const code=lang==='la'?'it':lang||'it',mine=list.filter(v=>v.lang.toLowerCase().replace('_','-').startsWith(code));
  const best=names=>mine.filter(v=>names.includes(baseName(v))).sort((a,b)=>names.indexOf(baseName(a))-names.indexOf(baseName(b)))[0];
  return {code,voice:best(VOICES[gender])||best(VOICES[gender==='male'?'female':'male'])||mine[0]||null};
 }
 async function speak(text,lang,gender,note){
  if(!('speechSynthesis' in window)){note.textContent='このブラウザーは音声読み上げに対応していません';return}
  let list=localVoices();
  if(!list.length){await new Promise(r=>{speechSynthesis.addEventListener('voiceschanged',r,{once:true});setTimeout(r,1500)});list=localVoices()}
  const {code,voice}=pickVoice(list,lang,gender);
  if(!voice){note.textContent=`この端末に${LANGS[code]||code}の音声がありません（端末の設定で追加できます）`;return}
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.voice=voice;u.lang=voice.lang;u.rate=Number($('voice-rate').value)||1;speechSynthesis.speak(u);
  const matched=VOICES[gender].includes(baseName(voice));
  note.textContent=`声：${voice.name}${matched?'':`（${gender==='male'?'男性':'女性'}の声がないため）`}${lang==='la'?' · ラテン語はイタリア語の声で読みます':''}`;
 }
 function speakButtons(text,lang,label){
  const box=el('div','word-speak'),note=el('small','word-voice');if(label)box.append(el('span','word-speak-label',label));
  for(const [gender,label] of [['female','▶ 女性の声'],['male','▶ 男性の声']]){const b=el('button','',label);b.type='button';b.onclick=()=>speak(text,lang,gender,note);box.append(b)}
  box.append(note);return box;
 }
 const spoken=item=>item.entry.full&&!/\//.test(item.entry.full)?item.entry.full:item.text;
 function describe(item,lyricLang,speakable){
  const e=item.entry,box=el('div','word-entry'),mode=$('word-lang').value,head=el('div','word-term');
  head.append(el('strong','',item.text));
  const meta=[e.full&&'→ '+e.full,LANGS[e.lang]].filter(Boolean).join('・');if(meta)head.append(el('small','',' '+meta));
  box.append(head);
  if(speakable)box.append(speakButtons(spoken(item),item.src==='words'?lyricLang:e.lang));
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
  const lyric=lyricNodes.get(text.parentNode);let label=text.textContent.trim(),detail='',result,phrase=null,tapped='';
  if(lyric){
   const syllables=lyric.entry.Word?.Syllables||[lyric.entry];
   const parts=lyric.full&&lyric.full.length>=syllables.length?lyric.full.map(s=>s.text):syllables.map(s=>s.Text),whole=parts.join('');
   label=whole;if(parts.length>1)detail=parts.join('-');
   phrase=$('lyric-phrase').checked&&lyric.full?.line?phraseOf(lyric.full,lyric.pos):null;
   if(phrase&&phrase.words.length>1){
    // The tapped word heads the popup; its phrase, table and entries follow, the tapped word first.
    label=token(phrase.words[phrase.at])||phrase.words[phrase.at];tapped=norm(label);
    result=segment(phrase.words.join(' '),true);
    const mine=item=>norm(item.text).split(' ').includes(tapped);
    result.found=[...result.found.filter(mine),...result.found.filter(x=>!mine(x))];
   }else{
    phrase=null;
    const hit=find(whole,true);result=hit?{found:[{text:token(whole),...hit}],unknown:[],order:[]}:segment(whole,true);
   }
   active=syllables.map(s=>lyric.nodes.get(s)?.querySelector('text')).filter(Boolean);
  }else{
   const full=scoreLabels.folded(label);if(full)label=full;
   result=full&&!lookupable(full)?{found:[],unknown:[],order:[]}:segment(label);active=[text];
  }
  for(const n of active)n.classList.add('word-active');
  popup=el('div','');popup.id='word-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','単語の意味');
  const closeButton=el('button','word-close','×');closeButton.setAttribute('aria-label','閉じる');closeButton.onclick=close;
  const head=el('div','word-head');head.append(el('strong','',label));if(detail)head.append(el('small','',' '+detail));
  const lyricLang=wordsInfo?.language||'it',first=result.found[0];
  const speakText=lyric?label.replace(/[^\p{L}\p{N}'’ -]+/gu,' ').trim():result.found.map(spoken).join(' ')||label;
  const note=!lyric&&text.classList.contains('note-fold');if(note){popup.classList.add('note-popup');popup.setAttribute('aria-label','ト書き・コメント')}
  const speakLang=lyric||first?.src==='words'?lyricLang:first?.entry.lang||lyricLang;
  popup.append(closeButton,head);
  if(phrase){
   const line=el('div','word-phrase');phrase.words.forEach((w,i)=>{if(i)line.append(' ');line.append(i===phrase.at?el('b','',w):w)});popup.append(line);
   popup.append(speakButtons(speakText,speakLang,'単語'),speakButtons(phrase.words.join(' ').replace(/[^\p{L}\p{N}'’ -]+/gu,' ').trim(),speakLang,'フレーズ'));
  }else if(!note||result.found.length)popup.append(speakButtons(speakText,speakLang));
  const table=result.order.length>1&&result.found.length?gloss(result.order,speakLang):null;if(table)popup.append(table);
  if(table&&tapped)for(const c of table.querySelectorAll('.word-gloss-cell:not(.word-gloss-legend)'))if(norm(c.querySelector('.word-gloss-src').textContent).split(' ').includes(tapped))c.classList.add('word-gloss-here');
  // A long stage direction repeats "a", "la"…: each entry is shown once.
  const shown=new Map();for(const item of result.found){if(shown.has(item.entry))continue;const box=describe(item,lyricLang,result.found.length>1);shown.set(item.entry,box);popup.append(box)}
  // A word in the table jumps to its entry below, which flashes; each entry links back to the table.
  if(table){
   for(const c of table.querySelectorAll('button.word-gloss-cell'))c.onclick=()=>{const box=shown.get(glossEntry.get(c));if(!box)return;scrollPopup(box);box.classList.remove('word-flash');void box.offsetWidth;box.classList.add('word-flash')};
   for(const box of shown.values()){const back=el('button','word-back','↑ 表へ戻る');back.type='button';back.onclick=()=>scrollPopup(table);box.querySelector('.word-term').append(back)}
  }
  if(result.unknown.length)popup.append(el('div','word-unknown',(result.found.length?'未登録：':'辞書・単語帳に未登録です：')+[...new Set(result.unknown)].join(' ')));
  if(!wordsInfo&&(lyric||note&&result.unknown.length))popup.append(el('div','word-hint',(lyric?'歌詞':'ト書き')+'の意味は「設定」→「単語の意味」から曲の単語帳を読み込むと表示されます。'));
  const copy=el('button','word-copy','原文をコピー');copy.onclick=async()=>{try{await navigator.clipboard.writeText(phrase?phrase.words.join(' '):label);copy.textContent='コピーしました'}catch{copy.textContent='コピーできませんでした'}};
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
  const text=target(e.clientX,e.clientY,!$('word-tap').checked);
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
  words=table(json.entries);wordsInfo={title:json.title||name,count:Object.keys(json.entries).length,language:typeof json.language==='string'?json.language.toLowerCase().slice(0,2):''};
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
 for(const [id,key] of [['lyric-phrase','score-viewer-lyric-phrase'],['gloss-lang','score-viewer-gloss-lang'],['word-tap','score-viewer-word-tap'],['word-lang','score-viewer-word-lang'],['voice-rate','score-viewer-voice-rate']]){
  const c=$(id),prop=c.type==='checkbox'?'checked':'value';
  try{const v=localStorage.getItem(key);if(v!==null)c[prop]=prop==='checked'?v==='1':v}catch{}
  c.addEventListener('change',()=>{try{localStorage.setItem(key,prop==='checked'?(c.checked?'1':'0'):c.value)}catch{}close()});
 }
 setStatus();
 return {index,load,source,lookup:text=>ready.then(()=>segment(text))};
})();
