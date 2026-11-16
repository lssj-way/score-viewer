/* Metronome clicks for playback and MP3 export. Clicks restart at every barline, so the first
   click of each bar is the downbeat even after a time-signature change or a short bar. */
const metronome=(()=>{
 const $=id=>document.getElementById(id);
 let live=null;
 const enabled=()=>$('click-on').checked,level=()=>10**(Number($('click-level').value)/20);
 // "auto" follows the time signature: compound metres (6/8, 9/8, 12/8…) click dotted beats.
 function unitFor(meter){
  const v=$('click-unit').value;if(v!=='auto')return Number(v);
  const {beats,beatType}=meter||{beats:4,beatType:4};
  return beatType>=8&&beats>3&&beats%3===0?3*4/beatType:4/beatType;
 }
 function clicks(timeline,begin,end){
  const out=[];
  for(let m=0;m<timeline.boundaries.length-1;m++){
   const start=timeline.boundaries[m],stop=timeline.boundaries[m+1];if(stop<=begin||start>=end)continue;
   const unit=unitFor(timeline.meters[m]);if(!(unit>0))continue;
   for(let k=0,q=start;q<stop-1e-6;k++,q=start+k*unit)if(q>=begin-1e-6&&q<end-1e-6)out.push({q,accent:k===0&&$('click-accent').checked});
  }
  return out;
 }
 // One bar of clicks before playback, in the first bar's metre and the tempo there. It sounds
 // even when the metronome is off; a pickup bar still counts a full bar of its metre.
 function countIn(timeline,measure,bpm){
  if(!$('count-in').checked)return {seconds:0,clicks:[]};
  const meter=timeline.meters[measure]||{beats:4,beatType:4},length=meter.beats*4/meter.beatType,unit=unitFor(meter),clicks=[];
  for(let k=0;k*unit<length-1e-6;k++)clicks.push({t:k*unit*60/bpm,accent:k===0&&$('click-accent').checked});
  return {seconds:length*60/bpm,clicks};
 }
 function bus(context,destination,isLive){
  const g=context.createGain();g.gain.value=isLive?(enabled()?level():0):level();g.connect(destination);if(isLive)live=g;return g;
 }
 // A short woodblock-like tick: a pitched triangle burst with a fast decay.
 function schedule(context,destination,at,accent,track=true){
  const osc=context.createOscillator(),gain=context.createGain();
  osc.type='triangle';osc.frequency.value=accent?1760:1175;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(accent?.9:.6,at+.002);gain.gain.exponentialRampToValueAtTime(.001,at+.06);
  osc.connect(gain);gain.connect(destination);
  if(track)sources.add(osc);
  osc.onended=()=>{if(track)sources.delete(osc);osc.disconnect();gain.disconnect()};
  osc.start(at);osc.stop(at+.07);
 }
 const update=()=>{if(live)live.gain.setTargetAtTime(enabled()?level():0,live.context.currentTime,.01)};
 for(const [id,key] of [['click-on','score-viewer-click-on'],['click-unit','score-viewer-click-unit'],['click-accent','score-viewer-click-accent'],['click-level','score-viewer-click-level'],['count-in','score-viewer-count-in']]){
  const c=$(id),prop=c.type==='checkbox'?'checked':'value';
  try{const v=localStorage.getItem(key);if(v!==null)c[prop]=prop==='checked'?v==='1':v}catch{}
  c.addEventListener(c.type==='range'?'input':'change',()=>{try{localStorage.setItem(key,prop==='checked'?(c.checked?'1':'0'):c.value)}catch{}update()});
 }
 $('click-level').addEventListener('input',()=>{$('click-level-value').textContent=$('click-level').value+' dB'});
 $('click-level-value').textContent=$('click-level').value+' dB';
 return {clicks,countIn,bus,schedule,enabled,reset:()=>{live=null}};
})();
