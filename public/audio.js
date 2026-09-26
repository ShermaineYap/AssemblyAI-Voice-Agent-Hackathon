// Microphone capture and speaker playback for the Voice Agent API, which
// speaks 24 kHz mono PCM16 in both directions. Both worklets resample
// linearly, because Firefox and Safari may ignore a requested sample rate.

export const WIRE_RATE = 24000

const CAPTURE = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${WIRE_RATE};
    this.pos = 0;
    this.prev = 0;
    this.level = 0;
    this.frames = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    this.level = Math.max(Math.sqrt(sum / ch.length), this.level * 0.85);
    let out;
    if (this.ratio === 1) {
      out = ch;
    } else {
      const res = [];
      let pos = this.pos;
      while (pos < ch.length) {
        const i = Math.floor(pos);
        const a = i === 0 ? this.prev : ch[i - 1];
        const b = ch[i];
        res.push(a + (b - a) * (pos - i));
        pos += this.ratio;
      }
      this.pos = pos - ch.length;
      this.prev = ch[ch.length - 1];
      out = res;
    }
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const s = Math.max(-1, Math.min(1, out[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    if (pcm.length) this.port.postMessage({ pcm: pcm.buffer, level: this.level }, [pcm.buffer]);
    return true;
  }
}
registerProcessor('vv-capture', Capture);
`

const PLAYBACK = `
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(sampleRate * 60);
    this.w = 0; this.r = 0; this.n = 0;
    this.step = ${WIRE_RATE} / sampleRate;
    this.pos = 0; this.prev = 0;
    this.playing = false;
    this.level = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') { this.w = this.r = this.n = 0; this.pos = this.prev = 0; return; }
      const pcm = new Int16Array(e.data);
      if (!pcm.length) return;
      if (!this.playing && this.n === 0) { this.prev = 0; this.pos = 0; }
      let pos = this.pos;
      while (pos < pcm.length) {
        const i = Math.floor(pos);
        const a = i === 0 ? this.prev : pcm[i - 1] / 32768;
        const b = pcm[i] / 32768;
        this.push(a + (b - a) * (pos - i));
        pos += this.step;
      }
      this.pos = pos - pcm.length;
      this.prev = pcm[pcm.length - 1] / 32768;
    };
  }
  push(v) {
    if (this.n >= this.ring.length) return;
    this.ring[this.w] = v; this.w = (this.w + 1) % this.ring.length; this.n++;
  }
  process(_, outputs) {
    const out = outputs[0];
    const ch = out[0];
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      if (this.n > 0) {
        ch[i] = this.ring[this.r]; this.r = (this.r + 1) % this.ring.length; this.n--;
      } else ch[i] = 0;
      sum += ch[i] * ch[i];
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch);
    this.level = Math.max(Math.sqrt(sum / ch.length), this.level * 0.85);
    const nowPlaying = this.n > 0;
    if (nowPlaying !== this.playing) {
      this.playing = nowPlaying;
      this.port.postMessage({ playing: nowPlaying });
    }
    if ((currentFrame / 128) % 4 === 0) this.port.postMessage({ level: this.level });
    return true;
  }
}
registerProcessor('vv-playback', Playback);
`

async function worklet(ctx, code, name) {
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  return new AudioWorkletNode(ctx, name, { outputChannelCount: [2] })
}

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromBase64(b64) {
  const raw = atob(b64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes.buffer
}

// Opens mic + speaker. Must be called from a click handler (Safari).
// onChunk(ArrayBuffer pcm16), onMicLevel(0..1), onSpeakerLevel(0..1), onPlaying(bool)
export async function openAudio({ deviceId, onChunk, onMicLevel, onSpeakerLevel, onPlaying }) {
  const capCtx = new AudioContext({ sampleRate: WIRE_RATE })
  const playCtx = new AudioContext({ sampleRate: WIRE_RATE })
  await Promise.all([capCtx.resume(), playCtx.resume()])

  const player = await worklet(playCtx, PLAYBACK, 'vv-playback')
  player.connect(playCtx.destination)
  player.port.onmessage = ({ data }) => {
    if ('playing' in data) onPlaying?.(data.playing)
    if ('level' in data) onSpeakerLevel?.(data.level)
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId } : {}),
      channelCount: 1,
      // Keeps the examiner's voice out of the mic so it doesn't interrupt itself.
      echoCancellation: true,
      noiseSuppression: false,
      // AssemblyAI's guidance: echo cancellation + AGC on, browser noise
      // suppression off (the API runs its own voice focus server-side).
      autoGainControl: true,
    },
  })
  const capture = await worklet(capCtx, CAPTURE, 'vv-capture')
  capCtx.createMediaStreamSource(stream).connect(capture)
  capture.port.onmessage = ({ data }) => {
    onMicLevel?.(data.level)
    onChunk?.(data.pcm)
  }

  return {
    play: (buffer) => player.port.postMessage(buffer, [buffer]),
    flush: () => player.port.postMessage('stop'),
    close: () => {
      stream.getTracks().forEach((t) => t.stop())
      capCtx.close()
      playCtx.close()
    },
  }
}
