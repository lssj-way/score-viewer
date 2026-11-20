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
  return new XMLSerializer().serializeToString(d);
 }
 return {displayXML};
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
 // Each section has its own renderer, and OSMD drops a hairpin whose start or end lies outside
 // the drawn range. Hairpins crossing the section edges are cut there: a matching start is added
 // at the first bar and a stop at the last note of the last bar, so each section draws its part.
 function splitWedges(copy,start,end){
  for(const part of copy.querySelectorAll('score-partwise > part')){
   const measures=[...part.children].filter(m=>m.tagName==='measure'),open=new Map(),spans=[];
   measures.forEach((m,mi)=>{for(const w of m.querySelectorAll('direction > direction-type > wedge')){
    const d=w.parentNode.parentNode,staff=d.querySelector(':scope > staff')?.textContent||'1',key=staff+'/'+(w.getAttribute('number')||'1'),type=w.getAttribute('type');
    if(type==='crescendo'||type==='diminuendo')open.set(key,{type,staff,number:w.getAttribute('number'),placement:d.getAttribute('placement'),from:mi});
    else if(type==='stop'&&open.has(key)){spans.push({...open.get(key),to:mi});open.delete(key)}
   }});
   const direction=(type,span)=>{const d=copy.createElement('direction');if(span.placement)d.setAttribute('placement',span.placement);const t=copy.createElement('direction-type'),w=copy.createElement('wedge');w.setAttribute('type',type);if(span.number)w.setAttribute('number',span.number);t.append(w);d.append(t);const st=copy.createElement('staff');st.textContent=span.staff;d.append(st);return d};
   for(const span of spans){
    if(span.from<start&&span.to>=start&&measures[start]){const m=measures[start];m.insertBefore(direction(span.type,span),m.querySelector(':scope > note')||null)}
    if(span.from<=end&&span.to>end&&span.to>=start&&measures[end]){
     // Insert before the note that starts last in this staff, so the stop stays inside the bar.
     const m=measures[end];let divisionsPos=0,lastStart=0,best=null,bestAt=-1;
     for(const el of m.children){
      const dur=Number(el.querySelector(':scope > duration')?.textContent||0);
      if(el.tagName==='backup')divisionsPos-=dur;else if(el.tagName==='forward')divisionsPos+=dur;
      else if(el.tagName==='note'&&!el.querySelector(':scope > grace')){const chord=!!el.querySelector(':scope > chord'),at=chord?lastStart:divisionsPos;if(!chord){lastStart=at;divisionsPos+=dur}
       if(!chord&&(el.querySelector(':scope > staff')?.textContent||'1')===span.staff&&at>=bestAt){bestAt=at;best=el}}
     }
     m.insertBefore(direction('stop',span),best);
    }
   }
  }
 }
 function displayXML(xml,keep,shortFirst,start=0,end=Infinity){
  const copy=new DOMParser().parseFromString(scoreLabels.displayXML(xml,shortFirst),'application/xml');
  if(start>0||Number.isFinite(end))splitWedges(copy,start,end);
  const ps=[...copy.querySelectorAll('score-partwise > part')];
  const target=ps[keep.findIndex(Boolean)];
  ps.forEach((p,i)=>{if(keep[i])return;[...p.children].forEach((m,mi)=>{
   for(const d of [...m.children].filter(e=>e.tagName==='direction'&&globalDirection(e))){
    const cloned=d.cloneNode(true);for(const e of [...cloned.querySelectorAll('staff,voice')])e.remove();
    const tm=target.children[mi];if(tm)tm.insertBefore(cloned,[...tm.children].find(e=>e.tagName!=='attributes')||null);d.remove();
   }
  })});return new XMLSerializer().serializeToString(copy);
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
 // OSMD 1.9.2 skips every tempo word (rit., Allegro, animato…) when the drawn range does not
 // start at the first bar. The check is lifted for that one step; the words themselves are
 // still only computed for the bars in range.
 let patched=false;
 function patchTempoWords(engine){
  if(patched)return;const calc=engine.graphic?.calculator;if(!calc)return;
  let proto=Object.getPrototypeOf(calc);while(proto&&!Object.prototype.hasOwnProperty.call(proto,'calculateTempoExpressionsForMultiTempoExpression'))proto=Object.getPrototypeOf(proto);
  if(!proto)return;const original=proto.calculateTempoExpressionsForMultiTempoExpression;
  proto.calculateTempoExpressionsForMultiTempoExpression=function(...args){const min=this.rules.MinMeasureToDrawIndex;this.rules.MinMeasureToDrawIndex=0;try{return original.apply(this,args)}finally{this.rules.MinMeasureToDrawIndex=min}};
  patched=true;
 }
 async function render(engine,xml){
  const token=++generation,a=Number(document.getElementById('from').value)-1,b=Number(document.getElementById('to').value)-1;
  const host=document.getElementById('score');host.style.display='';document.getElementById('reduced-score')?.remove();
  apply(engine,parts.map(()=>true));patchTempoWords(engine);engine.render();measureLabels.apply(engine);partMixer.labels(engine);wordLookup.index(engine);playCursor.index(engine);
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
      const text=rehearsal?.textContent||(metro?`${({whole:'𝅝',half:'𝅗𝅥',quarter:'♩',eighth:'♪', '16th':'𝅘𝅥𝅯'})[metro.querySelector('beat-unit')?.textContent]||metro.querySelector('beat-unit')?.textContent||'♩'}${metro.querySelector('beat-unit-dot')?'·':''} = ${metro.querySelector('per-minute')?.textContent||''}`:tempo?`♩ = ${tempo.getAttribute('tempo')}`:'');if(text)annotations.push(text);
     }
    })});
    if(annotations.length){const label=document.createElement('p');label.textContent=[...new Set(annotations)].join(' · ');section.append(label)}
    const renderer=new opensheetmusicdisplay.OpenSheetMusicDisplay(section,{autoResize:false,backend:'svg',drawTitle:start===0,drawSubtitle:false,drawComposer:false,drawMeasureNumbers:true,measureNumberInterval:1,useXMLMeasureNumbers:true,drawPartNames:true,drawPartAbbreviations:true});renderer.setLogLevel('error');
    await renderer.load(displayXML(xml,keep,start>0,start,end));if(token!==generation){reduced.remove();return}
    configure(renderer,start,end,engine.Zoom);apply(renderer,keep);renderer.render();measureLabels.apply(renderer);partMixer.labels(renderer);wordLookup.index(renderer);playCursor.index(renderer);
    // Keep semantic mapping on the output instead of relying on SVG element order.
    section.dataset.staves=renderer.Sheet.Instruments.filter((p,i)=>keep[i]).reduce((n,p)=>n+p.Staves.length,0);
   }
   if(token!==generation)return;
   host.style.display='none';document.getElementById('visibility-status').textContent=`${ranges.length}区間を表示・延べ${hidden}パートを省略（記号のある五線は保持）`;
  }catch(e){reduced.remove();host.style.display='';document.getElementById('visibility-status').textContent='省略表示を作成できないため全声部を表示しています';console.error(e)}
 }
 for(const id of ['hide-empty','hide-mode','show-first'])document.getElementById(id).onchange=()=>redraw();
 return {load,render};
})();
