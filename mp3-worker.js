/* lamejs 1.2.1, LGPL-3.0; see vendor/lamejs-LICENSE. */
importScripts('vendor/lame-1.2.1.min.js');
onmessage=({data})=>{
 try{
  const samples=new Float32Array(data.samples),encoder=new lamejs.Mp3Encoder(1,data.sampleRate,192),chunks=[];
  let peak=0;for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));
  const scale=peak>0.98?0.98/peak:1,block=1152;let reported=-1;
  for(let i=0;i<samples.length;i+=block){
   const pcm=new Int16Array(Math.min(block,samples.length-i));
   for(let j=0;j<pcm.length;j++){const v=Math.max(-1,Math.min(1,samples[i+j]*scale));pcm[j]=Math.round(v*(v<0?32768:32767));}
   const bytes=encoder.encodeBuffer(pcm);if(bytes.length)chunks.push(new Uint8Array(bytes));
   const progress=Math.floor((i+pcm.length)/samples.length*100);
   if(progress>=reported+5){postMessage({progress});reported=progress;}
  }
  const tail=encoder.flush();if(tail.length)chunks.push(new Uint8Array(tail));
  const size=chunks.reduce((n,b)=>n+b.length,0),mp3=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){mp3.set(chunk,offset);offset+=chunk.length;}
  postMessage({complete:true,mp3:mp3.buffer,peak,limited:scale<1},[mp3.buffer]);
 }catch(e){postMessage({error:e.message||String(e)});}
};
