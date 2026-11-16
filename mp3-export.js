/* Export the same synthesizer locally, faster than real time. No upload. */
let exportingMP3=false,mp3URL,mp3Blob,mp3Filename;
const supportsSavePicker=typeof window.showSaveFilePicker==='function';
function encodeMP3(samples,sampleRate,onProgress){
 return new Promise((resolve,reject)=>{
  const worker=new Worker('mp3-worker.js');
  const fail=error=>{worker.terminate();reject(error)};
  worker.onerror=event=>fail(new Error(event.message||'MP3変換に失敗しました'));
  worker.onmessage=({data})=>{
   if(data.error)fail(new Error(data.error));
   else if(data.complete){worker.terminate();resolve(data)}
   else if(data.progress!==undefined)onProgress(data.progress);
  };
  worker.postMessage({samples:samples.buffer,sampleRate},[samples.buffer]);
 });
}
async function exportMP3(){
 if(exportingMP3)return;
 const button=document.getElementById('export-mp3'),label=document.getElementById('export-status'),link=document.getElementById('mp3-download');
 exportingMP3=true;button.disabled=true;document.getElementById('file').disabled=true;
 try{
  if(!scoreXML||busy)throw Error('楽譜の読み込み完了を待ってください');
  const from=Number(document.getElementById('from').value),to=Number(document.getElementById('to').value),bpm=Number(document.getElementById('bpm').value),config=readToneSettings();
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>total)throw Error('小節範囲が不正です');
  const timeline=musicTimeline(scoreXML),begin=timeline.boundaries[from-1],end=timeline.boundaries[to],plan=tempoPlan(timeline,bpm),t0=plan.at(begin);
  if(!plan.fromScore&&(!Number.isFinite(bpm)||bpm<30||bpm>240))throw Error('テンポは30〜240で指定してください');
  const filename=`${scoreFilename.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]/gu,'_')}_m${from}-${to}_${config.tone}_${plan.fromScore?'score-tempo':bpm+'bpm'}_${config.center}Hz_${config.boost}dB.mp3`;
  let saveHandle;
  if(supportsSavePicker){
   label.textContent='保存先とファイル名を選んでください';
   saveHandle=await window.showSaveFilePicker({id:'allerseelen-mp3',suggestedName:filename,startIn:'music',types:[{description:'MP3音声',accept:{'audio/mpeg':['.mp3']}}]});
  }
  stopPlayback('MP3を書き出しています');
  const sampleRate=44100,duration=plan.at(end)-t0,lead=0.05,tail=0.15;
  label.textContent=`MP3作成中 · ${from}〜${to}小節 · 音声を生成しています…`;
  // Let the progress message paint before scheduling/rendering.
  await new Promise(resolve=>setTimeout(resolve,0));
  const context=new OfflineAudioContext(1,Math.ceil((lead+duration+tail)*sampleRate),sampleRate),mix=context.createGain();
  mix.gain.value=partMixer.master();mix.connect(context.destination);
  const partBuses=new Map();
  for(const note of timeline.notes){
   const start=Math.max(begin,note.start),finish=Math.min(end,note.start+note.duration);if(finish<=start)continue;
   if(!partBuses.has(note.part))partBuses.set(note.part,partMixer.bus(context,mix,note.part,false));
   scheduleTone(context,partBuses.get(note.part),note.midi+(partMixer.tone(note.part)==='piano'?0:config.shift),lead+plan.at(start)-t0,plan.at(finish)-plan.at(start),partMixer.tone(note.part),config,1,false);
  }
  const rendered=await context.startRendering();
  label.textContent='MP3に変換中 · 0%';
  const result=await encodeMP3(rendered.getChannelData(0).slice(),sampleRate,p=>{label.textContent=`MP3に変換中 · ${p}%`});
  if(mp3URL)URL.revokeObjectURL(mp3URL);
  mp3Blob=new Blob([result.mp3],{type:'audio/mpeg'});mp3Filename=filename;
  mp3URL=URL.createObjectURL(mp3Blob);
  link.href=mp3URL;link.download=filename;link.hidden=false;link.style.display='inline-block';link.textContent=`${from}〜${to}小節のMP3を保存`; 
  label.textContent=`MP3作成完了 · ${from}〜${to}小節 · ${Math.floor(Math.round(duration)/60)}分${Math.round(duration)%60}秒 · 歌の移調 ${config.shift}半音${result.limited?' · 音割れ防止のため音量を調整':''}`;
  label.dataset.bytes=result.mp3.byteLength;label.dataset.duration=duration;label.dataset.filename=filename;
  if(saveHandle){
   const stream=await saveHandle.createWritable();
   try{await stream.write(mp3Blob);await stream.close()}catch(e){try{await stream.abort()}catch{}throw e}
   label.textContent+=` · 「${saveHandle.name}」を保存しました`;
  }else{link.click();}

 }catch(e){label.textContent=e.name==='AbortError'?'保存をキャンセルしました（新しいMP3は書き出していません）':'MP3作成エラー: '+e.message}
 finally{exportingMP3=false;button.disabled=false;document.getElementById('file').disabled=false;}
}
document.getElementById('export-mp3').onclick=exportMP3;
window.addEventListener('pagehide',()=>{if(mp3URL)URL.revokeObjectURL(mp3URL)});

const saveLink=document.getElementById('mp3-download');
saveLink.addEventListener('click',async event=>{
 if(!supportsSavePicker||!mp3Blob)return;
 event.preventDefault();
 try{
  const handle=await window.showSaveFilePicker({id:'allerseelen-mp3',suggestedName:mp3Filename,types:[{description:'MP3音声',accept:{'audio/mpeg':['.mp3']}}]});
  const stream=await handle.createWritable();
  try{await stream.write(mp3Blob);await stream.close()}catch(e){try{await stream.abort()}catch{}throw e}
  document.getElementById('export-status').textContent=`「${handle.name}」を保存しました`;
 }catch(e){document.getElementById('export-status').textContent=e.name==='AbortError'?'保存をキャンセルしました（作成済みMP3はもう一度保存できます）':'保存エラー: '+e.message}
});
if(supportsSavePicker){
 document.getElementById('export-mp3').textContent='保存先を選んでMP3保存';
 document.getElementById('export-status').textContent='保存先とファイル名を選んでから、現在の範囲・音色・テンポで書き出します。';
}else{
 document.getElementById('export-status').textContent='このブラウザーは保存先選択に未対応です。MP3はダウンロード先へ保存されます。';
}
