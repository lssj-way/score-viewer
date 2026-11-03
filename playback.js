/* Local MusicXML audition. Quarter-note timing comes from duration/divisions. */
function musicTimeline(xml) {
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('XMLの構文エラー');
 const parts=[...doc.querySelectorAll('score-partwise > part')], lengths=[], events=[];
 for(const [pi,part] of parts.entries()){
  let divisions=1,transpose=0;
  [...part.children].filter(x=>x.tagName==='measure').forEach((measure,mi)=>{
   let position=0,lastStart=0,max=0;
   for(const el of measure.children){
    const text=s=>el.querySelector(s)?.textContent;
    if(el.tagName==='attributes'){
     divisions=Number(text('divisions')||divisions);
     if(!(divisions>0))throw Error('divisionsが不正です');
     if(el.querySelector('transpose'))transpose=Number(text('transpose > chromatic')||0)+12*Number(text('transpose > octave-change')||0);
    }else if(el.tagName==='backup'||el.tagName==='forward'){
     position+=(el.tagName==='backup'?-1:1)*Number(text('duration')||0)/divisions;max=Math.max(max,position);
    }else if(el.tagName==='note'){
     if(el.querySelector('grace'))continue;
     const duration=Number(text('duration')||0)/divisions;
     const chord=!!el.querySelector('chord'),start=chord?lastStart:position;
     if(!chord){lastStart=start;position+=duration;}max=Math.max(max,start+duration);
     if(el.querySelector('pitch')&&duration>0){
      const midi=12*(Number(text('pitch > octave'))+1)+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[text('pitch > step')])+Number(text('pitch > alter')||0)+transpose;
      if(!Number.isFinite(midi))throw Error('音高を読み取れません');
      events.push({measure:mi,start,duration,midi,part:pi,key:[pi,text('voice')||'1',text('staff')||'1',midi].join('/'),tieStart:!!el.querySelector('tie[type="start"]'),tieStop:!!el.querySelector('tie[type="stop"]')});
     }
    }
   }
   lengths[mi]=Math.max(lengths[mi]||0,max);
  });
 }
 const boundaries=[0];lengths.forEach(d=>boundaries.push(boundaries.at(-1)+d));
 events.forEach(e=>e.start+=boundaries[e.measure]);events.sort((a,b)=>a.start-b.start);
 const notes=[],ties=new Map();
 for(const e of events){const previous=ties.get(e.key);if(e.tieStop&&previous&&Math.abs(previous.start+previous.duration-e.start)<1e-6){previous.duration+=e.duration;if(!e.tieStart)ties.delete(e.key);}else{notes.push(e);if(e.tieStart)ties.set(e.key,e);else ties.delete(e.key);}}
 return {notes,boundaries,hasRepeats:!!doc.querySelector('repeat, ending, sound[ dacapo ], sound[ dalsegno ]')};
}
let audioContext,output,analyser,playTimer,playing=false,generation=0,sources=new Set();
function resumePlaybackAudio(){
 // Use a media-playback session on iOS, including when the silent switch is on.
 // Keep context creation and resume inside the playback button gesture.
 try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
 audioContext??=new (window.AudioContext||window.webkitAudioContext)();
 return audioContext.resume();
}
function playbackStatus(message){document.getElementById('play-status').textContent=message;}
function stopPlayback(message='停止しました'){
 generation++;clearInterval(playTimer);playing=false;
 if(output&&audioContext){output.gain.cancelScheduledValues(audioContext.currentTime);output.gain.setValueAtTime(0,audioContext.currentTime);}
 for(const source of sources){try{source.stop()}catch{}}sources.clear();
 document.getElementById('play').disabled=false;document.getElementById('stop').disabled=true;playbackStatus(message);
}
async function playScore(){
 stopPlayback('再生を準備しています…');const token=generation;
 try{
  if(!scoreXML||busy)throw Error('楽譜の読み込み完了を待ってください');
  const from=Number(document.getElementById('from').value),to=Number(document.getElementById('to').value),bpm=Number(document.getElementById('bpm').value);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>total)throw Error('小節範囲が不正です');
  if(!Number.isFinite(bpm)||bpm<30||bpm>240)throw Error('テンポは30〜240で指定してください');
  const timeline=musicTimeline(scoreXML),begin=timeline.boundaries[from-1],end=timeline.boundaries[to],seconds=60/bpm;
  await resumePlaybackAudio();if(token!==generation)return;
  if(audioContext.state!=='running')throw Error('音声を開始できません。再生をもう一度押してください');
  if(!output){output=audioContext.createGain();analyser=audioContext.createAnalyser();analyser.fftSize=256;output.connect(analyser);analyser.connect(audioContext.destination);}
  partMixer.reset();output.gain.setValueAtTime(partMixer.master(),audioContext.currentTime);const origin=audioContext.currentTime+0.08;
  const config=readToneSettings(),partBuses=new Map(),tones=new Map();
  const queue=timeline.notes.filter(n=>n.start<end&&n.start+n.duration>begin);
  const count=queue.length;let next=0;
  for(const n of queue)if(!partBuses.has(n.part)){partBuses.set(n.part,partMixer.bus(audioContext,output,n.part,true));tones.set(n.part,partMixer.tone(n.part));}
  const pump=()=>{
   const horizon=audioContext.currentTime+1.5;
   while(next<queue.length){const note=queue[next],start=Math.max(begin,note.start),finish=Math.min(end,note.start+note.duration),at=origin+(start-begin)*seconds;
    if(at>horizon)break;next++;
    const actual=Math.max(at,audioContext.currentTime+.005),until=origin+(finish-begin)*seconds;
    if(until<=actual)continue;
    const tone=tones.get(note.part);
    scheduleTone(audioContext,partBuses.get(note.part),note.midi+(tone==='piano'?0:config.shift),actual,until-actual,tone,config,1);
   }
  };pump();
  playing=true;document.getElementById('play').disabled=true;document.getElementById('stop').disabled=false;
  document.getElementById('play-status').dataset.noteCount=count;document.getElementById('play-status').dataset.audioPeak='0';
  const samples=new Float32Array(analyser.fftSize);
  const tick=()=>{
   pump();document.getElementById('play-status').dataset.activeSources=sources.size;
   const elapsed=audioContext.currentTime-origin,beat=begin+Math.max(0,elapsed)/seconds;
   analyser.getFloatTimeDomainData(samples);const peak=Math.max(...samples.map(Math.abs));
   const label=document.getElementById('play-status');label.dataset.audioPeak=Math.max(Number(label.dataset.audioPeak),peak);
   const measure=Math.min(to,timeline.boundaries.findIndex((x,i)=>i>0&&x>beat));
   playbackStatus('再生中 · '+Math.max(from,measure)+'小節 · '+Math.max(0,elapsed).toFixed(1)+' / '+((end-begin)*seconds).toFixed(1)+'秒'+(timeline.hasRepeats?' · 反復なし':''));
   if(elapsed>=(end-begin)*seconds+0.05)stopPlayback('再生が終了しました');
  };tick();playTimer=setInterval(tick,80);
 }catch(e){stopPlayback('再生エラー: '+e.message);}
}
document.getElementById('play').onclick=playScore;document.getElementById('stop').onclick=()=>stopPlayback();
for(const id of ['vocal-shift','from','to','bpm','vocal-tone','formant-center','formant-gain','piano-level'])document.getElementById(id).addEventListener('change',()=>{if(playing)stopPlayback('範囲・テンポを変更したため停止しました')});
window.addEventListener('pagehide',()=>stopPlayback());

