/* ==========================================================================
   aniruddha.dev — motion + graphics engine
   Three.js (liquid core + star field), GSAP/ScrollTrigger (reveals, pinning,
   scrubbing), Lenis (smooth scroll), and a handful of hand-rolled canvases.
   Every module degrades: no WebGL → CSS orb, no GSAP → static content.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const isMobile = () => innerWidth <= 900;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const hasGSAP = !!(gsap && ScrollTrigger);
if (hasGSAP) gsap.registerPlugin(ScrollTrigger);

const state = {
  time: 0, scrollY: scrollY, vel: 0,
  px: innerWidth / 2, py: innerHeight / 2, nx: 0, ny: 0,
  accent: '#9184d9',
};

/* ---------- frame loop ---------- */
const loops = new Set();
const addLoop = (fn) => loops.add(fn);
let lastT = performance.now(), lastY = scrollY;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  state.time += dt * (reduced ? 0.25 : 1);
  state.scrollY = scrollY;
  state.vel = lerp(state.vel, state.scrollY - lastY, 0.15);
  lastY = state.scrollY;
  for (const fn of loops) {
    try { fn(dt, state.time); } catch (e) { loops.delete(fn); console.error(e); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* visibility gate: fx.visible flips as the element nears the viewport */
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.target.__fx) e.target.__fx.visible = e.isIntersecting;
}, { rootMargin: '120px' });
function observe(el, fx) { fx.visible = false; el.__fx = fx; io.observe(el); return fx; }

function fitCanvas(canvas, maxDpr = 2) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height, dpr };
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

/* ---------- Perlin noise (improved), used by the canvases ---------- */
const perm = new Uint8Array(512);
(() => {
  const p = [...Array(256).keys()];
  let s = 1337;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
         lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
         lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}

/* ==========================================================================
   Smooth scroll
   ========================================================================== */
let lenis = null;
if (window.Lenis && !reduced) {
  lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 1 });
  if (hasGSAP) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  lenis.stop();
  window.lenis = lenis;
}

function scrollToTarget(hash) {
  const el = hash === '#top' ? 0 : $(hash);
  if (el === null) return;
  if (lenis) lenis.scrollTo(el, { offset: hash === '#top' ? 0 : -70, duration: 1.5 });
  else if (el === 0) scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
}

/* ==========================================================================
   Pointer + custom cursor
   ========================================================================== */
addEventListener('pointermove', (e) => {
  state.px = e.clientX; state.py = e.clientY;
  state.nx = (e.clientX / innerWidth) * 2 - 1;
  state.ny = (e.clientY / innerHeight) * 2 - 1;
}, { passive: true });

(function cursor() {
  if (!finePointer) return;
  const ring = $('#cursor'), dot = $('#cursorDot'), label = ring.querySelector('span');
  let rx = state.px, ry = state.py, shown = false;
  addEventListener('pointermove', () => { if (!shown) { root.classList.add('has-cursor'); shown = true; } }, { passive: true });
  document.addEventListener('mouseleave', () => { root.classList.remove('has-cursor'); shown = false; });
  document.addEventListener('pointerover', (e) => {
    const lab = e.target.closest('[data-cursor-label]');
    const hot = e.target.closest('a, button, [data-cursor], input, textarea, .tilt');
    ring.classList.toggle('is-label', !!lab);
    ring.classList.toggle('is-hover', !lab && !!hot);
    if (lab) label.textContent = lab.dataset.cursorLabel;
  });
  addLoop(() => {
    rx = lerp(rx, state.px, 0.2); ry = lerp(ry, state.py, 0.2);
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    dot.style.transform = `translate3d(${state.px}px, ${state.py}px, 0)`;
  });
})();

/* ==========================================================================
   Toast, clipboard, clock
   ========================================================================== */
const toastEl = $('#toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2200);
}
$$('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
  const text = btn.dataset.copy;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast('Email copied ✓');
}));

(function clock() {
  const el = $('#clock');
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const tick = () => { el.textContent = `${fmt.format(new Date())} IST`; };
  tick(); setInterval(tick, 20000);
})();

/* ==========================================================================
   Nav: hide on scroll down, active link, mobile menu, anchors
   ========================================================================== */
(function nav() {
  const bar = $('#nav'), btn = $('#menuBtn'), menu = $('#mobileMenu');
  let prev = scrollY;
  addLoop(() => {
    const y = state.scrollY;
    bar.classList.toggle('is-scrolled', y > 40);
    if (!root.classList.contains('menu-open')) {
      if (y > prev + 4 && y > 400) bar.classList.add('is-hidden');
      else if (y < prev - 4 || y < 400) bar.classList.remove('is-hidden');
    }
    prev = y;
  });

  const setMenu = (open) => {
    root.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (!open && menu.contains(document.activeElement)) btn.focus({ preventScroll: true });
    menu.inert = !open;
    if (lenis) open ? lenis.stop() : lenis.start();
    if (hasGSAP && open) gsap.fromTo($$('a', menu), { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: 0.05, duration: 0.8, ease: 'expo.out', delay: 0.15 });
  };
  btn.addEventListener('click', () => setMenu(!root.classList.contains('menu-open')));

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const hash = a.getAttribute('href');
    if (hash.length < 2) return;
    e.preventDefault();
    if (root.classList.contains('menu-open')) setMenu(false);
    scrollToTarget(hash);
  });

  // Highlight whichever nav section spans the middle of the viewport (none over the hero/band)
  const links = $$('.nav__links a');
  const secs = links.map((l) => document.getElementById(l.getAttribute('href').slice(1))).filter(Boolean);
  let lastCheck = -1;
  addLoop(() => {
    if (Math.abs(state.scrollY - lastCheck) < 8) return;
    lastCheck = state.scrollY;
    const mid = innerHeight * 0.45;
    const cur = secs.find((sec) => { const r = sec.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
    links.forEach((l) => l.classList.toggle('is-active', !!cur && l.getAttribute('href') === '#' + cur.id));
  });
})();

