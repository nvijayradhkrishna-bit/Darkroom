import { inpaint, dilate } from './inpaint.js';

const $ = (s, r = document) => r.querySelector(s);

const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function scaled(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (s === 1) return src;
  const c = newCanvas(Math.round(src.width * s), Math.round(src.height * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function hasAlpha(src) {
  const c = newCanvas(64, 64); const x = c.getContext('2d');
  x.drawImage(src, 0, 0, 64, 64);
  const d = x.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 254) return true;
  return false;
}
const blobToCanvas = async blob => {
  const bmp = await createImageBitmap(blob);
  const c = newCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close?.();
  return c;
};
const fileToImage = file => new Promise((res, rej) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => res(img); img.onerror = () => rej(new Error('Could not open that image.'));
  img.src = url;
});

function unsharp(src, amount) {
  const w = src.width, h = src.height;
  const blur = newCanvas(w, h), bc = blur.getContext('2d');
  bc.filter = 'blur(1.2px)'; bc.drawImage(src, 0, 0);
  const a = src.getContext('2d').getImageData(0, 0, w, h), b = bc.getImageData(0, 0, w, h);
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) {
    const v = a.data[i + c] + amount * (a.data[i + c] - b.data[i + c]);
    a.data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  const out = newCanvas(w, h); out.getContext('2d').putImageData(a, 0, 0);
  return out;
}

export function initAI(api) {
  const { toast } = api;
  const list = $('#aiList'), view = $('#aiView'), busy = $('#busy'), busyText = $('#busyText'), busyBar = $('#busyBar');
  const wrap = $('#dropZone'), main = api.canvas;
  let working = false, swapOv = null;
  let maskCanvas = null, maskCtx = null, brush = 28, hasMask = false;

  /* ---------- shared helpers ---------- */
  function setBusy(on, text = 'Working…', pct = null) {
    busy.classList.toggle('hidden', !on);
    busyText.textContent = text;
    busyBar.parentElement.classList.toggle('hidden', pct == null);
    busyBar.style.width = (pct || 0) + '%';
  }
  async function run(label, fn) {
    if (working) return;
    working = true; setBusy(true, label);
    try { await fn(); }
    catch (err) {
      console.error(err);
      toast(err.message || 'Something went wrong.');
    } finally { working = false; setBusy(false); }
  }
  async function removeBg(src) {
    const { removeBackground } = await import('@imgly/background-removal');
    const blob = await new Promise(r => src.toBlob(r, 'image/png'));
    return removeBackground(blob, {
      publicPath: `${location.origin}/imgly/`,
      model: 'isnet_quint8',
      output: { format: 'image/png' },
      progress: (key, cur, total) => {
        if (total) setBusy(true, key.startsWith('fetch') ? 'Loading AI model…' : 'Removing background…', Math.round(cur / total * 100));
      },
    });
  }
  const tag = () => `<p class="where local">● Runs 100% on this device — free, no internet</p>`;

  /* ---------- tool views ---------- */
  const TOOLS = {
    background: {
      title: 'Background remover', sub: 'Cut the subject out as a transparent PNG',
      mount(body) {
        body.innerHTML = `${tag(false)}<p class="note">The first run downloads a segmentation model (~40–80 MB), then it works offline from cache.</p>
          <button class="primary wide" id="go">Remove background</button>`;
        $('#go', body).onclick = () => run('Preparing…', async () => {
          const blob = await removeBg(main);
          await api.commit(URL.createObjectURL(blob));
          toast('Background removed. Export PNG to keep transparency.');
        });
      },
    },
    replace: {
      title: 'Replace background', sub: 'New backdrop behind your subject',
      mount(body) {
        const bg = { kind: 'color', c1: '#2b2f4a', c2: '#a58cff', photo: null };
        body.innerHTML = `${tag(false)}
          <div class="seg" id="kind"><button data-k="color" class="on">Color</button><button data-k="gradient">Gradient</button><button data-k="photo">Photo</button></div>
          <div id="opts" class="opts"></div>
          <button class="primary wide" id="go">Apply background</button>`;
        const opts = $('#opts', body);
        const drawOpts = () => {
          opts.innerHTML = bg.kind === 'color' ? `<label>Color <input type="color" id="c1" value="${bg.c1}"></label>`
            : bg.kind === 'gradient' ? `<label>Top <input type="color" id="c1" value="${bg.c1}"></label><label>Bottom <input type="color" id="c2" value="${bg.c2}"></label>`
            : `<label class="filebtn">${bg.photo ? 'Photo chosen ✓ (tap to change)' : 'Choose background photo'}<input type="file" id="ph" accept="image/*" hidden></label>`;
          $('#c1', opts)?.addEventListener('input', e => bg.c1 = e.target.value);
          $('#c2', opts)?.addEventListener('input', e => bg.c2 = e.target.value);
          $('#ph', opts)?.addEventListener('change', async e => { if (e.target.files[0]) { bg.photo = await fileToImage(e.target.files[0]); drawOpts(); } });
        };
        drawOpts();
        $('#kind', body).onclick = e => {
          const k = e.target.dataset.k; if (!k) return;
          bg.kind = k; body.querySelectorAll('#kind button').forEach(b => b.classList.toggle('on', b === e.target)); drawOpts();
        };
        $('#go', body).onclick = () => run('Preparing…', async () => {
          if (bg.kind === 'photo' && !bg.photo) return toast('Choose a background photo first.');
          let cut;
          if (hasAlpha(main)) { cut = newCanvas(main.width, main.height); cut.getContext('2d').drawImage(main, 0, 0); }
          else cut = await blobToCanvas(await removeBg(main));
          const out = newCanvas(cut.width, cut.height), x = out.getContext('2d');
          if (bg.kind === 'color') { x.fillStyle = bg.c1; x.fillRect(0, 0, out.width, out.height); }
          else if (bg.kind === 'gradient') {
            const g = x.createLinearGradient(0, 0, 0, out.height); g.addColorStop(0, bg.c1); g.addColorStop(1, bg.c2);
            x.fillStyle = g; x.fillRect(0, 0, out.width, out.height);
          } else {
            const s = Math.max(out.width / bg.photo.naturalWidth, out.height / bg.photo.naturalHeight);
            const w = bg.photo.naturalWidth * s, h = bg.photo.naturalHeight * s;
            x.drawImage(bg.photo, (out.width - w) / 2, (out.height - h) / 2, w, h);
          }
          x.drawImage(cut, 0, 0);
          await api.commit(out);
          toast('Background replaced.');
        });
      },
    },
    enhance: {
      title: 'Enhance', sub: 'Sharpen details on-device',
      mount(body) {
        body.innerHTML = `${tag()}
          <div class="slider-row"><div><label for="amt">Strength</label><output id="amtVal">60%</output></div><input id="amt" type="range" min="10" max="150" value="60"></div>
          <button class="primary wide" id="sharp">Sharpen</button>`;
        $('#amt', body).oninput = e => $('#amtVal', body).textContent = e.target.value + '%';
        $('#sharp', body).onclick = () => run('Sharpening…', async () => {
          await new Promise(r => setTimeout(r, 30));
          await api.commit(unsharp(main, Number($('#amt', body).value) / 100));
          toast('Sharpened.');
        });
      },
    },
    object: {
      title: 'Object remover', sub: 'Paint over what you want gone',
      mount(body) {
        body.innerHTML = `${tag()}<div class="slider-row"><div><label for="brush">Brush size</label><output id="brushVal">${brush}px</output></div><input id="brush" type="range" min="8" max="80" value="${brush}"></div>
          <p class="note">Paint directly on the photo, then tap Remove. Best for small objects, dust and blemishes.</p>
          <div class="row"><button class="ghost" id="clear">Clear mask</button></div>
          <button class="primary wide" id="local">Remove</button>`;
        startMask();
        $('#brush', body).oninput = e => { brush = Number(e.target.value); $('#brushVal', body).textContent = brush + 'px'; };
        $('#clear', body).onclick = clearMask;
        $('#local', body).onclick = () => run('Filling…', async () => {
          if (!hasMask) return toast('Paint over the object first.');
          await new Promise(r => setTimeout(r, 30));
          const w = main.width, h = main.height;
          const m = dilate(readMask(), w, h, 3);
          const out = newCanvas(w, h), x = out.getContext('2d');
          x.drawImage(main, 0, 0);
          const id = x.getImageData(0, 0, w, h);
          inpaint(id.data, w, h, m);
          x.putImageData(id, 0, 0);
          teardownMask(); await api.commit(out); startMask(); toast('Removed.');
        });
      },
    },
    swap: {
      title: 'Swap subject', sub: 'Move a person or object from another photo into this one',
      mount(body) {
        let other = null, cut = null, size = 0.6, px = 0.5, py = 0.6;
        body.innerHTML = `${tag()}
          <label class="filebtn" id="pickLbl">Choose the other photo<input type="file" id="ph" accept="image/*" hidden></label>
          <div class="slider-row"><div><label for="sz">Size</label><output id="szV">60%</output></div><input id="sz" type="range" min="10" max="150" value="60"></div>
          <p class="note">Pick a photo, wait for the cut-out, then drag it on the picture to position it.</p>
          <button class="primary wide" id="go" disabled>Apply swap</button>
          <button class="ghost wide" id="flip" disabled>Switch photos (use this photo as the cut-out)</button>`;
        const geom = () => {
          const h = main.height * size, w = cut.width * h / cut.height;
          return [px * main.width - w / 2, py * main.height - h / 2, w, h];
        };
        const draw = () => {
          if (!swapOv || !cut) return;
          swapOv.width = main.width; swapOv.height = main.height;
          swapOv.getContext('2d').drawImage(cut, ...geom());
          syncOverlay(swapOv);
        };
        const makeOverlay = () => {
          swapOv?.remove(); swapOv = newCanvas(main.width, main.height); swapOv.className = 'maskov';
          let last = null;
          swapOv.onpointerdown = e => { e.preventDefault(); swapOv.setPointerCapture(e.pointerId); last = e; };
          swapOv.onpointermove = e => {
            if (!last) return; const r = swapOv.getBoundingClientRect();
            px += (e.clientX - last.clientX) / r.width; py += (e.clientY - last.clientY) / r.height; last = e; draw();
          };
          swapOv.onpointerup = swapOv.onpointercancel = () => last = null;
          wrap.appendChild(swapOv); draw();
        };
        const setCut = async imgCanvas => {
          const c = await blobToCanvas(await removeBg(scaled(imgCanvas, 1280)));
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          if (x1 <= x0 || y1 <= y0) throw new Error('No subject found in that photo.');
          cut = newCanvas(x1 - x0 + 1, y1 - y0 + 1); cut.getContext('2d').drawImage(c, -x0, -y0);
          px = 0.5; py = 0.6; makeOverlay();
          $('#go', body).disabled = false; $('#flip', body).disabled = false;
        };
        $('#ph', body).onchange = e => run('Cutting out the subject…', async () => {
          const f = e.target.files[0]; if (!f) return;
          const img = await fileToImage(f); other = newCanvas(img.naturalWidth, img.naturalHeight);
          other.getContext('2d').drawImage(img, 0, 0); await setCut(other);
          $('#pickLbl', body).firstChild.textContent = 'Other photo chosen ✓ (tap to change)';
        });
        $('#sz', body).oninput = e => { size = Number(e.target.value) / 100; $('#szV', body).textContent = e.target.value + '%'; draw(); };
        $('#go', body).onclick = () => run('Applying…', async () => {
          const out = newCanvas(main.width, main.height), x = out.getContext('2d');
          x.drawImage(main, 0, 0); x.drawImage(cut, ...geom());
          swapOv?.remove(); swapOv = null;
          await api.commit(out); toast('Swapped. Tap Undo to revert.'); closeTool();
        });
        $('#flip', body).onclick = () => run('Switching photos…', async () => {
          const current = newCanvas(main.width, main.height); current.getContext('2d').drawImage(main, 0, 0);
          await api.commit(other); other = current; await setCut(other);
        });
      },
    },
  };

  /* ---------- mask overlay for the object remover ---------- */
  function syncOverlay(el = maskCanvas) {
    if (!el) return;
    const r = main.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    Object.assign(el.style, { left: r.left - w.left + 'px', top: r.top - w.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function startMask() {
    teardownMask();
    maskCanvas = newCanvas(main.width, main.height); maskCtx = maskCanvas.getContext('2d');
    maskCanvas.className = 'maskov'; hasMask = false;
    let last = null;
    const pos = e => { const r = maskCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * maskCanvas.width / r.width, y: (e.clientY - r.top) * maskCanvas.height / r.height, k: maskCanvas.width / r.width }; };
    const dot = (a, b, k) => {
      maskCtx.strokeStyle = maskCtx.fillStyle = '#ff3b6b'; maskCtx.lineCap = maskCtx.lineJoin = 'round'; maskCtx.lineWidth = brush * k;
      maskCtx.beginPath(); maskCtx.moveTo(a.x, a.y); maskCtx.lineTo(b.x, b.y); maskCtx.stroke(); hasMask = true;
    };
    maskCanvas.addEventListener('pointerdown', e => { e.preventDefault(); maskCanvas.setPointerCapture(e.pointerId); last = pos(e); dot(last, last, last.k); });
    maskCanvas.addEventListener('pointermove', e => { if (!last) return; const p = pos(e); dot(last, p, p.k); last = p; });
    ['pointerup', 'pointercancel'].forEach(t => maskCanvas.addEventListener(t, () => last = null));
    wrap.appendChild(maskCanvas); syncOverlay();
  }
  function teardownMask() { maskCanvas?.remove(); maskCanvas = maskCtx = null; hasMask = false; }
  function clearMask() { maskCtx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height); hasMask = false; }
  function readMask() {
    const d = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data, m = new Uint8Array(d.length / 4);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 20 ? 1 : 0;
    return m;
  }
  window.addEventListener('resize', () => { syncOverlay(); syncOverlay(swapOv); });
  window.addEventListener('darkroom:render', () => {
    if (swapOv) syncOverlay(swapOv);
    if (!maskCanvas) return;
    if (maskCanvas.width !== main.width || maskCanvas.height !== main.height) { startMask(); } else syncOverlay();
  });

  /* ---------- navigation ---------- */
  function openTool(id) {
    if (!api.hasImage()) return toast('Choose an image first.');
    const t = TOOLS[id];
    list.classList.add('hidden'); view.classList.remove('hidden');
    view.innerHTML = `<button class="textbtn back" id="aiBack">‹ All tools</button><div class="panel-title"><div><h2>${t.title}</h2><p>${t.sub}</p></div></div><div id="toolBody"></div>`;
    $('#aiBack').onclick = closeTool;
    t.mount($('#toolBody'));
  }
  function closeTool() { teardownMask(); swapOv?.remove(); swapOv = null; view.classList.add('hidden'); view.innerHTML = ''; list.classList.remove('hidden'); }
  document.querySelectorAll('[data-ai]').forEach(b => b.onclick = () => openTool(b.dataset.ai));
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { if (t.dataset.tab !== 'ai') closeTool(); }));
}