// Local additive synthesis. Spectral emphasis is fixed in Hz, not tied to a
// harmonic number; amplitude normalization makes comparisons less loudness-led.
function voicePartials(f0,tone,center,boost,sampleRate=48000){
 if(tone.startsWith("requiem-"))return requiemPartials(f0,tone,sampleRate);
 const result=[];
 for(let h=1;h<=96&&h*f0<Math.min(12000,sampleRate*0.45);h++){
  const f=h*f0;
  const base=tone==='harmonica'?Math.pow(h,-1.30)*(h%2?1:0.65):Math.pow(h,-1.12);
  const lowBody=1+0.25*Math.exp(-0.5*Math.pow((f-750)/400,2));
  // A broad spectral prominence, not a physiological model of F3/F4/F5.
  const bell=Math.exp(-0.5*Math.pow((f-center)/450,2));
  const peak=Math.pow(10,boost*bell/20);
  // Smooth four-pole-style low-pass envelope, without a resonant extra peak.
  const highCut=1/Math.sqrt(1+Math.pow(f/4200,8));
  result.push([h,base*lowBody*peak*highCut]);
 }
 const norm=Math.sqrt(result.reduce((sum,p)=>sum+p[1]*p[1],0));
 return result.map(([h,a])=>[h,a/norm]);
}
function readToneSettings(){return {shift:Number(document.getElementById('vocal-shift').value),tone:document.getElementById('vocal-tone').value,center:Number(document.getElementById('formant-center').value),boost:Number(document.getElementById('formant-gain').value),accompaniment:Number(document.getElementById('piano-level').value)};}
const periodicWaveCache=new WeakMap();
function scheduleTone(context,destination,midi,at,duration,tone,config,volume=1,track=true){
 const f0=440*2**((midi-69)/12);
 function connectSource(oscillator,gain){
  oscillator.connect(gain);gain.connect(destination);
  if(track)sources.add(oscillator);
  oscillator.onended=()=>{if(track)sources.delete(oscillator);oscillator.disconnect();gain.disconnect()};
  oscillator.start(at);oscillator.stop(at+duration+0.012);
 }
 if(tone==='piano'){
  for(const [harmonic,level] of [[1,0.10],[2,0.032],[3,0.012]]){
   const oscillator=context.createOscillator(),gain=context.createGain();
   oscillator.frequency.value=f0*harmonic;
   gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level*volume,at+Math.min(0.006,duration/4));
   gain.gain.exponentialRampToValueAtTime(Math.max(0.000001,level*volume*0.18),at+Math.max(0.01,duration*0.85));gain.gain.linearRampToValueAtTime(0,at+duration);
   connectSource(oscillator,gain);
  }
 }else{
  let cache=periodicWaveCache.get(context);if(!cache){cache=new Map();periodicWaveCache.set(context,cache)}
  const waveKey=[midi,tone,config.center,config.boost].join('/');let wave=cache.get(waveKey);
  if(!wave){
  const partials=voicePartials(f0,tone,config.center,config.boost,context.sampleRate);
  const real=new Float32Array(partials.length+1),imag=new Float32Array(partials.length+1);
  for(const [h,a] of partials)imag[h]=a;
  wave=context.createPeriodicWave(real,imag,{disableNormalization:true});cache.set(waveKey,wave);}
  const oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.setPeriodicWave(wave);oscillator.frequency.value=f0;
  const attack=Math.min(0.025,duration*0.2),release=Math.min(0.04,duration*0.25);
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(0.115*volume,at+attack);
  gain.gain.setValueAtTime(0.115*volume,at+duration-release);gain.gain.linearRampToValueAtTime(0,at+duration);
  connectSource(oscillator,gain);
 }
}
async function auditionTone(){
 stopPlayback('音色を準備しています…');const token=generation;
 try{
  await resumePlaybackAudio();if(token!==generation)return;
  if(audioContext.state!=='running')throw Error('音声を開始できません');
  if(!output){output=audioContext.createGain();analyser=audioContext.createAnalyser();analyser.fftSize=256;output.connect(analyser);analyser.connect(audioContext.destination);}
  partMixer.reset();output.gain.setValueAtTime(partMixer.master(),audioContext.currentTime);
  const config=readToneSettings();scheduleTone(audioContext,output,57,audioContext.currentTime+0.05,1.5,config.tone,config);
  playing=true;document.getElementById('play').disabled=true;document.getElementById('stop').disabled=false;
  document.getElementById('play-status').dataset.audioPeak='0';
  const samples=new Float32Array(analyser.fftSize),end=audioContext.currentTime+1.6;
  playbackStatus('音色試聴中 · ラ（A3 / 220 Hz）');
  playTimer=setInterval(()=>{
   analyser.getFloatTimeDomainData(samples);
   const label=document.getElementById('play-status');label.dataset.audioPeak=Math.max(Number(label.dataset.audioPeak),...samples.map(Math.abs));
   if(audioContext.currentTime>=end)stopPlayback('試聴が終了しました · 同じラの音で比較できます');
  },80);
 }catch(e){stopPlayback('試聴エラー: '+e.message)}
}
document.getElementById('audition').onclick=auditionTone;
for(const id of ['vocal-tone','formant-center','formant-gain','piano-level']){
 const control=document.getElementById(id);
 try{const value=localStorage.getItem('allerseelen-'+id);if(value!==null&&[...control.options].some(o=>o.value===value))control.value=value;}catch{}
 control.addEventListener('change',()=>{
  try{localStorage.setItem('allerseelen-'+id,control.value)}catch{}
  const piano=document.getElementById('vocal-tone').value==='piano'||document.getElementById('vocal-tone').value.startsWith('requiem-');
  document.getElementById('formant-center').disabled=piano;document.getElementById('formant-gain').disabled=piano;
 });
}
for(const id of ['formant-center','formant-gain'])document.getElementById(id).disabled=(document.getElementById('vocal-tone').value==='piano'||document.getElementById('vocal-tone').value.startsWith('requiem-'));