/* progress bar + fixed aura parallax */
(function progress() {
  const bar = $('#progress');
  const auras = $$('.aura[data-parallax]');
  addLoop(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? state.scrollY / max : 0})`;
    for (const a of auras) {
      const f = parseFloat(a.dataset.parallax);
      a.style.transform = `translate3d(${state.nx * 30 * f}px, ${-state.scrollY * f * 0.4}px, 0)`;
    }
  });
})();

/* ==========================================================================
   Magnetic buttons + 3D tilt cards
   ========================================================================== */
(function magnetic() {
  if (!finePointer || !hasGSAP) return;
  $$('.magnetic').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.35);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.35);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
})();

(function tilt() {
  if (!finePointer || !hasGSAP || reduced) return;
  $$('.tilt').forEach((el) => {
    const max = el.classList.contains('project') ? 5 : 8;
    const glare = el.querySelector('.glare');
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.7, ease: 'power3.out' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.7, ease: 'power3.out' });
    gsap.set(el, { transformPerspective: 1100 });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      ry((px - 0.5) * max * 2);
      rx(-(py - 0.5) * max * 2);
      if (glare) { glare.style.setProperty('--gx', px * 100 + '%'); glare.style.setProperty('--gy', py * 100 + '%'); }
    });
    el.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
})();

/* ==========================================================================
   Text splitting (words / chars) for reveals
   ========================================================================== */
function splitWords(el) {
  const out = [];
  const nodes = [...el.childNodes];
  el.textContent = '';
  const addWord = (text, cls) => {
    const w = document.createElement('span'); w.className = 'word';
    const inner = document.createElement('span'); inner.textContent = text;
    if (cls) inner.className = cls;
    w.appendChild(inner); el.appendChild(w); out.push(inner);
  };
  for (const n of nodes) {
    const text = n.textContent;
    const cls = n.nodeType === 1 ? n.className : '';
    text.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) el.appendChild(document.createTextNode(' '));
      else addWord(part, cls);
    });
  }
  el.setAttribute('aria-label', nodes.map((n) => n.textContent).join(''));
  return out;
}

function splitChars(el) {
  const chars = [];
  const walk = (node, parent) => {
    if (node.nodeType === 3) {
      for (const c of node.textContent) {
        if (c === ' ' || c === '\n') { parent.appendChild(document.createTextNode(' ')); continue; }
        const s = document.createElement('span'); s.className = 'ch'; s.textContent = c;
        parent.appendChild(s); chars.push(s);
      }
    } else if (node.nodeName === 'BR') {
      parent.appendChild(document.createElement('br'));
    } else {
      const clone = node.cloneNode(false);
      parent.appendChild(clone);
      [...node.childNodes].forEach((c) => walk(c, clone));
    }
  };
  const label = el.textContent.replace(/\s+/g, ' ').trim();
  const nodes = [...el.childNodes];
  el.textContent = '';
  nodes.forEach((n) => walk(n, el));
  el.setAttribute('aria-label', label);
  return chars;
}

function scramble(el, final, dur = 900) {
  const glyphs = '!<>-_/[]{}=+*^?#AWXZ01';
  const start = performance.now();
  const step = () => {
    const p = Math.min((performance.now() - start) / dur, 1);
    const shown = Math.floor(p * final.length);
    let s = '';
    for (let i = 0; i < final.length; i++) s += (i < shown || final[i] === ' ') ? final[i] : glyphs[(Math.random() * glyphs.length) | 0];
    el.textContent = s;
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

/* ==========================================================================
   Scroll-driven reveals, parallax, counters (GSAP)
   ========================================================================== */
function setupScrollFX() {
  if (!hasGSAP || reduced) return;

  $$('[data-split]').forEach((h) => {
    const words = splitWords(h);
    gsap.from(words, {
      yPercent: 140, rotate: 5, duration: 1.2, stagger: 0.07, ease: 'expo.out',
      scrollTrigger: { trigger: h, start: 'top 88%' },
    });
  });

  $$('[data-reveal]').forEach((el) => {
    gsap.from(el, { y: 70, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%' } });
  });

  $$('.section__num[data-parallax]').forEach((el) => {
    const f = parseFloat(el.dataset.parallax);
    gsap.fromTo(el, { y: 320 * f }, { y: -320 * f, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  $$('[data-parallax-local]').forEach((el) => {
    const f = parseFloat(el.dataset.parallaxLocal);
    gsap.fromTo(el, { y: -900 * f }, { y: 900 * f, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // hero copy drifts up and dissolves as you leave
  gsap.to('[data-hero-copy]', { yPercent: -22, opacity: 0, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.scroll-cue', { opacity: 0, ease: 'none', scrollTrigger: { trigger: '#hero', start: 'top top', end: '20% top', scrub: true } });

  // stat counters
  $$('[data-count]').forEach((el) => {
    const to = +el.dataset.count, from = el.dataset.countFrom;
    const o = { v: from ? +from : 0 };
    const render = () => { el.textContent = from ? `${from}→${Math.round(o.v)}` : Math.round(o.v); };
    render();
    gsap.to(o, { v: to, duration: 2, ease: 'power3.out', onUpdate: render, scrollTrigger: { trigger: el, start: 'top 92%' } });
  });
  gsap.from('.stat', { y: 40, opacity: 0, stagger: 0.1, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '.stats', start: 'top 90%' } });

  // timeline cards slide in from their side
  $$('.tl-item').forEach((item, i) => {
    gsap.from(item.querySelector('.tl-card'), {
      x: isMobile() ? 40 : (i % 2 ? 80 : -80), opacity: 0, duration: 1.2, ease: 'expo.out',
      scrollTrigger: { trigger: item, start: 'top 85%' },
    });
  });

  // lab + skill rows stagger
  gsap.from('.skill', { x: -40, opacity: 0, stagger: 0.08, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.skills', start: 'top 85%' } });
  gsap.from('.skill__meter', { scaleX: 0, stagger: 0.08, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.skills', start: 'top 80%' } });
}

/* ==========================================================================
   Marquee — speed + skew follow scroll velocity, direction follows scroll
   ========================================================================== */
(function marquee() {
  const track = $('#marquee');
  track.innerHTML += track.innerHTML;
  let x = 0, dir = -1, skew = 0;
  const fx = observe(track, {});
  addLoop((dt) => {
    if (!fx.visible) return;
    if (Math.abs(state.vel) > 0.5) dir = state.vel > 0 ? -1 : 1;
    const speed = (60 + Math.min(Math.abs(state.vel) * 40, 900)) * (reduced ? 0.2 : 1);
    x += dir * speed * dt;
    const half = track.scrollWidth / 2;
    if (x <= -half) x += half;
    if (x > 0) x -= half;
    skew = lerp(skew, clamp(-state.vel * 0.35, -12, 12), 0.1);
    track.style.transform = `translate3d(${x}px,0,0) skewX(${skew}deg)`;
  });
})();

/* ==========================================================================
   WebGL: liquid core + star field + orbiting stack tags
   ========================================================================== */
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const BLOB_VERT = /* glsl */`
uniform float uTime; uniform float uAmp; uniform float uFreq;
varying vec3 vNormal; varying vec3 vView; varying float vDisp;
${NOISE_GLSL}
float field(vec3 n){
  return snoise(n*uFreq+vec3(0.0,uTime*0.22,uTime*0.12))*0.72
       + snoise(n*uFreq*2.4+vec3(uTime*0.33))*0.28;
}
void main(){
  vec3 n=normalize(position);
  vec3 up=abs(n.y)>0.99?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
  vec3 t=normalize(cross(n,up));
  vec3 b=normalize(cross(n,t));
  float e=0.012;
  float f0=field(n);
  vec3 p0=n*(1.0+f0*uAmp);
  vec3 n1=normalize(n+t*e); vec3 p1=n1*(1.0+field(n1)*uAmp);
  vec3 n2=normalize(n+b*e); vec3 p2=n2*(1.0+field(n2)*uAmp);
  vec3 nn=normalize(cross(p1-p0,p2-p0));
  if(dot(nn,n)<0.0) nn=-nn;
  vDisp=f0;
  vNormal=normalize(normalMatrix*nn);
  vec4 mv=modelViewMatrix*vec4(p0,1.0);
  vView=-mv.xyz;
  gl_Position=projectionMatrix*mv;
}`;

const BLOB_FRAG = /* glsl */`
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uColC;
uniform float uTime; uniform float uDim;
varying vec3 vNormal; varying vec3 vView; varying float vDisp;
void main(){
  vec3 N=normalize(vNormal); vec3 V=normalize(vView);
  float ndv=clamp(dot(N,V),0.0,1.0);
  float fres=pow(1.0-ndv,2.4);
  vec3 L1=normalize(vec3(0.5,0.8,0.6));
  vec3 L2=normalize(vec3(-0.7,-0.4,0.3));
  float d1=max(dot(N,L1),0.0);
  float d2=max(dot(N,L2),0.0);
  float spec=pow(max(dot(N,normalize(L1+V)),0.0),70.0);
  vec3 base=mix(uColA,uColB,smoothstep(-0.7,0.9,vDisp));
  vec3 irid=0.5+0.5*cos(6.28318*(vec3(0.0,0.33,0.67)+fres*1.1+vDisp*0.7+uTime*0.03));
  vec3 col=base*(0.16+0.95*d1)+uColC*d2*0.45;
  col+=mix(uColB,irid,0.5)*fres*1.15;
  col+=vec3(spec)*0.9;
  gl_FragColor=vec4(col*uDim,1.0);
}`;

const FIELD_VERT = /* glsl */`
attribute float aSize; attribute float aSeed; attribute vec3 aColor;
uniform float uTime; uniform float uScroll; uniform float uPR; uniform float uWarp;
varying float vAlpha; varying vec3 vColor;
void main(){
  vec3 p=position;
  p.z=mod(p.z+uScroll,60.0)-50.0;
  p.x+=sin(uTime*0.15+aSeed*12.0)*0.25;
  p.y+=cos(uTime*0.12+aSeed*9.0)*0.25;
  vec4 mv=modelViewMatrix*vec4(p,1.0);
  float depth=-mv.z;
  gl_PointSize=min(aSize*uPR*(1.0+uWarp)*(11.0/max(depth,0.5)),48.0);
  float tw=0.6+0.4*sin(uTime*1.3+aSeed*50.0);
  vAlpha=tw*smoothstep(50.0,18.0,depth)*smoothstep(0.4,3.0,depth);
  vColor=aColor;
  gl_Position=projectionMatrix*mv;
}`;
const FIELD_FRAG = /* glsl */`
varying float vAlpha; varying vec3 vColor;
void main(){
  float d=length(gl_PointCoord-0.5);
  float a=smoothstep(0.5,0.0,d); a*=a;
  gl_FragColor=vec4(vColor,a*vAlpha);
}`;

let gl = null; // exposed for the vibe switcher + intro
let introPlayed = false;

async function initGL() {
  const canvas = $('#gl');
  let THREE;
  try {
    THREE = await import('three');
  } catch (e) {
    root.classList.add('no-gl');
    return null;
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    root.classList.add('no-gl');
    return null;
  }
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const PR = Math.min(devicePixelRatio || 1, 1.6);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // Measure the canvas itself: on phones innerWidth/innerHeight can disagree with
  // the fixed canvas box (address bar, overflow), which would skew every projection.
  let cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
  const camera = new THREE.PerspectiveCamera(40, cw / ch, 0.1, 100);
  const CAM_Z = 7;
  camera.position.set(0, 0, CAM_Z);

  const mobile = isMobile();

  /* --- star field --- */
  const COUNT = mobile ? 900 : 2000;
  const pos = new Float32Array(COUNT * 3), size = new Float32Array(COUNT), seed = new Float32Array(COUNT), col = new Float32Array(COUNT * 3);
  const palette = ['#e9e9ed', '#e9e9ed', '#b5abfc', '#9184d9', '#7fd1c1'].map((h) => hexToRgb(h).map((v) => v / 255));
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 2] = Math.random() * 60 - 50;
    size[i] = 0.8 + Math.random() ** 3 * 3.2;
    seed[i] = Math.random();
    const c = palette[(Math.random() * palette.length) | 0];
    col.set(c, i * 3);
  }
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fieldGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  fieldGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  fieldGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const fieldMat = new THREE.ShaderMaterial({
    vertexShader: FIELD_VERT, fragmentShader: FIELD_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uPR: { value: PR }, uWarp: { value: 0 } },
  });
  const field = new THREE.Points(fieldGeo, fieldMat);
  field.frustumCulled = false;
  scene.add(field);

  /* --- core: blob + rings + orbit dust + glow --- */
  const core = new THREE.Group();
  scene.add(core);

  const blobMat = new THREE.ShaderMaterial({
    vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG,
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: 0.26 }, uFreq: { value: 1.25 }, uDim: { value: 1 },
      uColA: { value: new THREE.Color('#2b3070') }, uColB: { value: new THREE.Color(state.accent) }, uColC: { value: new THREE.Color('#7fd1c1') },
    },
  });
  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, mobile ? 28 : 56), blobMat);
  core.add(blob);

  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(state.accent), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(4.6);
  glow.renderOrder = -1;
  core.add(glow);

  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(state.accent), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.0055, 8, 220), ringMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.004, 8, 220), ringMat.clone());
  ring2.material.opacity = 0.22;
  ring1.rotation.set(1.2, 0.3, 0);
  ring2.rotation.set(1.45, -0.5, 0.4);
  const rings = new THREE.Group();
  rings.add(ring1, ring2);
  core.add(rings);

  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, TAU); g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const DUST = 320;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    const a = Math.random() * TAU, r = 2.15 + (Math.random() - 0.5) * 0.35;
    dustPos[i * 3] = Math.cos(a) * r;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 0.12;
    dustPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dotTex, color: new THREE.Color('#b5abfc'), size: 0.035, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.rotation.set(0.35, 0, 0.25);
  core.add(dust);

  /* --- stack tags projected from a Fibonacci sphere --- */
  const stage = $('#heroStage');
  const tagEls = $$('.tag');
  const N = tagEls.length, R = 1.62, golden = Math.PI * (3 - Math.sqrt(5));
  const tagPts = tagEls.map((_, i) => {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * golden;
    return new THREE.Vector3(Math.cos(phi) * r * R, y * R, Math.sin(phi) * r * R);
  });
  let tagSizes = tagEls.map((el) => [el.offsetWidth, el.offsetHeight]);

  const quat = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);
  const spin = { vx: 0, vy: 0, dragging: false, lx: 0, ly: 0, hover: 0 };

  stage.addEventListener('pointerdown', (e) => {
    spin.dragging = true; spin.lx = e.clientX; spin.ly = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!spin.dragging) return;
    spin.vx = (e.clientX - spin.lx) * 0.006;
    spin.vy = (e.clientY - spin.ly) * 0.006;
    spin.lx = e.clientX; spin.ly = e.clientY;
  });
  const release = () => { spin.dragging = false; };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerenter', () => { spin.hover = 1; });
  stage.addEventListener('pointerleave', () => { spin.hover = 0; });

  const contactAnchor = $('[data-core-anchor]');
  const intro = { s: reduced ? 1 : 0, tags: reduced ? 1 : 0 };
  const v3 = new THREE.Vector3();
  let amp = 0.26;

  function resize() {
    cw = canvas.clientWidth || innerWidth; ch = canvas.clientHeight || innerHeight;
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    tagSizes = tagEls.map((el) => [el.offsetWidth, el.offsetHeight]);
  }
  addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();

  const heroVis = observe(stage, {});

  function place() {
    // Anchor the core to a DOM box so it scrolls in lockstep with the page.
    const h = ch, w = cw;
    const useContact = contactAnchor && contactAnchor.getBoundingClientRect().top < h * 1.3;
    const el = useContact ? contactAnchor : stage;
    const r = el.getBoundingClientRect();
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * CAM_Z;
    const halfW = halfH * camera.aspect;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    core.position.set(((cx / w) * 2 - 1) * halfW, -((cy / h) * 2 - 1) * halfH, 0);
    const worldH = (Math.min(r.height, r.width * 1.1) / h) * 2 * halfH;
    const k = useContact ? 0.34 : (isMobile() ? 0.27 : 0.3);
    core.scale.setScalar(Math.max(0.0001, worldH * k * intro.s));
    blobMat.uniforms.uDim.value = lerp(blobMat.uniforms.uDim.value, useContact ? 0.62 : 1, 0.08);
    core.visible = r.bottom > -r.height * 0.6 && r.top < h + r.height * 0.6;
    return useContact;
  }

  function updateTags(useContact) {
    const show = heroVis.visible && !useContact;
    if (!show) { if (!updateTags.hidden) { tagEls.forEach((el) => { el.style.opacity = 0; }); updateTags.hidden = true; } return; }
    updateTags.hidden = false;
    const sr = stage.getBoundingClientRect();
    const s = core.scale.x;
    const fade = clamp((sr.bottom - 80) / (sr.height * 0.6), 0, 1); // dissolve with the hero copy
    for (let i = 0; i < N; i++) {
      v3.copy(tagPts[i]).applyQuaternion(quat);
      const depth = v3.z / R; // -1 back … 1 front
      v3.multiplyScalar(s).add(core.position).project(camera);
      const x = (v3.x + 1) / 2 * cw - sr.left;
      const y = (1 - v3.y) / 2 * ch - sr.top;
      const t = (depth + 1) / 2;
      const sc = 0.72 + t * 0.4;
      const el = tagEls[i];
      el.style.transform = `translate3d(${x - tagSizes[i][0] / 2}px, ${y - tagSizes[i][1] / 2}px, 0) scale(${sc})`;
      el.style.opacity = ((0.12 + t * t * 0.88) * intro.tags * fade).toFixed(3);
      el.style.zIndex = Math.round(t * 100);
    }
  }

  addLoop((dt, time) => {
    // spin: drag velocity with inertia + a slow auto-orbit
    if (!spin.dragging) { spin.vx *= 0.95; spin.vy *= 0.95; }
    const auto = reduced ? 0.0008 : 0.0038;
    qTmp.setFromAxisAngle(AX_Y, spin.vx + auto); quat.premultiply(qTmp);
    qTmp.setFromAxisAngle(AX_X, spin.vy); quat.premultiply(qTmp);
    blob.quaternion.copy(quat);
    rings.rotation.y += dt * 0.25;
    rings.rotation.z = Math.sin(time * 0.3) * 0.15;
    dust.rotation.y -= dt * 0.18;

    // the core breathes harder when you scroll fast or hover it
    const targetAmp = 0.24 + spin.hover * 0.1 + Math.min(Math.abs(state.vel) * 0.012, 0.22) + (spin.dragging ? 0.08 : 0);
    amp = lerp(amp, targetAmp, 0.06);
    blobMat.uniforms.uAmp.value = amp;
    blobMat.uniforms.uTime.value = time;

    fieldMat.uniforms.uTime.value = time;
    fieldMat.uniforms.uScroll.value = state.scrollY * 0.012 + time * (reduced ? 0.05 : 0.35);
    fieldMat.uniforms.uWarp.value = lerp(fieldMat.uniforms.uWarp.value, Math.min(Math.abs(state.vel) * 0.03, 1.4), 0.1);

    camera.position.x = lerp(camera.position.x, state.nx * 0.35, 0.04);
    camera.position.y = lerp(camera.position.y, -state.ny * 0.25, 0.04);
    camera.lookAt(0, 0, 0);

    const useContact = place();
    renderer.render(scene, camera);
    updateTags(useContact);
  });

  gl = {
    intro,
    setAccent(hex) {
      blobMat.uniforms.uColB.value.set(hex);
      glow.material.color.set(hex);
      ringMat.color.set(hex);
      ring2.material.color.set(hex);
    },
  };
  // compile shaders now so the first real frame doesn't hitch
  renderer.compile(scene, camera);
  // WebGL arrived after the intro already ran: grow the core in on its own
  if (introPlayed) {
    if (hasGSAP && !reduced) gsap.to(intro, { s: 1, tags: 1, duration: 1.8, ease: 'elastic.out(1, 0.55)' });
    else { intro.s = 1; intro.tags = 1; }
  }
  return gl;
}

/* ==========================================================================
   Work: horizontal pin, chat mock, exploded builder, generative painting
   ========================================================================== */
function setupWorkPin() {
  if (!hasGSAP || reduced) return;
  const mm = gsap.matchMedia();
  mm.add('(min-width: 901px)', () => {
    const track = $('#workTrack');
    const dist = () => track.scrollWidth - innerWidth;
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: '#workPin',
        start: () => `top ${Math.max(80, (innerHeight - track.offsetHeight) / 2)}px`,
        end: () => `+=${dist()}`,
        pin: true, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
      },
    });
    // each card's index numeral drifts against the scroll
    $$('.project__index', track).forEach((el) => {
      gsap.fromTo(el, { xPercent: 40 }, { xPercent: -40, ease: 'none', scrollTrigger: { trigger: el.parentElement, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
    });
  });
}

(function chat() {
  const log = $('#chatLog'), typing = $('#typing');
  const people = { Priya: '#7fd1c1', Rahul: '#e0a45e', Meera: '#d97f9a', Aniruddha: '#9184d9' };
  const script = [
    ['Priya', 'pushed the presence fix 🚀'],
    ['Rahul', 'typing indicators feel instant now'],
    ['Aniruddha', "zero polling. it's all sockets."],
    ['Meera', 'can we ship it before standup?'],
    ['Aniruddha', 'already did 😌'],
    ['Priya', 'reconnect + backoff works on flaky wifi too'],
  ];
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  let i = 0, timer = null;
  const fx = observe(log, {});
  const step = () => {
    if (!fx.visible) { timer = setTimeout(step, 600); return; }
    const [who, text] = script[i % script.length];
    typing.innerHTML = `<i></i><i></i><i></i> ${who} is typing…`;
    timer = setTimeout(() => {
      typing.textContent = '';
      const m = document.createElement('div');
      m.className = 'msg';
      m.innerHTML = `<div class="msg__av" style="background:${people[who]}">${who[0]}</div><div><b>${who}</b><time>${fmt.format(new Date())}</time><p></p></div>`;
      m.querySelector('p').textContent = text;
      log.appendChild(m);
      while (log.children.length > 4) log.firstElementChild.remove();
      i++;
      timer = setTimeout(step, 1300);
    }, 1100);
  };
  step();
})();

(function builder() {
  const el = $('#builder');
  const layers = $$('.builder__layer', el);
  const stack = $('.builder__stack', el);
  let exploded = false;
  const apply = () => {
    layers.forEach((l, i) => { l.style.transform = `translateZ(${exploded ? i * 52 : i * 7}px)`; });
    el.classList.toggle('is-exploded', exploded);
    stack.style.transform = exploded ? 'rotateX(58deg) rotateZ(-34deg) translateZ(-40px)' : 'rotateX(52deg) rotateZ(-42deg)';
  };
  apply();
  const fx = observe(el, {});
  setInterval(() => { if (fx.visible || exploded) { exploded = !exploded; apply(); } }, 2600);
  el.parentElement.addEventListener('pointerenter', () => { exploded = true; apply(); });
})();

(function attributionDash() {
  const canvas = $('canvas[data-fx="dash"]');
  if (!canvas) return;
  const box = canvas.closest('.dash');
  const fx = observe(box, {});
  const N = 8, months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const spend = Array.from({ length: N }, (_, i) => 32 + i * 5 + Math.random() * 8);
  const leads = spend.map((v) => v * 0.85 + 6 + Math.random() * 10);
  const shown = { s: spend.map(() => 0), l: leads.map(() => 0) };
  const kpiEls = Object.fromEntries($$('[data-kpi]', box).map((el) => [el.dataset.kpi, el]));
  const funnelBars = $$('.funnel__row i', box), funnelNums = $$('.funnel__row b', box);
  const kpi = { spend: 0, leads: 0, deals: 0, roas: 0 };
  const target = { ...kpi };
  let rates = [1, 0.66, 0.36, 0.17];
  const retarget = () => {
    target.spend = spend.reduce((a, b) => a + b, 0) * 0.13;
    target.leads = leads.reduce((a, b) => a + b, 0) * 2.4;
    target.deals = target.leads * rates[3];
    target.roas = 3.2 + (rates[3] - 0.14) * 18;
    rates.forEach((r, i) => { funnelBars[i].style.setProperty('--w', `${r * 100}%`); funnelNums[i].textContent = Math.round(target.leads * r).toLocaleString('en-US'); });
  };
  retarget();
  let ctx, W, H, t = 0, next = 2.5, grow = 0;
  new ResizeObserver(() => { ({ ctx, w: W, h: H } = fitCanvas(canvas)); }).observe(canvas);
  const ease = (x) => 1 - (1 - x) ** 3;
  addLoop((dt) => {
    if (!fx.visible || !ctx) return;
    t += dt; grow = Math.min(1, grow + dt * 0.7);
    if (t > next) { // new data lands: nudge a couple of months and the funnel
      next = t + 2.4;
      for (let k = 0; k < 2; k++) { const i = (Math.random() * N) | 0; spend[i] = clamp(spend[i] + (Math.random() - 0.45) * 14, 20, 90); leads[i] = clamp(spend[i] * (0.75 + Math.random() * 0.35) + 4, 16, 98); }
      rates = [1, 0.6 + Math.random() * 0.12, 0.3 + Math.random() * 0.1, 0.14 + Math.random() * 0.06];
      retarget();
    }
    for (const k in kpi) kpi[k] = lerp(kpi[k], target[k] * ease(grow), 0.08);
    kpiEls.spend.textContent = `${kpi.spend.toFixed(1)}K`;
    kpiEls.leads.textContent = Math.round(kpi.leads).toLocaleString('en-US');
    kpiEls.deals.textContent = Math.round(kpi.deals).toLocaleString('en-US');
    kpiEls.roas.textContent = `${kpi.roas.toFixed(1)}×`;

    const padL = 10, padR = 10, padT = 14, padB = 20, cw = W - padL - padR, chh = H - padT - padB, step = cw / N;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(233,233,237,0.06)'; ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) { const y = padT + (chh * g) / 4; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); }
    const pts = [];
    for (let i = 0; i < N; i++) {
      shown.s[i] = lerp(shown.s[i], spend[i] * ease(grow), 0.08);
      shown.l[i] = lerp(shown.l[i], leads[i] * ease(grow), 0.08);
      const bw = step * 0.46, x = padL + step * i + (step - bw) / 2, bh = (shown.s[i] / 100) * chh;
      ctx.fillStyle = rgba(state.accent, 0.55);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, padT + chh - bh, bw, bh, [4, 4, 0, 0]) : ctx.rect(x, padT + chh - bh, bw, bh); ctx.fill();
      pts.push([padL + step * i + step / 2, padT + chh - (shown.l[i] / 100) * chh]);
      ctx.fillStyle = 'rgba(147,151,171,0.8)'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(months[i], padL + step * i + step / 2, H - 6);
    }
    const area = ctx.createLinearGradient(0, padT, 0, padT + chh);
    area.addColorStop(0, 'rgba(127,209,193,0.35)'); area.addColorStop(1, 'rgba(127,209,193,0)');
    ctx.beginPath(); ctx.moveTo(pts[0][0], padT + chh);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[N - 1][0], padT + chh); ctx.closePath(); ctx.fillStyle = area; ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = '#7fd1c1'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#e9e9ed';
    pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill(); });
  });
})();

(function microFrontends() {
  const el = $('#mfe');
  if (!el) return;
  const badges = $$('.mfe__mod em', el);
  const fx = observe(el, {});
  let split = false;
  setInterval(() => { if (fx.visible || split) { split = !split; el.classList.toggle('is-split', split); } }, 2800);
  // each module ships on its own clock — that's the point of micro-frontends
  setInterval(() => {
    if (!fx.visible) return;
    const b = badges[(Math.random() * badges.length) | 0];
    if (b.classList.contains('is-deploying')) return;
    const [maj, min, patch] = b.textContent.replace(/[^\d.]/g, '').split('.').map(Number);
    b.classList.add('is-deploying'); b.textContent = 'deploying…';
    setTimeout(() => { b.classList.remove('is-deploying'); b.textContent = `v${maj}.${min}.${patch + 1} ✓`; }, 1400);
  }, 1700);
})();

(function paint() {
  const canvas = $('canvas[data-fx="paint"]');
  const fx = observe(canvas, {});
  let ctx, W, H, parts = [], age = 0;
  const cols = ['#9184d9', '#b5abfc', '#7fd1c1', '#e0a45e', '#d97f9a', '#f3f5fe'];
  let seedZ = Math.random() * 100;
  const reset = () => {
    ({ ctx, w: W, h: H } = fitCanvas(canvas));
    ctx.fillStyle = '#0f1019'; ctx.fillRect(0, 0, W, H);
    parts = Array.from({ length: 420 }, () => ({ x: Math.random() * W, y: Math.random() * H, c: cols[(Math.random() * cols.length) | 0], w: 0.6 + Math.random() * 2.4 }));
    age = 0; seedZ += 3.7;
  };
  new ResizeObserver(reset).observe(canvas);
  addLoop((dt) => {
    if (!fx.visible || !ctx) return;
    age += dt;
    if (age > 16) reset();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(15,16,25,0.012)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.14;
    for (const p of parts) {
      const a = noise3(p.x * 0.0035, p.y * 0.0035, seedZ + age * 0.03) * TAU * 1.6;
      const nx = p.x + Math.cos(a) * 1.6, ny = p.y + Math.sin(a) * 1.6;
      ctx.strokeStyle = p.c; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny;
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; }
    }
    ctx.globalAlpha = 1;
  });
})();

/* ==========================================================================
   Case study: gauges + before/after compare
   ========================================================================== */
(function gauges() {
  const C = 2 * Math.PI * 42;
  const color = (v) => (v < 50 ? '#e5484d' : v < 90 ? '#e0a45e' : '#2fb67c');
  $$('[data-gauge]').forEach((g) => {
    const bar = g.querySelector('.bar'), num = g.querySelector('.gauge__num');
    const from = +g.dataset.from, to = +g.dataset.to;
    bar.style.strokeDasharray = C;
    const render = (v) => {
      bar.style.strokeDashoffset = C * (1 - v / 100);
      bar.style.stroke = color(v);
      bar.style.filter = `drop-shadow(0 0 8px ${color(v)}99)`;
      num.textContent = Math.round(v);
    };
    if (!hasGSAP || reduced) { render(to); return; }
    const o = { v: from };
    render(from);
    gsap.to(o, { v: to, duration: 2.2, ease: 'power2.inOut', onUpdate: () => render(o.v), scrollTrigger: { trigger: g, start: 'top 85%' } });
  });
})();

(function compare() {
  const box = $('#compare'), handle = box.querySelector('.compare__handle button');
  let dragging = false;
  const set = (pct) => {
    pct = clamp(pct, 2, 98);
    box.style.setProperty('--split', pct + '%');
    handle.setAttribute('aria-valuenow', Math.round(pct));
  };
  const fromEvent = (e) => { const r = box.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
  box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
  box.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  box.addEventListener('pointerup', () => { dragging = false; });
  box.addEventListener('pointercancel', () => { dragging = false; });
  handle.addEventListener('keydown', (e) => {
    const cur = parseFloat(box.style.getPropertyValue('--split')) || 50;
    if (e.key === 'ArrowLeft') { set(cur - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { set(cur + 5); e.preventDefault(); }
  });
  set(50);
  if (!hasGSAP || reduced) return;
  gsap.fromTo(box, { rotationX: 32, scale: 0.88, y: 80, transformPerspective: 1600 },
    { rotationX: 0, scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: '.compare-stage', start: 'top 95%', end: 'top 25%', scrub: true } });
  const demo = { p: 50 };
  gsap.timeline({ scrollTrigger: { trigger: box, start: 'top 60%' } })
    .to(demo, { p: 18, duration: 0.9, ease: 'power2.inOut', onUpdate: () => !dragging && set(demo.p) })
    .to(demo, { p: 82, duration: 1.2, ease: 'power2.inOut', onUpdate: () => !dragging && set(demo.p) })
    .to(demo, { p: 50, duration: 0.8, ease: 'power2.inOut', onUpdate: () => !dragging && set(demo.p) });
})();

/* ==========================================================================
   Stack: chips flee the cursor (spring physics)
   ========================================================================== */
(function magnetField() {
  const field = $('#magnetField');
  const chips = $$('.chip', field).map((el) => ({ el, hx: 0, hy: 0, x: 0, y: 0, vx: 0, vy: 0 }));
  const measure = () => chips.forEach((c) => { c.hx = c.el.offsetLeft + c.el.offsetWidth / 2; c.hy = c.el.offsetTop + c.el.offsetHeight / 2; });
  new ResizeObserver(measure).observe(field);
  measure();
  let mx = -9999, my = -9999;
  field.addEventListener('pointermove', (e) => { const r = field.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  field.addEventListener('pointerleave', () => { mx = my = -9999; });
  const fx = observe(field, {});
  addLoop(() => {
    if (!fx.visible) return;
    const Rr = 150;
    for (const c of chips) {
      const dx = c.hx + c.x - mx, dy = c.hy + c.y - my;
      const d = Math.hypot(dx, dy) || 1;
      let tx = 0, ty = 0;
      if (d < Rr) { const f = (1 - d / Rr) ** 2 * 90; tx = (dx / d) * f; ty = (dy / d) * f; }
      c.vx = (c.vx + (tx - c.x) * 0.12) * 0.74;
      c.vy = (c.vy + (ty - c.y) * 0.12) * 0.74;
      c.x += c.vx; c.y += c.vy;
      c.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) rotate(${(c.vx * 1.5).toFixed(2)}deg)`;
    }
  });
})();

