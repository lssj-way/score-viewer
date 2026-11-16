/* Playback position in the rendered score: the current measure is shaded and a line moves
   between the notes. Works on whichever renderer (full score or reduced section) is visible. */
const playCursor=(()=>{
 const UNIT=10,engines=new Set(),layouts=new WeakMap(),NS='http://www.w3.org/2000/svg';
 let frame=0,group=null,shade=null,line=null,lastScroll=0,lastSystem=null;
 function index(engine){for(const e of engines)if(!e.container?.isConnected)engines.delete(e);engines.add(engine);layouts.delete(engine)}
 // Source measure index -> measure box and (quarter offset, x) points, in OSMD units.
 function layout(engine){
  let map=layouts.get(engine);if(map)return map;map=new Map();
  const source=engine.Sheet.SourceMeasures;
  (engine.GraphicSheet?.MusicPages||[]).forEach((page,pageIndex)=>{for(const system of page.MusicSystems)for(const column of system.GraphicalMeasures){
   const staves=[].concat(column).filter(m=>m?.PositionAndShape);if(!staves.length)continue;
   const measure=source.indexOf(staves[0].parentSourceMeasure);if(measure<0)continue;
   const box=staves[0].PositionAndShape,x0=box.AbsolutePosition.x,ys=staves.map(m=>m.PositionAndShape.AbsolutePosition.y),points=new Map();
   for(const m of staves)for(const entry of m.staffEntries){const q=entry.relInMeasureTimestamp.RealValue*4,x=entry.PositionAndShape.AbsolutePosition.x;if(!(points.get(q)<=x))points.set(q,x)}
   map.set(measure,{system,pageIndex,x0,x1:x0+box.Size.width,y0:Math.min(...ys)-1.5,y1:Math.max(...ys)+5.5,points:[...points].sort((a,b)=>a[0]-b[0])});
  }});
  layouts.set(engine,map);return map;
 }
 function xAt(geometry,offset,length){
  const p=geometry.points.length&&geometry.points[0][0]<=0?[...geometry.points]:[[0,geometry.points[0]?.[1]??geometry.x0],...geometry.points];
  p.push([length,geometry.x1]);
  for(let i=1;i<p.length;i++)if(offset<=p[i][0]){const [q0,x0]=p[i-1],[q1,x1]=p[i];return q1>q0?x0+(x1-x0)*(offset-q0)/(q1-q0):x0}
  return geometry.x1;
 }
 function draw(position){
  let target=null;
  for(const engine of engines){if(!engine.container?.isConnected||!engine.container.offsetParent)continue;const g=layout(engine).get(position.measure);if(g){target={engine,g};break}}
  if(!target){group?.remove();group=null;return}
  const svg=target.engine.container.querySelectorAll('svg')[target.g.pageIndex];if(!svg)return;
  if(!group||group.ownerSVGElement!==svg){
   group?.remove();group=document.createElementNS(NS,'g');group.setAttribute('class','play-cursor');group.setAttribute('pointer-events','none');
   shade=document.createElementNS(NS,'rect');shade.setAttribute('fill','#ffd54a');shade.setAttribute('fill-opacity','.28');
   line=document.createElementNS(NS,'rect');line.setAttribute('fill','#1565c0');line.setAttribute('fill-opacity','.75');
   group.append(shade,line);svg.prepend(group);
  }
  const g=target.g,x=xAt(g,position.offset,position.length);
  const set=(el,a)=>{for(const [k,v] of Object.entries(a))el.setAttribute(k,v*UNIT)};
  set(shade,{x:g.x0,y:g.y0,width:g.x1-g.x0,height:g.y1-g.y0});set(line,{x:x-.15,y:g.y0,width:.3,height:g.y1-g.y0});
  follow(g.system);
 }
 // Scroll when playback reaches a new system or leaves the view; in between the reader can
 // scroll freely (systems with many parts are often taller than the screen).
 function follow(system){
  if(!document.getElementById('follow-play').checked||performance.now()-lastScroll<700)return;
  const main=document.querySelector('main'),view=main.getBoundingClientRect(),r=shade.getBoundingClientRect(),l=line.getBoundingClientRect();
  const fits=r.height<view.height-16,newSystem=system!==lastSystem;
  const away=l.bottom<view.top||l.top>view.bottom;
  const top=newSystem||away?main.scrollTop+r.top-view.top-(fits?Math.min(view.height*.2,view.height-r.height-8):8):null;
  const left=l.left<view.left+8||l.right>view.right-8?main.scrollLeft+l.left-view.left-view.width*.3:null;
  lastSystem=system;
  if(top===null&&left===null)return;
  lastScroll=performance.now();main.scrollTo({...(top===null?{}:{top}),...(left===null?{}:{left}),behavior:'smooth'});
 }
 // Bar under a screen point, in the visible renderer.
 function measureAt(x,y){
  for(const engine of engines){
   if(!engine.container?.isConnected||!engine.container.offsetParent)continue;
   const svgs=engine.container.querySelectorAll('svg');
   for(const [measure,g] of layout(engine)){
    const svg=svgs[g.pageIndex],ctm=svg?.getScreenCTM();if(!ctm)continue;
    const p=new DOMPoint(x,y).matrixTransform(ctm.inverse()),ux=p.x/UNIT,uy=p.y/UNIT;
    if(ux>=g.x0&&ux<=g.x1&&uy>=g.y0-2&&uy<=g.y1+2)return measure;
   }
  }
  return null;
 }
 // Tapping a bar plays from it (and restarts there during playback); the end of the range is kept.
 document.addEventListener('score-tap',e=>{
  if(!document.getElementById('tap-play').checked)return;
  const measure=measureAt(e.detail.x,e.detail.y);if(measure===null)return;
  const from=document.getElementById('from'),to=document.getElementById('to');
  from.value=measure+1;if(Number(to.value)<measure+1)to.value=total;measureLabels.sync();playScore();
 });
 function start(position){stop();const step=()=>{draw(position());frame=requestAnimationFrame(step)};frame=requestAnimationFrame(step)}
 function stop(){cancelAnimationFrame(frame);frame=0;group?.remove();group=null;lastSystem=null}
 return {index,start,stop,measureAt};
})();
