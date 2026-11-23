/* Bar labels counted from rehearsal marks: "1-3" is the third bar of rehearsal 1 (the marked bar
   is "1-1"); bars before the first mark count from 1. Used for the numbers drawn on the score and,
   if chosen, for the range fields. The <measure number> attributes are not used, because OMR output
   often restarts them on every page. */
const measureLabels=(()=>{
 const $=id=>document.getElementById(id);
 let marks=[],fileNumbers=[],count=0;
 function load(xml){
  const d=new DOMParser().parseFromString(xml,'application/xml'),parts=[...d.querySelectorAll('score-partwise > part')],found=new Map();
  for(const part of parts)[...part.children].filter(m=>m.tagName==='measure').forEach((m,i)=>{for(const r of m.querySelectorAll('rehearsal')){const text=r.textContent.trim();if(text&&!found.has(i))found.set(i,text)}});
  marks=[...found].map(([index,text])=>({index,text})).sort((a,b)=>a.index-b.index);
  const first=parts[0]?[...parts[0].children].filter(m=>m.tagName==='measure'):[];
  fileNumbers=first.map(m=>m.getAttribute('number')||'');count=first.length;sync();
 }
 const markAt=i=>{let found=null;for(const m of marks){if(m.index>i)break;found=m}return found};
 const label=i=>{const m=markAt(i);return m?`${m.text}-${i-m.index+1}`:String(i+1)};
 const shown=i=>({file:fileNumbers[i],sequential:String(i+1)})[$('measure-display').value]??label(i);
 // Accepts 37 (bar from the start), 1-3 / 1の3 / 1.3 (third bar of rehearsal 1), 1+2, and A (= A-1).
 function parse(text){
  const t=text.normalize('NFKC').trim().replace(/\s+/g,'').replace(/小節目?$/,'');
  const find=s=>marks.find(m=>m.text.toLowerCase()===s.toLowerCase());
  let m=t.match(/^\d+$/);if(m)return Number(t);
  if((m=t.match(/^(.+)[-の.](\d+)$/))&&find(m[1]))return find(m[1]).index+Number(m[2]);
  if((m=t.match(/^(.+)\+(\d+)$/))&&find(m[1]))return find(m[1]).index+1+Number(m[2]);
  return find(t)?find(t).index+1:NaN;
 }
 function apply(engine){
  if($('measure-display').value==='file')return;
  const source=engine.Sheet.SourceMeasures;
  for(const page of engine.GraphicSheet?.MusicPages||[])for(const system of page.MusicSystems){
   const columns=system.GraphicalMeasures.map(c=>[].concat(c).find(m=>m?.PositionAndShape)).filter(Boolean);
   for(const number of system.MeasureNumberLabels||[]){
    const x=number.PositionAndShape.AbsolutePosition.x;let nearest=null,distance=Infinity;
    for(const m of columns){const d=Math.abs(m.PositionAndShape.AbsolutePosition.x-x);if(d<distance){distance=d;nearest=m}}
    const i=nearest?source.indexOf(nearest.parentSourceMeasure)+(engine.measureOffset||0):-1,text=number.SVGNode?.querySelector?.('text');
    if(i>=0&&text)text.textContent=shown(i);
   }
  }
 }
 function sync(){
  const byMark=$('measure-input').value==='rehearsal';
  for(const id of ['from','to']){const n=$(id),t=$(id+'-label');n.hidden=byMark;t.hidden=!byMark;t.value=count?label(Number(n.value)-1):''}
 }
 for(const id of ['from','to']){
  $(id).addEventListener('change',sync);
  $(id+'-label').addEventListener('change',e=>{
   const bar=parse(e.target.value),n=$(id);
   if(Number.isInteger(bar)&&bar>=1&&bar<=count){n.value=bar;n.dispatchEvent(new Event('change'))}
   else playbackStatus(`「${e.target.value}」に当たる小節が見つかりません（例：1-3、または通し番号）`);
   sync();
  });
 }
 for(const [id,key,after] of [['measure-input','score-viewer-measure-input',sync],['measure-display','score-viewer-measure-display',()=>redraw()]]){
  const c=$(id);try{const v=localStorage.getItem(key);if(v&&[...c.options].some(o=>o.value===v))c.value=v}catch{}
  c.addEventListener('change',()=>{try{localStorage.setItem(key,c.value)}catch{}after()});
 }
 sync();
 return {load,apply,sync,label,parse};
})();
