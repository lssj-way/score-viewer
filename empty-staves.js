/* Read labels from MusicXML only. Later sections use the abbreviation as
   their first-system label because each section has a separate renderer. */
const scoreLabels=(()=>{
 function displayXML(xml,shortFirst=false){
  const d=new DOMParser().parseFromString(xml,'application/xml');
  for(const p of d.querySelectorAll('part-list > score-part')){
   const short=p.querySelector('part-abbreviation')?.textContent?.trim()||'';
   const abbr=p.querySelector('part-abbreviation');
   if(abbr)abbr.textContent=short;
   p.querySelector('part-abbreviation-display')?.remove();
   if(shortFirst){
    const name=p.querySelector('part-name');
    if(name)name.textContent=short;
    p.querySelector('part-name-display')?.remove();
   }
  }
  // Formatted overrides must not introduce labels absent from part-abbreviation.
  d.querySelectorAll('print > part-abbreviation-display').forEach(e=>e.remove());
  if(shortFirst)d.querySelectorAll('print > part-name-display').forEach(e=>e.remove());
  // A playback-only tempo (<sound tempo> with no printed mark) made OSMD draw "♩ = 58" on top of
  // the tempo words; the printed score has no such mark. Playback reads the original XML.
  for(const direction of d.querySelectorAll('direction')){
   if(direction.querySelector('metronome'))continue;
   const shown=[...direction.querySelectorAll('direction-type > *')].some(e=>e.tagName!=='words'||e.textContent.trim());
   if(!shown&&direction.querySelector('sound[tempo]'))direction.remove();
  }
  if(document.getElementById('fold-notes')?.checked)foldNotes(d,xml);
  return new XMLSerializer().serializeToString(d);
 }
 // Long stage directions and comments become their first words plus "…"; tapping the short
 // label shows the whole text (word-lookup.js). Tempo words such as "Andante sostenuto" stay.
 let folded=new Map(),foldedFor=null;
 const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
 function long(text){
  if(cjk.test(text))return text.length>12;
  return /^[(\[（]/.test(text)?text.length>16:text.length>30;
 }
 function shorten(text,words){
  const open=text.match(/^[(\[（]/)?.[0]||'',close={'(':')','[':']','（':'）'}[open]||'';
  const body=text.slice(open.length).replace(/[)\]）]$/,'');
  const head=cjk.test(body)?[...body].slice(0,6+words*2).join(''):body.split(' ').slice(0,1+words).join(' ').replace(/[,;:.]$/,'');
  return open+head+'…'+close;
 }
 function foldNotes(d,xml){
  if(foldedFor!==xml){folded=new Map();foldedFor=xml}
  for(const direction of d.querySelectorAll('direction')){
   if(/^(prelude|minne)-analysis-/.test(direction.id))continue;
   const words=[...direction.querySelectorAll('direction-type > words')];if(!words.length)continue;
   const text=words.map(w=>w.textContent).join(' ').replace(/\s+/g,' ').trim();if(!long(text))continue;
   // Two-word labels, longer when another note starts with the same words.
   let label;for(let n=1;n<12;n++){label=shorten(text,n);const other=folded.get(label);if(!other||other===text)break}
   folded.set(label,text);words[0].textContent=label;for(const w of words.slice(1)){const type=w.parentNode;w.remove();if(!type.children.length)type.remove()}
  }
 }
 return {displayXML,folded:label=>folded.get(label.trim())};
})();

/* Display-only reduction. Every renderer loads the complete original score so that
   clefs, keys, ties and measure identity are not lost by slicing XML. */
const emptyStaves=(()=>{
 let doc,parts=[],generation=0;
 const pinned=()=>new Set([...document.querySelectorAll('#pinned-parts input:checked')].map(x=>x.value));
 function load(xml){
  generation++;doc=new DOMParser().parseFromString(xml,'application/xml');
  parts=[...doc.querySelectorAll('score-partwise > part')];
  const box=document.getElementById('pinned-parts');box.replaceChildren();
  const labels=[...doc.querySelectorAll('score-part')];
  parts.forEach((p,i)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=p.id;input.onchange=()=>redraw();label.append(input,document.createTextNode(' '+(labels.find(l=>l.id===p.id)?.querySelector('part-name')?.textContent||p.id)+' ['+p.id+']'));box.append(label)});
 }
 function globalDirection(d){
  return !d.querySelector('words,dynamics,wedge,pedal,octave-shift,dashes,bracket') && !!d.querySelector('metronome,rehearsal,sound[tempo]');
 }
 // Each section has its own renderer and gets only its own bars (plus the clef, key, time and
 // divisions in force at its first bar): loading the whole score into every section made a
 // 195-bar score take about 1.5 GB, which iPhone Safari cannot hold.
 let baseCache={xml:null,docs:{}};
 function baseDoc(xml,shortFirst){
  const key=xml+(document.getElementById('fold-notes')?.checked?'\u0001':'');if(baseCache.xml!==key)baseCache={xml:key,docs:{}};
  return baseCache.docs[shortFirst]??=new DOMParser().parseFromString(scoreLabels.displayXML(xml,shortFirst),'application/xml');
 }
 const measuresOf=part=>[...part.children].filter(m=>m.tagName==='measure');
 // Attributes in force at the start of bar `start`, as one <attributes> element for that bar.
 function carriedAttributes(out,measures,start){
  const state={divisions:null,keys:new Map(),time:null,staves:null,symbol:null,clefs:new Map(),details:new Map(),transpose:null};
  for(const m of measures.slice(0,start))for(const at of m.querySelectorAll(':scope > attributes'))for(const c of at.children){
   const n=c.getAttribute('number')||'1';
   if(c.tagName==='divisions')state.divisions=c;else if(c.tagName==='key')state.keys.set(n,c);else if(c.tagName==='time')state.time=c;
   else if(c.tagName==='staves')state.staves=c;else if(c.tagName==='part-symbol')state.symbol=c;else if(c.tagName==='clef')state.clefs.set(n,c);
   else if(c.tagName==='staff-details')state.details.set(n,c);else if(c.tagName==='transpose')state.transpose=c;
  }
  const own=measures[start]?.querySelector(':scope > attributes > time'),el=out.createElement('attributes');
  for(const c of [state.divisions,...state.keys.values(),state.time,state.staves,state.symbol,...state.clefs.values(),...state.details.values(),state.transpose]){
   if(!c)continue;const copy=out.importNode(c,true);
   // The time signature is shown only where the score itself writes one.
   if(c===state.time&&!own)copy.setAttribute('print-object','no');
   el.append(copy);
  }
  return el.children.length?el:null;
 }
 function sectionDoc(xml,shortFirst,start,end){
  const full=baseDoc(xml,shortFirst),root=full.documentElement,out=document.implementation.createDocument(null,null,null);
  const top=out.importNode(root,false);out.append(top);
  for(const child of root.children){
   if(child.tagName!=='part'){top.append(out.importNode(child,true));continue}
   const part=out.importNode(child,false),measures=measuresOf(child);top.append(part);
   measures.slice(start,end+1).forEach((m,i)=>{const copy=out.importNode(m,true);if(i===0&&start>0){const at=carriedAttributes(out,measures,start);if(at)copy.prepend(at)}part.append(copy)});
  }
  return {full,out};
 }
 // OSMD drops a hairpin whose start or end lies outside the drawn bars. Hairpins crossing the
 // section edges are cut there: a matching start is added at the first bar and a stop at the
 // last note of the last bar, so each section draws its part.
 function splitWedges(full,out,start,end){
  const outParts=[...out.querySelectorAll('score-partwise > part')];
  [...full.querySelectorAll('score-partwise > part')].forEach((fullPart,pi)=>{
   const measures=measuresOf(fullPart),sliced=measuresOf(outParts[pi]),open=new Map(),spans=[];
   measures.forEach((m,mi)=>{for(const w of m.querySelectorAll('direction > direction-type > wedge')){
    const d=w.parentNode.parentNode,staff=d.querySelector(':scope > staff')?.textContent||'1',key=staff+'/'+(w.getAttribute('number')||'1'),type=w.getAttribute('type');
    if(type==='crescendo'||type==='diminuendo')open.set(key,{type,staff,number:w.getAttribute('number'),placement:d.getAttribute('placement'),from:mi});
    else if(type==='stop'&&open.has(key)){spans.push({...open.get(key),to:mi});open.delete(key)}
   }});
   const direction=(type,span)=>{const d=out.createElement('direction');if(span.placement)d.setAttribute('placement',span.placement);const t=out.createElement('direction-type'),w=out.createElement('wedge');w.setAttribute('type',type);if(span.number)w.setAttribute('number',span.number);t.append(w);d.append(t);const st=out.createElement('staff');st.textContent=span.staff;d.append(st);return d};
   for(const span of spans){
    const first=sliced[0],last=sliced[end-start];
    if(span.from<start&&span.to>=start&&first)first.insertBefore(direction(span.type,span),first.querySelector(':scope > note')||null);
    if(span.from<=end&&span.to>end&&span.to>=start&&last){
     // Insert before the note that starts last in this staff, so the stop stays inside the bar.
     let pos=0,lastStart=0,best=null,bestAt=-1;
     for(const el of last.children){
      const dur=Number(el.querySelector(':scope > duration')?.textContent||0);
      if(el.tagName==='backup')pos-=dur;else if(el.tagName==='forward')pos+=dur;
      else if(el.tagName==='note'&&!el.querySelector(':scope > grace')){const chord=!!el.querySelector(':scope > chord'),at=chord?lastStart:pos;if(!chord){lastStart=at;pos+=dur}
       if(!chord&&(el.querySelector(':scope > staff')?.textContent||'1')===span.staff&&at>=bestAt){bestAt=at;best=el}}
     }
     last.insertBefore(direction('stop',span),best);
    }
   }
  });
 }
 function displayXML(xml,keep,shortFirst,start,end){
  const {full,out}=sectionDoc(xml,shortFirst,start,end);
  splitWedges(full,out,start,end);
  const ps=[...out.querySelectorAll('score-partwise > part')];
  const target=ps[keep.findIndex(Boolean)];
  ps.forEach((p,i)=>{if(keep[i])return;measuresOf(p).forEach((m,mi)=>{
   for(const d of [...m.children].filter(e=>e.tagName==='direction'&&globalDirection(e))){
    const cloned=d.cloneNode(true);for(const e of [...cloned.querySelectorAll('staff,voice')])e.remove();
    const tm=measuresOf(target)[mi];if(tm)tm.insertBefore(cloned,[...tm.children].find(e=>e.tagName!=='attributes')||null);d.remove();
   }
  })});return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(out);
 }
 function visible(a,b,first){
  const pins=pinned();
  const keep=parts.map(p=>pins.has(p.id)||first||[...p.children].slice(a,b+1).some(m=>
   [...m.querySelectorAll('note')].some(n=>!n.querySelector('rest'))||
   [...m.querySelectorAll('direction')].some(d=>!globalDirection(d))||m.querySelector('harmony, barline repeat, barline ending')));
  if(!keep.some(Boolean)&&keep.length)keep[0]=true;
  return keep;
 }
 function apply(engine,keep){engine.Sheet.Instruments.forEach((p,i)=>p.Visible=keep[i]!==false)}
 function configure(e,a,b,zoom){e.EngravingRules.MinMeasureToDrawIndex=a;e.EngravingRules.MaxMeasureToDrawIndex=b;e.EngravingRules.MinMeasureToDrawNumber=0;e.EngravingRules.MaxMeasureToDrawNumber=0;e.Zoom=zoom}
 // Two OSMD 1.9.2 workarounds, installed once on the shared calculator classes.
 // 1. Every tempo word (rit., Allegro, animato…) is skipped when the drawn range does not start at
 //    the first bar. The check is lifted for that one step; only bars in range are computed.
 // 2. At some page widths one slur's curve fails (findGraphicalNoteFromNote of undefined) and the
 //    whole render aborts. The failing slur is skipped and the rest of the score is drawn.
 let patched=false;
 const ownerOf=(object,name)=>{let p=Object.getPrototypeOf(object);while(p&&!Object.prototype.hasOwnProperty.call(p,name))p=Object.getPrototypeOf(p);return p};
 function patchOSMD(engine){
  if(patched)return;const calc=engine.graphic?.calculator;if(!calc)return;
  const tempo=ownerOf(calc,'calculateTempoExpressionsForMultiTempoExpression'),slurs=ownerOf(calc,'calculateSlurs');
  if(tempo){const original=tempo.calculateTempoExpressionsForMultiTempoExpression;
   tempo.calculateTempoExpressionsForMultiTempoExpression=function(...args){const min=this.rules.MinMeasureToDrawIndex;this.rules.MinMeasureToDrawIndex=0;try{return original.apply(this,args)}finally{this.rules.MinMeasureToDrawIndex=min}}}
  if(slurs){const original=slurs.calculateSlurs;
   slurs.calculateSlurs=function(){
    try{return original.call(this)}catch(error){
     // The slurs were all created before the curves; redo the curves one by one.
     let skipped=0;
     for(const system of this.musicSystems)for(const line of system.StaffLines)for(const slur of line.GraphicalSlurs){
      if(slur.slur.isCrossed())continue;try{slur.calculateCurve(this.rules)}catch{slur.slur.isCrossed=()=>true;skipped++}
     }
     console.warn('スラーを描けないため省略しました:',skipped,error);
    }
   }}
  patched=true;
 }
 async function render(engine,xml){
  const token=++generation,a=Number(document.getElementById('from').value)-1,b=Number(document.getElementById('to').value)-1;
  const host=document.getElementById('score');host.style.display='';document.getElementById('reduced-score')?.remove();
  apply(engine,parts.map(()=>true));patchOSMD(engine);engine.render();measureLabels.apply(engine);partMixer.labels(engine);wordLookup.index(engine);playCursor.index(engine);
  if(!document.getElementById('hide-empty').checked){document.getElementById('visibility-status').textContent='全声部を表示';return}
  let ranges=[[a,b]];
  if(document.getElementById('hide-mode').value==='system'){
   const source=engine.Sheet.SourceMeasures;
   ranges=engine.GraphicSheet.MusicPages.flatMap(p=>p.MusicSystems).map(s=>{
    const indices=s.GraphicalMeasures.flat().map(m=>source.indexOf(m.parentSourceMeasure)).filter(i=>i>=a&&i<=b);
    return indices.length?[Math.min(...indices),Math.max(...indices)]:null;
   }).filter(Boolean);
   if(!ranges.length)ranges=[[a,b]];
  }
  // Adjacent systems with the same visible instruments share one renderer.
  const merged=[];for(const r of ranges){const signature=visible(r[0],r[1],r[0]===0&&document.getElementById('show-first').checked).join(',');const last=merged[merged.length-1];if(last&&last.signature===signature&&last.range[1]+1===r[0])last.range[1]=r[1];else merged.push({signature,range:[...r]});}ranges=merged.map(x=>x.range);
  const reduced=document.createElement('div');reduced.id='reduced-score';host.after(reduced);
  let hidden=0;
  try{
   for(const [start,end] of ranges){
    await new Promise(resolve=>setTimeout(resolve,0));
    if(token!==generation){reduced.remove();return}
    const keep=visible(start,end,start===0&&document.getElementById('show-first').checked);hidden+=keep.filter(x=>!x).length;
    const section=document.createElement('section');section.dataset.from=start+1;section.dataset.to=end+1;section.dataset.visible=parts.filter((p,i)=>keep[i]).map(p=>p.id).join(',');section.setAttribute('aria-label',`${start+1}〜${end+1}小節`);reduced.append(section);
    const annotations=[];parts.forEach((p,i)=>{if(keep[i])return;[...p.children].slice(start,end+1).forEach(m=>{
     for(const d of m.querySelectorAll('direction'))if(globalDirection(d)){
      const metro=d.querySelector('metronome'),rehearsal=d.querySelector('rehearsal'),tempo=d.querySelector('sound[tempo]');
      const text=rehearsal?.textContent||(metro?`${({whole:'𝅝',half:'𝅗𝅥',quarter:'♩',eighth:'♪', '16th':'𝅘𝅥𝅯','32nd':'𝅘𝅥𝅰','64th':'𝅘𝅥𝅱',breve:'𝅜'})[metro.querySelector('beat-unit')?.textContent.trim()]||metro.querySelector('beat-unit')?.textContent.trim()||'♩'}${metro.querySelector('beat-unit-dot')?'·':''} = ${metro.querySelector('per-minute')?.textContent||''}`:tempo?`♩ = ${tempo.getAttribute('tempo')}`:'');if(text)annotations.push(text);
     }
    })});
    if(annotations.length){const label=document.createElement('p');label.textContent=[...new Set(annotations)].join(' · ');section.append(label)}
    const renderer=new opensheetmusicdisplay.OpenSheetMusicDisplay(section,{autoResize:false,backend:'svg',drawTitle:start===0,drawSubtitle:false,drawComposer:false,drawMeasureNumbers:true,measureNumberInterval:1,useXMLMeasureNumbers:true,drawPartNames:true,drawPartAbbreviations:true});renderer.setLogLevel('error');
    await renderer.load(displayXML(xml,keep,start>0,start,end));if(token!==generation){reduced.remove();return}
    renderer.measureOffset=start;configure(renderer,0,end-start,engine.Zoom);apply(renderer,keep);renderer.render();measureLabels.apply(renderer);partMixer.labels(renderer);wordLookup.index(renderer);playCursor.index(renderer);
    // Keep semantic mapping on the output instead of relying on SVG element order.
    section.dataset.staves=renderer.Sheet.Instruments.filter((p,i)=>keep[i]).reduce((n,p)=>n+p.Staves.length,0);
   }
   if(token!==generation)return;
   host.style.display='none';engine.drawer?.clear();document.getElementById('visibility-status').textContent=`${ranges.length}区間を表示・延べ${hidden}パートを省略（記号のある五線は保持）`;
  }catch(e){reduced.remove();host.style.display='';if(!host.querySelector('svg')){engine.render();measureLabels.apply(engine);partMixer.labels(engine);wordLookup.index(engine);playCursor.index(engine)}document.getElementById('visibility-status').textContent='省略表示を作成できないため全声部を表示しています';console.error(e)}
 }
 for(const id of ['hide-empty','hide-mode','show-first'])document.getElementById(id).onchange=()=>redraw();
 return {load,render};
})();
