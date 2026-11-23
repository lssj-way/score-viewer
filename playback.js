/* Local MusicXML audition. Quarter-note timing comes from duration/divisions. */
function musicTimeline(xml) {
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('XMLの構文エラー');
 const parts=[...doc.querySelectorAll('score-partwise > part')], lengths=[], events=[], marks=[], meters=[];
 for(const [pi,part] of parts.entries()){
  let divisions=1,transpose=0,meter={beats:4,beatType:4};
  [...part.children].filter(x=>x.tagName==='measure').forEach((measure,mi)=>{
   let position=0,lastStart=0,max=0;
   for(const el of measure.children){
    const text=s=>el.querySelector(s)?.textContent;
    if(el.tagName==='attributes'){
     divisions=Number(text('divisions')||divisions);
     if(!(divisions>0))throw Error('divisionsが不正です');
     const time=el.querySelector('time beats')?.parentNode;
     // Additive metres such as 3+2 add up; the metronome only needs the total.
     if(time)meter={beats:time.querySelector('beats').textContent.split('+').reduce((a,b)=>a+Number(b),0),beatType:Number(time.querySelector('beat-type')?.textContent)||4};
     if(el.querySelector('transpose'))transpose=Number(text('transpose > chromatic')||0)+12*Number(text('transpose > octave-change')||0);
    }else if(el.tagName==='backup'||el.tagName==='forward'){
     position+=(el.tagName==='backup'?-1:1)*Number(text('duration')||0)/divisions;max=Math.max(max,position);
    }else if(el.tagName==='direction'||el.tagName==='sound'){
     const bpm=tempoOf(el);if(bpm)marks.push({measure:mi,position,bpm});
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
   lengths[mi]=Math.max(lengths[mi]||0,max);if(pi===0)meters[mi]=meter;
  });
 }
 const boundaries=[0];lengths.forEach(d=>boundaries.push(boundaries.at(-1)+d));
 events.forEach(e=>e.start+=boundaries[e.measure]);events.sort((a,b)=>a.start-b.start);
 const notes=[],ties=new Map();
 for(const e of events){const previous=ties.get(e.key);if(e.tieStop&&previous&&Math.abs(previous.start+previous.duration-e.start)<1e-6){previous.duration+=e.duration;if(!e.tieStart)ties.delete(e.key);}else{notes.push(e);if(e.tieStart)ties.set(e.key,e);else ties.delete(e.key);}}
 // Every part usually repeats the same marks; keep one per position.
 const tempos=[];for(const m of marks.map(m=>({q:boundaries[m.measure]+m.position,bpm:m.bpm})).sort((a,b)=>a.q-b.q))if(!tempos.some(t=>Math.abs(t.q-m.q)<1e-6))tempos.push(m);
 return {notes,boundaries,tempos,meters,hasRepeats:!!doc.querySelector('repeat, ending, sound[ dacapo ], sound[ dalsegno ]')};
}
// Quarter notes per minute from <sound tempo> (already in quarters) or a <metronome> mark.
function tempoOf(el){
 const sound=el.tagName==='sound'?el:el.querySelector('sound[tempo]'),tempo=Number(sound?.getAttribute('tempo'));
 if(tempo>0)return tempo;
 const metronome=el.tagName==='direction'&&el.querySelector('metronome');if(!metronome)return 0;
 const unit={whole:4,half:2,quarter:1,eighth:.5,'16th':.25,'32nd':.125,'64th':.0625,breve:8}[metronome.querySelector('beat-unit')?.textContent.trim()];
 const perMinute=parseFloat((metronome.querySelector('per-minute')?.textContent||'').replace(/[^\d.]/g,''));
 return unit&&perMinute>0?perMinute*unit*(metronome.querySelector('beat-unit-dot')?1.5:1):0;
}
// Seconds at a quarter-note position: the score's tempo marks in "楽譜" mode, otherwise one fixed tempo.
function tempoPlan(timeline,manual){
 const marks=document.getElementById('tempo-mode').value==='score'?timeline.tempos.filter(t=>t.bpm>=10&&t.bpm<=400):[];
 const segments=[{q:0,bpm:marks[0]?.bpm||manual,t:0}];
 for(const m of marks)if(m.q>0&&m.bpm!==segments.at(-1).bpm){const p=segments.at(-1);segments.push({q:m.q,bpm:m.bpm,t:p.t+(m.q-p.q)*60/p.bpm})}
 const find=test=>{let found=segments[0];for(const s of segments){if(!test(s))break;found=s}return found};
 return {fromScore:marks.length>0,
  at:q=>{const s=find(x=>x.q<=q);return s.t+(q-s.q)*60/s.bpm},
  beatAt:t=>{const s=find(x=>x.t<=t);return s.q+(t-s.t)*s.bpm/60},
  bpmAt:q=>find(x=>x.q<=q).bpm};
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
 generation++;clearInterval(playTimer);playing=false;playCursor.stop();
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
  const timeline=musicTimeline(scoreXML),begin=timeline.boundaries[from-1],end=timeline.boundaries[to],plan=tempoPlan(timeline,bpm),t0=plan.at(begin),span=plan.at(end)-t0;
  if(!plan.fromScore&&(!Number.isFinite(bpm)||bpm<30||bpm>240))throw Error('テンポは30〜240で指定してください');
  await resumePlaybackAudio();if(token!==generation)return;
  if(audioContext.state!=='running')throw Error('音声を開始できません。再生をもう一度押してください');
  if(!output){output=audioContext.createGain();analyser=audioContext.createAnalyser();analyser.fftSize=256;peakLimiter(audioContext,output).connect(analyser);analyser.connect(audioContext.destination);}
  partMixer.reset();output.gain.setValueAtTime(partMixer.master(),audioContext.currentTime);
  const countIn=metronome.countIn(timeline,from-1,plan.bpmAt(begin)),origin=audioContext.currentTime+0.08+countIn.seconds;
  if(countIn.clicks.length){const bus=metronome.bus(audioContext,output,false);for(const c of countIn.clicks)metronome.schedule(audioContext,bus,origin-countIn.seconds+c.t,c.accent)}
  const config=readToneSettings(),partBuses=new Map(),tones=new Map();
  const queue=timeline.notes.filter(n=>n.start<end&&n.start+n.duration>begin);
  const count=queue.length;let next=0,nextClick=0;
  const clicks=metronome.clicks(timeline,begin,end),clickBus=metronome.bus(audioContext,output,true);
  for(const n of queue)if(!partBuses.has(n.part)){partBuses.set(n.part,partMixer.bus(audioContext,output,n.part,true));tones.set(n.part,partMixer.tone(n.part));}
  const pump=()=>{
   const horizon=audioContext.currentTime+1.5;
   while(nextClick<clicks.length){const c=clicks[nextClick],at=origin+plan.at(c.q)-t0;if(at>horizon)break;nextClick++;if(at>=audioContext.currentTime)metronome.schedule(audioContext,clickBus,at,c.accent)}
   while(next<queue.length){const note=queue[next],start=Math.max(begin,note.start),finish=Math.min(end,note.start+note.duration),at=origin+plan.at(start)-t0;
    if(at>horizon)break;next++;
    const actual=Math.max(at,audioContext.currentTime+.005),until=origin+plan.at(finish)-t0;
    if(until<=actual)continue;
    const tone=tones.get(note.part);
    scheduleTone(audioContext,partBuses.get(note.part),note.midi+(tone==='piano'?0:config.shift),actual,until-actual,tone,config,1);
   }
  };pump();
  playing=true;document.getElementById('play').disabled=true;document.getElementById('stop').disabled=false;
  playCursor.start(()=>{
   const q=Math.min(end-1e-6,plan.beatAt(t0+Math.max(0,audioContext.currentTime-origin)));let m=from-1;
   while(m+1<to&&timeline.boundaries[m+1]<=q)m++;
   return {measure:m,offset:q-timeline.boundaries[m],length:timeline.boundaries[m+1]-timeline.boundaries[m]};
  });
  const tempoNote=document.getElementById('tempo-mode').value!=='score'?'':plan.fromScore?' · ♩＝':' · 楽譜にテンポ指定がないため♩＝'+bpm;
  document.getElementById('play-status').dataset.noteCount=count;document.getElementById('play-status').dataset.audioPeak='0';
  const samples=new Float32Array(analyser.fftSize);
  const tick=()=>{
   pump();document.getElementById('play-status').dataset.activeSources=sources.size;
   const elapsed=audioContext.currentTime-origin,beat=plan.beatAt(t0+Math.max(0,elapsed));
   analyser.getFloatTimeDomainData(samples);const peak=Math.max(...samples.map(Math.abs));
   const label=document.getElementById('play-status');label.dataset.audioPeak=Math.max(Number(label.dataset.audioPeak),peak);
   const measure=Math.min(to,timeline.boundaries.findIndex((x,i)=>i>0&&x>beat));
   if(elapsed<0&&countIn.clicks.length){playbackStatus(`カウント ${Math.max(1,Math.min(countIn.clicks.length,Math.floor((elapsed+countIn.seconds)/countIn.seconds*countIn.clicks.length)+1))} / ${countIn.clicks.length}`);return}
   const bar=Math.max(from,measure),mark=measureLabels.label(bar-1);
   playbackStatus('再生中 · '+bar+'小節'+(mark!==String(bar)?'（'+mark+'）':'')+' · '+Math.max(0,elapsed).toFixed(1)+' / '+span.toFixed(1)+'秒'+(plan.fromScore?tempoNote+Math.round(plan.bpmAt(beat)):tempoNote)+(timeline.hasRepeats?' · 反復なし':''));
   if(elapsed>=span+0.05)stopPlayback('再生が終了しました');
  };tick();playTimer=setInterval(tick,80);
 }catch(e){stopPlayback('再生エラー: '+e.message);}
}
document.getElementById('play').onclick=playScore;document.getElementById('stop').onclick=()=>stopPlayback();
for(const id of ['vocal-shift','from','to','bpm','tempo-mode','click-unit','click-accent','vocal-tone','formant-center','formant-gain','piano-level'])document.getElementById(id).addEventListener('change',()=>{if(playing)stopPlayback('範囲・テンポを変更したため停止しました')});
window.addEventListener('pagehide',()=>stopPlayback());
{
 const mode=document.getElementById('tempo-mode'),input=document.getElementById('bpm');
 const apply=()=>{const score=mode.value==='score';input.disabled=score;input.title=score?'楽譜のテンポ指定に従います（指定がない楽譜ではこの値）':'';
  playbackStatus(score?'楽譜のテンポ指定に従って再生します':'♩＝の速さで再生します')};
 try{const v=localStorage.getItem('score-viewer-tempo-mode');if(v==='score'||v==='manual')mode.value=v}catch{}
 mode.addEventListener('change',()=>{try{localStorage.setItem('score-viewer-tempo-mode',mode.value)}catch{}apply()});
 apply();
}

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
// Safety limiter before the speakers (and in MP3 export): it only acts when many parts peak
// together near full scale, so normal passages are unchanged and dense tutti does not clip.
function peakLimiter(context,source){
 const limiter=context.createDynamicsCompressor();
 limiter.threshold.value=-6;limiter.knee.value=4;limiter.ratio.value=20;limiter.attack.value=.002;limiter.release.value=.2;
 source.connect(limiter);return limiter;
}
// Sung tones are raised 15 dB (from 0.115) so that, at equal mixer settings, one sung line is
// about as loud as a whole piano part with its chords and bass (measured on Lippen schweigen).
const SUNG_LEVEL=0.115*10**(15/20);
// Piano partials. Low notes get flatter, richer spectra: phone and laptop speakers barely
// reproduce fundamentals below ~200 Hz, so bass lines are heard through their harmonics, as
// with a real piano. Levels are scaled so a note's loudness through such a speaker roughly
// matches middle C, with the fundamental capped so headphones do not get boomy bass.
function pianoPartials(f0){
 const speaker=f=>f>=200?1:(f/200)**2,t=Math.min(1,Math.max(0,Math.log2(f0/65.4)/2.5)),slope=.75+1.05*t;
 const count=Math.max(3,Math.min(16,Math.floor(4500/f0))),partials=[];
 for(let h=1;h<=count;h++)partials.push([h,h**-slope]);
 const heard=list=>Math.hypot(...list.map(([h,a])=>a*speaker(h*f0)));
 const reference=Math.hypot(.10,.032,.012),scale=Math.min(.12,reference/heard(partials));
 return partials.map(([h,a])=>[h,a*scale]);
}
function scheduleTone(context,destination,midi,at,duration,tone,config,volume=1,track=true){
 const f0=440*2**((midi-69)/12);
 function connectSource(oscillator,gain){
  oscillator.connect(gain);gain.connect(destination);
  if(track)sources.add(oscillator);
  oscillator.onended=()=>{if(track)sources.delete(oscillator);oscillator.disconnect();gain.disconnect()};
  oscillator.start(at);oscillator.stop(at+duration+0.012);
 }
 if(tone==='piano'){
  let cache=periodicWaveCache.get(context);if(!cache){cache=new Map();periodicWaveCache.set(context,cache)}
  let wave=cache.get('piano/'+midi);
  if(!wave){
   const partials=pianoPartials(f0),real=new Float32Array(partials.length+1),imag=new Float32Array(partials.length+1);
   // Schroeder phases keep the summed waveform's peak low when many harmonics line up.
   for(const [h,a] of partials){const phase=Math.PI*h*h/partials.length;real[h]=a*Math.sin(phase);imag[h]=a*Math.cos(phase)}
   wave=context.createPeriodicWave(real,imag,{disableNormalization:true});cache.set('piano/'+midi,wave);
  }
  const oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.setPeriodicWave(wave);oscillator.frequency.value=f0;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+Math.min(0.006,duration/4));
  gain.gain.exponentialRampToValueAtTime(Math.max(0.000001,volume*0.18),at+Math.max(0.01,duration*0.85));gain.gain.linearRampToValueAtTime(0,at+duration);
  connectSource(oscillator,gain);
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
  const attack=Math.min(0.025,duration*0.2),release=Math.min(0.04,duration*0.25),level=SUNG_LEVEL*volume;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+attack);
  gain.gain.setValueAtTime(level,at+duration-release);gain.gain.linearRampToValueAtTime(0,at+duration);
  connectSource(oscillator,gain);
 }
}
async function auditionTone(){
 stopPlayback('音色を準備しています…');const token=generation;
 try{
  await resumePlaybackAudio();if(token!==generation)return;
  if(audioContext.state!=='running')throw Error('音声を開始できません');
  if(!output){output=audioContext.createGain();analyser=audioContext.createAnalyser();analyser.fftSize=256;peakLimiter(audioContext,output).connect(analyser);analyser.connect(audioContext.destination);}
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
