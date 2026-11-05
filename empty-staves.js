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
 function displayXML(xml,keep,shortFirst){
  const copy=new DOMParser().parseFromString(scoreLabels.displayXML(xml,shortFirst),'application/xml');
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
 async function render(engine,xml){
  const token=++generation,a=Number(document.getElementById('from').value)-1,b=Number(document.getElementById('to').value)-1;
  const host=document.getElementById('score');host.style.display='';document.getElementById('reduced-score')?.remove();
  apply(engine,parts.map(()=>true));engine.render();wordLookup.index(engine);
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
    await renderer.load(displayXML(xml,keep,start>0));if(token!==generation){reduced.remove();return}
    configure(renderer,start,end,engine.Zoom);apply(renderer,keep);renderer.render();wordLookup.index(renderer);
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
