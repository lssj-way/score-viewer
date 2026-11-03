
const $=id=>document.getElementById(id);let scoreXML='';let busy=false,total=0,scoreFilename='score.musicxml';
const osmd=new opensheetmusicdisplay.OpenSheetMusicDisplay('score',{autoResize:false,backend:'svg',drawMeasureNumbers:true,measureNumberInterval:1,useXMLMeasureNumbers:true,drawMeasureNumbersOnlyAtSystemStart:false});
osmd.setLogLevel('error');
// Scale a stable engraving canvas; account for its scaled height in document flow.
const fitControl=$('fit-width');
fitControl.checked=window.matchMedia('(max-width: 767px)').matches;
let layoutWidth=0;
function preparePaper(){
 const frame=$('score-frame'),paper=$('paper');
 paper.style.transform='none';frame.style.height='';
 layoutWidth=frame.clientWidth;
 paper.style.width=Math.max(720,Math.min(1600,layoutWidth))+'px';
 paper.style.margin=fitControl.checked?'0':'auto';
}
function fitPaper(){
 const frame=$('score-frame'),paper=$('paper');
 frame.classList.toggle('fitted',fitControl.checked);
 if(fitControl.checked){
  const scale=Math.min(1,frame.clientWidth/Math.max(paper.offsetWidth,paper.scrollWidth));
  paper.style.transform='scale('+scale+')';
  frame.style.height=Math.ceil(paper.offsetHeight*scale)+'px';
 }else{paper.style.transform='none';frame.style.height=''}
 if(scoreXML)$('hint').textContent=fitControl.checked?'横幅全体を表示しています。細部は2本指で拡大できます。声部の再生設定はミキサーで変更できます。':'左右にスクロールして楽譜を確認できます。声部の再生設定はミキサーで変更できます。';
}
async function renderScore(xml){preparePaper();await emptyStaves.render(osmd,xml);resizeAnalysis(xml);fitPaper()}
fitControl.addEventListener('change',()=>{if(scoreXML)redraw();else{preparePaper();fitPaper()}});
let resizeFrame;
new ResizeObserver(()=>{
 cancelAnimationFrame(resizeFrame);
 resizeFrame=requestAnimationFrame(()=>{
  if(Math.abs($('score-frame').clientWidth-layoutWidth)<1||busy)return;
  if(scoreXML)redraw();else{preparePaper();fitPaper()}
 });
}).observe($('score-frame'));
preparePaper();fitPaper();
function status(s,error=false){$('status').textContent=s;$('status').className=error?'error':''}
function options(){let a=Number($('from').value),b=Number($('to').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>total)throw Error('小節範囲を1〜'+total+'で指定してください');/* Range uses XML positions: OSMD otherwise shifts ranges after an inferred pickup. */ osmd.EngravingRules.MinMeasureToDrawIndex=a-1;osmd.EngravingRules.MaxMeasureToDrawIndex=b-1;osmd.EngravingRules.MinMeasureToDrawNumber=0;osmd.EngravingRules.MaxMeasureToDrawNumber=0;osmd.Zoom=Number($('zoom').value)/100;$('pct').textContent=$('zoom').value+'%'}
function resizeAnalysis(xml){
const doc=new DOMParser().parseFromString(xml,'application/xml');
const lines=new Set([...doc.querySelectorAll('direction[id^="prelude-analysis-"] words')].flatMap(w=>w.textContent.split('\n')));
// OSMD uses a fixed expression size; honor explicit point sizes for Minne annotations.
const minneSizes=new Map([...doc.querySelectorAll('direction[id^="minne-analysis-"] words')].flatMap(w=>w.textContent.split('\n').map(line=>[line.trim(),Number(w.getAttribute('font-size'))])));
for(const t of document.querySelectorAll('#score svg text')){
if(lines.has(t.textContent.trim())){const size=parseFloat(getComputedStyle(t).fontSize);t.style.fontSize=(size*0.83)+'px';}
const pointSize=minneSizes.get(t.textContent.trim());
if(Number.isFinite(pointSize)&&pointSize>0)t.style.fontSize=(pointSize*4/3)+'px';
}
// Anchor the two analysis lines to bar 16's original diminuendo label.
const special=doc.querySelector('direction[id="prelude-analysis-16"] words');
if(special){
const pair=special.textContent.split('\n');
const texts=[...document.querySelectorAll('#score svg text')];
const labels=texts.filter(t=>pair.includes(t.textContent.trim()));
const dims=texts.filter(t=>t.textContent.trim()==='dim.');
if(labels.length&&dims.length){
const origin=labels[0].getBoundingClientRect();
const dim=dims.sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.hypot(x.x-origin.x,x.y-origin.y)-Math.hypot(y.x-origin.x,y.y-origin.y)})[0];
const anchor=dim.getBoundingClientRect();
for(const t of labels){
const rect=t.getBoundingClientRect(),row=pair.indexOf(t.textContent.trim());
const gap=rect.height+5*osmd.Zoom;
const dx=anchor.left-rect.left,dy=anchor.top-(2-row)*gap-5*osmd.Zoom-rect.top;
const inv=t.getScreenCTM().inverse();
const x=inv.a*dx+inv.c*dy,y=inv.b*dx+inv.d*dy;
t.setAttribute('transform',(t.getAttribute('transform')||'')+` translate(${x} ${y})`);
}
}
}
}

