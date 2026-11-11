const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const vm=require('node:vm');

const root=resolve(__dirname,'..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Exercise the page's event handlers with fake media and a controllable keyboard.
// These checks do not emulate browser layout or the native iOS keyboard.
function page(){
  const elements={},storage=new Map(),frames=new Map(),revoked=[],downloads=[];
  let nextFrame=0,stopped=0;
  const document={activeElement:null,documentElement:{clientHeight:844,style:{setProperty(k,v){this[k]=v}}}};
  function element(id,classes=''){
    const classSet=new Set(classes.split(' ').filter(Boolean));
    const e={id,value:'',style:{setProperty(k,v){this[k]=v}},disabled:false,checked:false,
      textContent:'',clientHeight:200,scrollHeight:400,firstElementChild:{},listeners:{},
      classList:{add:c=>classSet.add(c),remove:c=>classSet.delete(c),contains:c=>classSet.has(c),
        toggle(c,on){if(on??!classSet.has(c))classSet.add(c);else classSet.delete(c)}},
      addEventListener(name,fn){this.listeners[name]=fn},
      setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},
      focus(){document.activeElement=this;this.listeners.focus?.()},
      blur(){document.activeElement=null;this.listeners.blur?.()},
      pause(){},load(){},click(){downloads.push(this)},
      animate(keyframes,options){this.animation={keyframes,options,cancel(){}};return this.animation}};
    return e;
  }
  for(const m of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    elements[m[1]]=element(m[1],m[0].match(/class="([^"]+)"/)?.[1]);
  }
  Object.assign(elements.speed,{value:'45',min:'10',max:'150'});
  Object.assign(elements.size,{value:'30',min:'18',max:'56'});
  const modes=[elements['m-scroll'],elements['m-chunk']];
  modes[0].value='scroll';modes[1].value='chunk';
  document.getElementById=id=>elements[id];
  document.querySelectorAll=()=>modes;
  document.querySelector=s=>s.includes(':checked')?modes.find(e=>e.checked):modes.find(e=>s.includes(`"${e.value}"`));
  document.createElement=()=>element('download');
  const viewport={height:844,offsetTop:0,listeners:{},addEventListener(n,fn){this.listeners[n]=fn}};
  const tracks=[{stop(){stopped++}},{stop(){stopped++}}];
  const stream={getTracks:()=>tracks};
  class MediaRecorder{
    static instances=[];
    static isTypeSupported(t){return t==='video/mp4'}
    constructor(stream,options){this.state='inactive';this.mimeType=options.mimeType;MediaRecorder.instances.push(this)}
    start(){this.state='recording'}
    stop(){this.state='inactive';queueMicrotask(()=>{
      this.ondataavailable({data:new Blob(['recorded-video'],{type:this.mimeType})});this.onstop();
    })}
  }
  const context=vm.createContext({document,visualViewport:viewport,innerHeight:844,
    addEventListener(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    navigator:{mediaDevices:{getUserMedia:async()=>stream}},MediaRecorder,Blob,File,
    URL:{createObjectURL:()=>`blob:take-${Math.random()}`,revokeObjectURL:u=>revoked.push(u)},
    getComputedStyle:e=>({lineHeight:'40.5px',paddingTop:e.style.paddingTop||'0px'}),
    requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){}});
  context.window=context;
  vm.runInContext(source,context);
  context.countdown=async()=>{};
  const state=code=>vm.runInContext(code,context);
  async function open(mode='scroll'){
    elements.script.value='First line of the script.\nSecond line of the script.';
    elements.script.listeners.input();
    state(`mode.value='${mode}'`);await elements.go.onclick();
  }
  async function record(){await elements.recBtn.onclick()}
  async function stop(){await elements.recBtn.onclick();await Promise.resolve()}
  return {context,e:elements,viewport,storage,frames,revoked,downloads,state,open,record,stop,
    recorders:MediaRecorder.instances,stopped:()=>stopped};
}

test('editor follows keyboard height and pan while preserving typed and pasted scripts',()=>{
  const p=page(),s=p.e.script;
  s.focus();p.viewport.height=310;p.viewport.offsetTop=90;p.viewport.listeners.resize();
  assert.equal(p.context.document.documentElement.style['--viewport-height'],'310px');
  assert.equal(p.context.document.documentElement.style['--viewport-top'],'90px');
  assert.ok(p.e.edit.classList.contains('keyboard-open'));
  s.value='Typed words\n'+'Pasted script. '.repeat(1000);s.listeners.input();
  assert.equal(p.storage.get('script'),s.value);
  assert.equal(p.context.document.activeElement,s);
  s.blur();assert.ok(!p.e.edit.classList.contains('keyboard-open'));
  p.viewport.height=844;p.viewport.offsetTop=0;p.viewport.listeners.resize();
  assert.equal(p.context.document.documentElement.style['--viewport-height'],'844px');
});

