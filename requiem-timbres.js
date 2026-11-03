/* Accepted Requiem SATB spectra, shared by live playback and MP3 export. */
function requiemPartials(f0,tone,sampleRate=48000){
 const [,voice,mode]=tone.split('-'),tr=['soprano','alto','tenor','bass'].indexOf(voice);
 const gauss=(f,c,w)=>Math.exp(-.5*((f-c)/w)**2),logbell=(f,c,w)=>Math.exp(-.5*(Math.log2(f/c)/w)**2);
 const db=x=>10**(x/20),limit=Math.min(17000,sampleRate*.45),r=[];
 for(let h=1;h<=80&&h*f0<limit;h++){
  const f=h*f0;let a;
  if(tr===0)a=(.12+2.1*gauss(f,780,180)+gauss(f,1450,240)+.4*gauss(f,2850,440)+.1*gauss(f,4500,650))/h**1.15;
  else if(tr===1)a=(.12+2.1*gauss(f,600,180)+gauss(f,1150,240)+.4*gauss(f,2750,440)+.1*gauss(f,4500,650))/h**1.15*db(3*gauss(f,2500,650)+3*logbell(f,450,.7));
  else {
   a=(.08+2*gauss(f,tr===2?650:500,tr===2?150:130)+1.15*gauss(f,tr===2?1100:950,tr===2?200:180)+.65*gauss(f,2800,330))/h**1.15;
   a*=db(tr===2?4*gauss(f,2750,550):Math.min(7,Math.max(0,3*Math.log2(Math.max(f,500)/500)))+4.5*logbell(f,300,.7));
  }
  r.push([h,a]);
 }
 const norm=Math.sqrt(r.reduce((s,[h,a])=>s+a*a/2,0));
 for(const q of r){const h=q[0],f=h*f0;q[1]/=norm;
  if(tr===0)q[1]*=db(({1:3,6:-6,7:3,8:3})[h]||0);
  if(tr===3)q[1]*=db(3*logbell(f,300,.7)+17*logbell(f,150,.6));
  if(mode==='solo'){const band=Math.min(Math.max(0,Math.min(1,(f-1700)/300)),Math.max(0,Math.min(1,(4300-f)/300)));q[1]*=db([4,6,8,4][tr]*(.5-.5*Math.cos(Math.PI*band)));}
 }
 // One common gain preserves the accepted bass body and solo band boosts.
 return r.map(([h,a])=>[h,a*.12]);
}