/* ==========================================================================
   Path: scroll-scrubbed timeline
   ========================================================================== */
(function timeline() {
  const tl = $('#timeline'), fill = $('#tlFill'), head = $('#tlHead'), items = $$('.tl-item', tl);
  const update = (p) => {
    const h = tl.offsetHeight;
    fill.style.transform = `scaleY(${p})`;
    head.style.transform = `translateY(${p * h}px)`;
    items.forEach((it) => it.classList.toggle('is-lit', it.offsetTop + 10 <= p * h));
  };
  if (!hasGSAP || reduced) { update(1); return; }
  update(0);
  ScrollTrigger.create({ trigger: tl, start: 'top 65%', end: 'bottom 65%', scrub: 0.6, onUpdate: (s) => update(s.progress) });
})();

/* ==========================================================================
   About: particle monogram
   ========================================================================== */
async function monogram() {
  const canvas = $('#monogram');
  const fx = observe(canvas, {});
  try { await Promise.race([document.fonts.load('600 200px Inter'), new Promise((r) => setTimeout(r, 1500))]); } catch { /* fallback font is fine */ }
  let ctx, W, H, parts = [], burst = 0;
  const cols = ['#b5abfc', '#9184d9', '#7fd1c1', '#e9e9ed'];
  const build = () => {
    ({ ctx, w: W, h: H } = fitCanvas(canvas));
    const iw = Math.max(1, Math.floor(W)), ih = Math.max(1, Math.floor(H));
    const off = document.createElement('canvas'); off.width = iw; off.height = ih;
    const o = off.getContext('2d', { willReadFrequently: true });
    o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'middle';
    o.font = `600 ${Math.min(W * 0.46, H * 0.5)}px Inter, system-ui, sans-serif`;
    o.fillText('AW', W / 2, H * 0.47);
    const data = o.getImageData(0, 0, iw, ih).data;
    let gap = 4, pts;
    do {
      pts = [];
      for (let y = 0; y < ih; y += gap) for (let x = 0; x < iw; x += gap) if (data[(y * iw + x) * 4 + 3] > 128) pts.push([x, y]);
      gap++;
    } while (pts.length > 3200);
    const old = parts;
    parts = pts.map(([tx, ty], i) => {
      const prev = old[i];
      return {
        tx, ty,
        x: prev ? prev.x : Math.random() * W, y: prev ? prev.y : Math.random() * H,
        vx: 0, vy: 0, c: (tx / W + (Math.random() - 0.5) * 0.3) * 3 | 0, s: Math.random() < 0.08 ? 2.4 : 1.6,
      };
    });
  };
  new ResizeObserver(build).observe(canvas);
  build();
  let mx = -9999, my = -9999;
  canvas.parentElement.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  canvas.parentElement.addEventListener('pointerleave', () => { mx = my = -9999; });
  canvas.parentElement.addEventListener('click', () => { burst = 1; });
  addLoop((dt, time) => {
    if (!fx.visible) return;
    ctx.clearRect(0, 0, W, H);
    const buckets = [[], [], [], []];
    for (const p of parts) {
      const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
      if (d2 < 9000) { const d = Math.sqrt(d2) || 1, f = (1 - d / 95) * 6; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      if (burst > 0.99) { const bx = p.x - W / 2, by = p.y - H / 2, bd = Math.hypot(bx, by) || 1; p.vx += (bx / bd) * (8 + Math.random() * 14); p.vy += (by / bd) * (8 + Math.random() * 14); }
      p.vx += (p.tx - p.x) * 0.018; p.vy += (p.ty - p.y) * 0.018;
      p.vx *= 0.86; p.vy *= 0.86;
      p.x += p.vx; p.y += p.vy + Math.sin(time * 2 + p.tx * 0.05) * 0.06;
      buckets[clamp(p.c, 0, 3)].push(p);
    }
    burst = burst > 0.99 ? 0.98 : 0;
    buckets.forEach((b, i) => { ctx.fillStyle = cols[i]; for (const p of b) ctx.fillRect(p.x, p.y, p.s, p.s); });
  });
}

/* ==========================================================================
   Lab canvases
   ========================================================================== */
function labConstellation() {
  const canvas = $('canvas[data-fx="constellation"]');
  const fx = observe(canvas, {});
  let ctx, W, H, nodes = [];
  const reset = () => {
    ({ ctx, w: W, h: H } = fitCanvas(canvas));
    nodes = Array.from({ length: Math.round((W * H) / 3200) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 }));
  };
  new ResizeObserver(reset).observe(canvas);
  let mx = -9999, my = -9999;
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  canvas.addEventListener('pointerleave', () => { mx = my = -9999; });
  addLoop(() => {
    if (!fx.visible || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const n of nodes) {
      const dx = mx - n.x, dy = my - n.y, d = Math.hypot(dx, dy);
      if (d < 160) { n.vx += (dx / d) * 0.03; n.vy += (dy / d) * 0.03; }
      n.vx *= 0.99; n.vy *= 0.99;
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 90) { ctx.strokeStyle = rgba(state.accent, (1 - d / 90) * 0.55); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      const dm = Math.hypot(a.x - mx, a.y - my);
      if (dm < 160) { ctx.strokeStyle = `rgba(127,209,193,${(1 - dm / 160) * 0.8})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke(); }
      ctx.fillStyle = '#e9e9ed'; ctx.fillRect(a.x - 1, a.y - 1, 2, 2);
    }
  });
}

function labTerrain() {
  const canvas = $('canvas[data-fx="terrain"]');
  const fx = observe(canvas, {});
  let ctx, W, H;
  new ResizeObserver(() => { ({ ctx, w: W, h: H } = fitCanvas(canvas)); }).observe(canvas);
  let mx = 0, camX = 0;
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mx = ((e.clientX - r.left) / r.width) * 2 - 1; });
  const COLS = 34, ROWS = 26, SP = 1;
  addLoop((dt, time) => {
    if (!fx.visible || !ctx) return;
    camX = lerp(camX, mx * 6, 0.05);
    const horizon = H * 0.42, f = W * 0.9, camH = 2.6, travel = time * 3;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0c16'); bg.addColorStop(0.42, '#261a45'); bg.addColorStop(1, '#0b0c16');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // sun
    const sr = W * 0.16, sx = W / 2 - camX * 6, sy = horizon - sr * 0.35;
    const sg = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
    sg.addColorStop(0, '#e0a45e'); sg.addColorStop(1, '#d97f9a');
    ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.clip();
    ctx.fillStyle = sg; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    ctx.fillStyle = '#261a45';
    for (let k = 0; k < 6; k++) { const yy = sy + k * sr * 0.18; ctx.fillRect(sx - sr, yy, sr * 2, 2 + k * 1.3); }
    ctx.restore();
    // terrain grid
    const zOff = travel % SP;
    const proj = (gx, gz) => {
      const wx = (gx - COLS / 2) * SP - camX;
      const wz = gz * SP - zOff + 1.2;
      const h = noise3(gx * 0.18, (gz + Math.floor(travel / SP)) * 0.18, 0.5);
      const edge = Math.min(1, Math.abs(gx - COLS / 2) / (COLS * 0.18));
      const wy = Math.max(0, h + 0.15) * 4.5 * edge * edge;
      return [W / 2 + (wx * f) / (wz * 6), horizon + ((camH - wy) * f) / (wz * 6), wz];
    };
    const grid = [];
    for (let z = ROWS; z >= 0; z--) { const row = []; for (let x = 0; x <= COLS; x++) row.push(proj(x, z)); grid.push(row); }
    ctx.lineWidth = 1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r], a = clamp(1 - row[0][2] / (ROWS * 0.9), 0, 1);
      // fill under this row so nearer hills hide the lines behind them
      ctx.fillStyle = '#0d0c1a';
      ctx.beginPath(); row.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(row[row.length - 1][0], H + 400); ctx.lineTo(row[0][0], H + 400); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(217,127,154,${a * 0.9})`;
      ctx.beginPath(); row.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      if (r > 0) {
        ctx.strokeStyle = rgba(state.accent, a * 0.7);
        ctx.beginPath();
        for (let x = 0; x <= COLS; x++) { ctx.moveTo(grid[r - 1][x][0], grid[r - 1][x][1]); ctx.lineTo(row[x][0], row[x][1]); }
        ctx.stroke();
      }
    }
  });
}

function labInk() {
  const canvas = $('canvas[data-fx="ink"]');
  const fx = observe(canvas, {});
  let ctx, W, H;
  const resize = () => { ({ ctx, w: W, h: H } = fitCanvas(canvas)); ctx.fillStyle = '#0f1019'; ctx.fillRect(0, 0, W, H); };
  new ResizeObserver(resize).observe(canvas);
  const parts = [];
  let px = null, py = null, down = false, idle = 0;
  const cols = ['#9184d9', '#7fd1c1', '#d97f9a', '#e0a45e'];
  const emit = (x, y, vx, vy) => {
    for (let k = 0; k < 4; k++) parts.push({ x, y, vx: vx * 0.3 + (Math.random() - 0.5), vy: vy * 0.3 + (Math.random() - 0.5), life: 1, c: cols[(Math.random() * cols.length) | 0] });
    if (parts.length > 1400) parts.splice(0, parts.length - 1400);
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => { down = true; [px, py] = local(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { down = false; });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if ((down || finePointer) && px !== null) { emit(x, y, x - px, y - py); idle = 0; }
    px = x; py = y;
  });
  canvas.style.touchAction = 'none';
  const curl = (x, y, t) => {
    const e = 0.01, s = 0.006;
    const n1 = noise3(x * s, (y + e) * s, t), n2 = noise3(x * s, (y - e) * s, t);
    const n3 = noise3((x + e) * s, y * s, t), n4 = noise3((x - e) * s, y * s, t);
    return [(n1 - n2) / (2 * e), -(n3 - n4) / (2 * e)];
  };
  addLoop((dt, time) => {
    if (!fx.visible || !ctx) return;
    idle += dt;
    if (idle > 1.5) { // ghost pen draws a lissajous when nobody's playing
      const gx = W / 2 + Math.sin(time * 1.3) * W * 0.32, gy = H / 2 + Math.sin(time * 1.9 + 1) * H * 0.3;
      emit(gx, gy, Math.cos(time * 1.3) * 4, Math.cos(time * 1.9 + 1) * 4);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(15,16,25,0.09)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const [cx, cy] = curl(p.x, p.y, time * 0.2);
      p.vx = p.vx * 0.94 + cx * 0.9; p.vy = p.vy * 0.94 + cy * 0.9;
      p.x += p.vx; p.y += p.vy; p.life -= dt * 0.45;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * 0.8; ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  });
}

/* ==========================================================================
   Contact: proximity letters + mailto form
   ========================================================================== */
function contactFX() {
  const title = $('#contactTitle');
  const chars = splitChars(title);
  if (hasGSAP && !reduced) {
    gsap.from(chars, { yPercent: 110, opacity: 0, rotate: 8, stagger: 0.025, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: title, start: 'top 85%' } });
  }
  if (!finePointer || reduced) return;
  const fx = observe(title, {});
  const cur = chars.map(() => 0);
  addLoop(() => {
    if (!fx.visible) return;
    for (let i = 0; i < chars.length; i++) {
      const r = chars[i].getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - state.px, r.top + r.height / 2 - state.py);
      const t = Math.max(0, 1 - d / 220);
      cur[i] = lerp(cur[i], t, 0.15);
      chars[i].style.transform = `translate3d(0, ${(-cur[i] * 26).toFixed(2)}px, 0) rotate(${(cur[i] * -6).toFixed(2)}deg)`;
      chars[i].style.color = cur[i] > 0.35 ? 'var(--accent)' : '';
    }
  });
}