async function openScore(file){
 if(!file||busy)return;
 if(exportingMP3){status('MP3の作成が終わってから楽譜を開いてください',true);return}
 busy=true;$('file').disabled=true;stopPlayback();
 try{
  if(file.size>20*1024*1024)throw Error('20 MB以下のMusicXMLを選んでください');
  const bytes=await file.arrayBuffer();
  const declaration=new TextDecoder().decode(bytes.slice(0,200));
  const encoding=declaration.match(/encoding=["']([^"']+)/i)?.[1]||'utf-8';
  const xml=new TextDecoder(encoding).decode(bytes);
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror')||doc.documentElement.tagName!=='score-partwise')throw Error('非圧縮のMusicXML（.xml / .musicxml）を選んでください');
  const measures=doc.querySelectorAll('score-partwise > part:first-of-type > measure').length;
  if(!measures)throw Error('小節が見つかりません');
  status('楽譜を描画しています…');
  total=measures;$('from').value=1;$('to').value=Math.min(8,total);
  $('from').max=$('to').max=total;options();
  await osmd.load(scoreLabels.displayXML(xml));emptyStaves.load(xml);await renderScore(xml);
  scoreXML=xml;scoreFilename=file.name;partMixer.load(xml);setSettings(false);
  $('score-title').textContent=doc.querySelector('work-title, movement-title')?.textContent||file.name;
  document.title=$('score-title').textContent+' — Score Viewer';
  status(file.name+' · '+total+'小節 · 端末内で読み込みました');
  fitPaper();
 }catch(e){scoreXML='';total=0;osmd.clear();status(e.message,true)}
 finally{busy=false;$('file').disabled=false;$('file').value=''}
}
let redrawTimer,rendering=false,redrawPending=false;
async function redraw(){if(!scoreXML)return;clearTimeout(redrawTimer);redrawTimer=setTimeout(runRedraw,180)}
async function runRedraw(){if(rendering){redrawPending=true;return}rendering=true;stopPlayback('表示を更新しています');try{options();await renderScore(scoreXML)}catch(e){status(e.message,true)}finally{rendering=false;if(redrawPending){redrawPending=false;redraw()}}}
$('file').onchange=e=>openScore(e.target.files[0]);
$('zoom').oninput=redraw;
$('minus').onclick=()=>{$('zoom').value=Number($('zoom').value)-10;redraw()};
$('plus').onclick=()=>{$('zoom').value=Number($('zoom').value)+10;redraw()};
$('range').onclick=redraw;
$('all').onclick=()=>{stopPlayback();$('from').value=1;$('to').value=total;redraw()};

function setSettings(open){
 $('settings-panel').hidden=!open;
 $('settings-toggle').setAttribute('aria-expanded',String(open));
}
$('settings-toggle').onclick=()=>setSettings($('settings-panel').hidden);
$('settings-close').onclick=()=>{setSettings(false);$('settings-toggle').focus()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('settings-panel').hidden){setSettings(false);$('settings-toggle').focus()}});