test('camera preview stays idle, countdown positions line one, repeated starts are ignored',async()=>{
  const p=page();await p.open();
  assert.equal(p.state('scrolling'),false);assert.equal(p.e.pause.disabled,true);
  assert.ok(p.state('y')<0);assert.equal(p.frames.size,0);
  p.context.countdown=()=>new Promise(r=>{p.context.finishCountdown=r});
  const pending=p.e.recBtn.onclick();
  assert.equal(p.e.recBtn.disabled,true);assert.equal(p.e.back.disabled,true);
  await p.e.recBtn.onclick();assert.equal(p.recorders.length,0);
  assert.equal(p.e.text.animation.keyframes[1].transform,'translateY(0)');
  p.context.finishCountdown();await pending;
  assert.equal(p.recorders.length,1);assert.equal(p.state('y'),0);
  assert.equal(p.state('scrolling'),true);assert.equal(p.frames.size,1);
});

test('pause/resume cancels the old animation loop',async()=>{
  const p=page();await p.open();await p.record();
  p.e.pause.onclick();assert.equal(p.frames.size,0);assert.equal(p.state('scrolling'),false);
  p.e.pause.onclick();assert.equal(p.frames.size,1);
  p.state('setScroll(true)');assert.equal(p.frames.size,1);
  await p.stop();assert.equal(p.frames.size,0);
});

test('take can be saved, recorded again, then cancelled without losing the script',async()=>{
  const p=page();await p.open();await p.record();await p.stop();
  assert.ok(!p.e.done.classList.contains('hide'));assert.ok(p.state('blob.size')>0);
  const firstURL=p.e.out.src;
  await p.e.save.onclick();assert.equal(p.downloads.length,1);assert.equal(p.downloads[0].href,firstURL);
  p.e.again.onclick();assert.ok(p.revoked.includes(firstURL));
  assert.equal(p.state('blob'),null);assert.ok(!p.e.rec.classList.contains('hide'));
  assert.equal(p.state('scrolling'),false);assert.equal(p.e.pause.disabled,true);
  await p.record();await p.stop();const secondURL=p.e.out.src;
  p.e.cancel.onclick();assert.ok(p.revoked.includes(secondURL));
  assert.ok(!p.e.edit.classList.contains('hide'));assert.equal(p.stopped(),2);
  assert.equal(p.state('blob'),null);assert.equal(p.e.cam.srcObject,null);
  assert.equal(p.e.script.value,p.storage.get('script'));assert.equal(p.downloads.length,1);
  await p.open();assert.ok(!p.e.rec.classList.contains('hide'));
});

test('phrase mode waits until recording and resets to phrase one for another take',async()=>{
  const p=page();await p.open('chunk');const first=p.e.chunk.textContent;
  assert.equal(p.state('scrolling'),false);assert.ok(first);
  await p.record();assert.equal(p.e.chunk.textContent,first);
  p.state('ci=1;showChunk()');await p.stop();p.e.again.onclick();
  assert.equal(p.e.chunk.textContent,first);assert.equal(p.state('scrolling'),false);
});

test('recording failure restores controls and allows retry',async()=>{
  const p=page();await p.open();
  p.context.MediaRecorder=class{static isTypeSupported(){return true}constructor(){throw Error('Encoder unavailable')}};
  await p.record();assert.equal(p.e.recBtn.disabled,false);assert.equal(p.e.back.disabled,false);
  assert.equal(p.e.pause.disabled,true);assert.equal(p.state('scrolling'),false);
  assert.ok(!p.e.recStatus.classList.contains('hide'));
});

test('camera permission failure leaves the editor usable',async()=>{
  const p=page();p.context.navigator.mediaDevices.getUserMedia=async()=>{throw Error('Denied')};
  await p.open();assert.ok(!p.e.edit.classList.contains('hide'));
  assert.equal(p.e.go.disabled,false);assert.match(p.e.meta.textContent,/Camera and microphone access/);
});

test('deployed CSP permits the exact inline script and stylesheet',()=>{
  const config=JSON.parse(readFileSync(resolve(root,'vercel.json'),'utf8'));
  const csp=config.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
  for(const tag of ['script','style']){
    const content=html.match(new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`))[1];
    const hash=createHash('sha256').update(content).digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`),`${tag} hash must match the deployed page`);
  }
});