(function form() {
  const f = $('#contactForm');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const els = f.elements;
    const name = els.namedItem('name').value.trim(), email = els.namedItem('email').value.trim(), msg = els.namedItem('message').value.trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !msg) {
      toast('Add your name, a valid email, and a note');
      if (hasGSAP) gsap.fromTo(f, { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    const subject = encodeURIComponent(`Hello from ${name}`);
    const body = encodeURIComponent(`${msg}\n\n— ${name} (${email})`);
    location.href = `mailto:aniruddhapw@gmail.com?subject=${subject}&body=${body}`;
    toast('Opening your mail app…');
  });
})();

/* ==========================================================================
   Accent "vibe" switcher — CSS, canvases and the WebGL core all follow
   ========================================================================== */
function setVibe(hex, persist = true) {
  state.accent = hex;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${hex} 62%, #ffffff)`);
  $$('.vibes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vibe === hex)));
  if (gl) gl.setAccent(hex);
  if (persist) { try { localStorage.setItem('vibe', hex); } catch { /* storage blocked */ } }
}
$$('.vibes button').forEach((b) => b.addEventListener('click', () => { setVibe(b.dataset.vibe); toast('Vibe switched ✦'); }));
try { const saved = localStorage.getItem('vibe'); if (saved && /^#[0-9a-f]{6}$/i.test(saved)) setVibe(saved, false); } catch { /* storage blocked */ }

/* ==========================================================================
   Boot: preloader → intro
   ========================================================================== */
function heroIntroSetup() {
  if (!hasGSAP || reduced) return null;
  const lines = $$('.hero__title .split-line > span');
  const intros = $$('[data-intro]');
  gsap.set(lines, { yPercent: 140 });
  gsap.set(intros, { y: 30, opacity: 0 });
  gsap.set('.hero__drag, .scroll-cue', { opacity: 0 });
  return () => {
    introPlayed = true;
    const tl = gsap.timeline();
    tl.to(lines, { yPercent: 0, duration: 1.4, stagger: 0.12, ease: 'expo.out' }, 0)
      .add(() => { const s = $('[data-scramble]'); scramble(s, s.textContent, 900); }, 0.1)
      .to(intros, { y: 0, opacity: 1, duration: 1.1, stagger: 0.08, ease: 'expo.out' }, 0.35)
      .to('.hero__drag, .scroll-cue', { opacity: 1, duration: 1 }, 1);
    if (gl) {
      tl.to(gl.intro, { s: 1, duration: 2.2, ease: 'elastic.out(1, 0.55)' }, 0.1)
        .to(gl.intro, { tags: 1, duration: 1.4, ease: 'power2.out' }, 0.7);
    }
    return tl;
  };
}

async function boot() {
  const loader = $('#loader'), num = $('#loadNum'), bar = $('#loadBar');
  const playIntro = heroIntroSetup();
  const minTime = reduced ? 0 : 1500;
  const t0 = performance.now();
  let shown = 0, done = false;
  const counter = () => {
    const p = Math.min((performance.now() - t0) / minTime, done ? 1 : 0.92);
    shown = lerp(shown, p, 0.18);
    num.textContent = Math.round(shown * 100);
    bar.style.transform = `scaleX(${shown})`;
    if (!(done && shown > 0.995)) requestAnimationFrame(counter);
  };
  if (!reduced) counter();

  const glReady = initGL().catch((e) => { console.error(e); root.classList.add('no-gl'); return null; });
  await Promise.race([
    Promise.all([glReady, document.fonts ? document.fonts.ready : null, new Promise((r) => setTimeout(r, minTime))]),
    new Promise((r) => setTimeout(r, 3200)),
  ]);
  done = true;

  setupScrollFX();
  setupWorkPin();
  labConstellation();
  labTerrain();
  labInk();
  monogram();
  contactFX();

  const finish = () => {
    root.classList.add('loaded');
    document.body.classList.remove('is-loading');
    if (lenis) lenis.start();
    if (hasGSAP) ScrollTrigger.refresh();
  };

  if (!hasGSAP || reduced) {
    introPlayed = true;
    if (gl) { gl.intro.s = 1; gl.intro.tags = 1; }
    finish();
    return;
  }
  num.textContent = '100';
  bar.style.transform = 'scaleX(1)';
  gsap.timeline()
    .to('.loader__inner', { y: -40, opacity: 0, duration: 0.6, ease: 'power3.in', delay: 0.15 })
    .to(loader, { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: 'expo.inOut' }, '-=0.2')
    .add(() => playIntro && playIntro(), '-=0.55')
    .add(finish);
}

boot();
addEventListener('load', () => hasGSAP && ScrollTrigger.refresh());
