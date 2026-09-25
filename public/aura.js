// The "aura": a GPU-rendered orb that breathes with the examiner's voice and
// the candidate's mic, and changes colour with the conversation state.
// Plain WebGL1, no dependencies. Falls back to a CSS gradient if WebGL is off.

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uSpeak;   // examiner audio level 0..1
uniform float uMic;     // candidate mic level 0..1
uniform float uThink;   // 0..1 shimmer while the examiner is thinking
uniform vec3 uA;        // core colour
uniform vec3 uB;        // edge colour

// 2D simplex-ish value noise
vec2 hash(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float noise(vec2 p){
  const float K1 = 0.366025404; const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x+p.y)*K1);
  vec2 a = p - i + (i.x+i.y)*K2;
  vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0*K2;
  vec3 h = max(0.5-vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  vec3 n = h*h*h*h*vec3(dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
  return dot(n, vec3(70.0));
}
float fbm(vec2 p){ float f = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ f += a*noise(p); p *= 2.02; a *= 0.5; } return f; }

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float t = uTime * (0.35 + uSpeak*0.9 + uThink*0.4);
  float energy = clamp(uSpeak*1.2 + uMic*0.8, 0.0, 1.0);

  // Wobbling edge: low-frequency noise around the circle, stronger when loud.
  vec2 dir = vec2(cos(ang), sin(ang));
  // Smooth, low-frequency edge: two octaves of noise, no high-frequency lumps.
  float wob = (noise(dir*0.9 + vec2(t*0.5, -t*0.35)) * 0.7 + noise(dir*1.8 - vec2(t*0.3)) * 0.3) * (0.018 + energy*0.06);
  float radius = 0.28 + energy*0.03 + wob;

  // Interior: slow, silky swirl.
  vec2 q = uv*1.4;
  float swirl = noise(q + vec2(noise(q*0.8 + t*0.25), noise(q*0.8 - t*0.2)) + t*0.12) * 0.8;
  vec3 core = mix(uA, uB, smoothstep(-0.4, 0.6, swirl + uv.y*0.8));
  core += 0.22*vec3(1.0)*smoothstep(0.2, 0.0, length(uv - vec2(-0.09, 0.11))) * (0.5 + energy*0.5);
  core *= 0.85 + 0.25*smoothstep(radius, 0.0, r);

  float body = smoothstep(radius + 0.006, radius - 0.006, r);
  float glow = exp(-max(r - radius, 0.0)*(10.0 - energy*4.0)) * (0.45 + energy*0.5);
  float rim = smoothstep(0.03, 0.0, abs(r - radius)) * (0.25 + energy*0.5);

  // Thinking: a thin rotating arc just outside the orb.
  float arc = uThink * smoothstep(0.012, 0.0, abs(r - radius - 0.06)) * smoothstep(0.6, 1.0, 0.5 + 0.5*sin(ang*1.0 - uTime*3.0));

  vec3 col = core*body + uB*glow*(1.0-body) + vec3(1.0)*rim*0.35 + uB*arc;
  float alpha = clamp(body + glow*(1.0-body) + arc, 0.0, 1.0);
  gl_FragColor = vec4(col*alpha, alpha);
}`

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)

export const PALETTES = {
  idle: ['#6d5cff', '#2a1f7a'],
  connecting: ['#6d5cff', '#2a1f7a'],
  speaking: ['#9d8cff', '#5b3df5'],
  listening: ['#4de8b0', '#0f8f6a'],
  thinking: ['#ffc56b', '#d9731f'],
  error: ['#ff7a6e', '#9b2c24'],
}

export function createAura(canvas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true })
  const state = { speak: 0, mic: 0, think: 0, a: hex(PALETTES.idle[0]), b: hex(PALETTES.idle[1]), ta: hex(PALETTES.idle[0]), tb: hex(PALETTES.idle[1]), thinkTarget: 0 }
  const api = {
    setLevels(speak, mic) { state.ts = speak; state.tm = mic },
    setState(name) {
      const p = PALETTES[name] || PALETTES.idle
      state.ta = hex(p[0]); state.tb = hex(p[1])
      state.thinkTarget = name === 'thinking' || name === 'connecting' ? 1 : 0
      canvas.dataset.state = name
    },
    webgl: Boolean(gl),
  }
  if (!gl) { canvas.classList.add('aura-fallback'); return api }

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.classList.add('aura-fallback'); api.webgl = false; return api }
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const u = Object.fromEntries(['uRes', 'uTime', 'uSpeak', 'uMic', 'uThink', 'uA', 'uB'].map((n) => [n, gl.getUniformLocation(prog, n)]))
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const t0 = performance.now()
  function frame() {
    requestAnimationFrame(frame)
    if (!canvas.isConnected || canvas.offsetParent === null) return
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const k = 0.12
    state.speak += ((Math.min(1, (state.ts || 0) * 5)) - state.speak) * k
    state.mic += ((Math.min(1, (state.tm || 0) * 6)) - state.mic) * k
    state.think += (state.thinkTarget - state.think) * 0.05
    for (let i = 0; i < 3; i++) { state.a[i] += (state.ta[i] - state.a[i]) * 0.06; state.b[i] += (state.tb[i] - state.b[i]) * 0.06 }
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(u.uRes, w, h)
    gl.uniform1f(u.uTime, reduced ? 0 : (performance.now() - t0) / 1000)
    gl.uniform1f(u.uSpeak, state.speak)
    gl.uniform1f(u.uMic, state.mic)
    gl.uniform1f(u.uThink, state.think)
    gl.uniform3fv(u.uA, state.a)
    gl.uniform3fv(u.uB, state.b)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  frame()
  return api
}
