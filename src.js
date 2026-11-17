import './style.css';
import { initAI } from './ai.js';

const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.querySelector('#fileInput');
const replaceInput = document.querySelector('#replaceInput');
const emptyState = document.querySelector('#emptyState');
const exportBtn = document.querySelector('#exportBtn');
const toastEl = document.querySelector('#toast');
let image = null, originalImage = null, renderCap = 1800, originalUrl = null, rotation = 0, flipped = false, activeFilter = 'none';
let history = [], toastTimer;

const defaults = {brightness:100, contrast:100, saturation:100, blur:0};
let values = {...defaults};

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}
function setEnabled(enabled) {
  ['undoBtn','rotateBtn','flipBtn','resetBtn','exportBtn'].forEach(id => document.getElementById(id).disabled = !enabled);
}
function snapshot() {
  if (!image) return;
  history.push({rotation, flipped, activeFilter, values:{...values}, image, renderCap});
  if (history.length > 30) history.shift();
  document.querySelector('#undoBtn').disabled = false;
}
function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Please choose a valid image file.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = url; image = img; originalImage = img; renderCap = 1800; rotation = 0; flipped = false; activeFilter = 'none'; values = {...defaults}; history = [];
    Object.entries(values).forEach(([k,v]) => { const el=document.getElementById(k); el.value=v; document.getElementById(k+'Val').textContent = v+(k==='blur'?'px':'%'); });
    emptyState.classList.add('hidden'); setEnabled(true); render(); toast('Image loaded. Editing stays on this device.');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not open this image.'); };
  img.src = url;
}
function render() {
  if (!image) return;
  const sideways = Math.abs(rotation % 180) === 90;
  const maxSide = renderCap;
  let w=image.naturalWidth, h=image.naturalHeight;
  const scale=Math.min(1,maxSide/Math.max(w,h)); w=Math.round(w*scale); h=Math.round(h*scale);
  canvas.width=sideways?h:w; canvas.height=sideways?w:h;
  ctx.save(); ctx.translate(canvas.width/2,canvas.height/2); ctx.rotate(rotation*Math.PI/180);
  ctx.scale(flipped?-1:1,1);
  let filter=`brightness(${values.brightness}%) contrast(${values.contrast}%) saturate(${values.saturation}%) blur(${values.blur}px)`;
  if(activeFilter==='mono') filter+=' grayscale(1)';
  if(activeFilter==='warm') filter+=' sepia(.32) saturate(1.18)';
  if(activeFilter==='vivid') filter+=' saturate(1.55) contrast(1.08)';
  if(activeFilter==='fade') filter+=' contrast(.82) brightness(1.08) saturate(.75)';
  if(activeFilter==='noir') filter+=' grayscale(1) contrast(1.55) brightness(.9)';
  ctx.filter=filter; ctx.drawImage(image,-w/2,-h/2,w,h); ctx.restore();
  document.querySelector('#saveState').textContent='● Edited';
  window.dispatchEvent(new Event('darkroom:render'));
}
function updateSlider(id, val) {
  snapshot(); values[id]=Number(val);
  document.getElementById(id+'Val').textContent=val+(id==='blur'?'px':'%'); render();
}
['brightness','contrast','saturation','blur'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    values[id]=Number(e.target.value);
    document.getElementById(id+'Val').textContent=e.target.value+(id==='blur'?'px':'%');
    render();
  });
  document.getElementById(id).addEventListener('change', e => snapshot());
});
document.querySelector('#resetAdjust').onclick=()=>{snapshot(); values={...defaults}; Object.entries(values).forEach(([k,v])=>{document.getElementById(k).value=v;document.getElementById(k+'Val').textContent=v+(k==='blur'?'px':'%')});render();};
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===tab));
  ['adjust','filters','ai'].forEach(name=>document.getElementById(name+'Panel').classList.toggle('hidden',tab.dataset.tab!==name));
});
document.querySelectorAll('.filter').forEach(btn=>btn.onclick=()=>{if(!image)return toast('Choose an image first.');snapshot();activeFilter=btn.dataset.filter;render();document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('selected',b===btn));});
document.querySelector('#rotateBtn').onclick=()=>{snapshot();rotation=(rotation+90)%360;render();};
document.querySelector('#flipBtn').onclick=()=>{snapshot();flipped=!flipped;render();};
document.querySelector('#resetBtn').onclick=()=>{if(!image)return;snapshot();image=originalImage;renderCap=1800;rotation=0;flipped=false;activeFilter='none';values={...defaults};Object.entries(values).forEach(([k,v])=>{document.getElementById(k).value=v;document.getElementById(k+'Val').textContent=v+(k==='blur'?'px':'%')});render();toast('Edits reset.');};
document.querySelector('#undoBtn').onclick=()=>{const s=history.pop();if(!s)return;({rotation,flipped,activeFilter,image,renderCap}=s);values=s.values;Object.entries(values).forEach(([k,v])=>{document.getElementById(k).value=v;document.getElementById(k+'Val').textContent=v+(k==='blur'?'px':'%')});render();document.querySelector('#undoBtn').disabled=!history.length;};
fileInput.onchange=e=>loadFile(e.target.files[0]);
replaceInput.onchange=e=>loadFile(e.target.files[0]);
document.querySelector('.upload-btn').onclick=()=>fileInput.click();
const dropZone=document.querySelector('#dropZone');
dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('drag')});
dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('drag'));
dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('drag');loadFile(e.dataTransfer.files[0]);});
exportBtn.onclick=()=>{
  if(!image)return;
  canvas.toBlob(blob=>{if(!blob)return toast('Export failed.');const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='darkroom-edited.png';a.click();URL.revokeObjectURL(url);toast('PNG export started.');},'image/png');
};
function syncControls(){Object.entries(values).forEach(([k,v])=>{document.getElementById(k).value=v;document.getElementById(k+'Val').textContent=v+(k==='blur'?'px':'%')});document.querySelectorAll('.filter').forEach(b=>b.classList.remove('selected'));}
// Called by AI tools: bakes the result in as the new base image (undoable).
// `source` is a canvas, or an object/data URL string.
function commit(source,{fresh=false}={}){
  return new Promise((resolve,reject)=>{
    const finish=url=>{
      const img=new Image();
      img.onload=()=>{
        if(image&&!fresh)snapshot();
        image=img;if(fresh||!originalImage)originalImage=img;
        if(fresh)history=[];
        renderCap=Math.min(4096,Math.max(1800,img.naturalWidth,img.naturalHeight));
        rotation=0;flipped=false;activeFilter='none';values={...defaults};syncControls();
        emptyState.classList.add('hidden');setEnabled(true);
        document.querySelector('#undoBtn').disabled=!history.length;
        render();resolve();
      };
      img.onerror=()=>reject(new Error('Could not load the result image.'));
      img.src=url;
    };
    if(typeof source==='string')finish(source);
    else source.toBlob(b=>b?finish(URL.createObjectURL(b)):reject(new Error('Could not read the canvas.')),'image/png');
  });
}
initAI({canvas,commit,toast,hasImage:()=>!!image});
setEnabled(false);
