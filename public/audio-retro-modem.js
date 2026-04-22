// public/audio-retro-modem.js
// Retro modem / FSK voice — chirps, clicks, bandpass filter.
// Each packet plays as a short burst of modem-like tones derived from payload bytes.
(function () {
  'use strict';

  const { midiToFreq, mapRange } = MeshAudio.helpers;

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function byteAt(arr, i, fallback = 0) {
    return arr && arr.length ? arr[i % arr.length] : fallback;
  }

  function env(gainNode, t0, attack, peak, decay, sustain, release) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0002, sustain), t0 + attack + decay);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release);
  }

  function chirp(audioCtx, masterGain, {
    t,
    f0,
    f1,
    dur,
    type = 'square',
    vol = 0.15,
    pan = 0,
    bandHz = 2200,
    q = 4
  }) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const panner = audioCtx.createStereoPanner();

    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(bandHz, t);
    filter.Q.value = q;

    panner.pan.setValueAtTime(clamp(pan, -1, 1), t);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(masterGain);

    // Longer attack + sustain for audibility
    env(gain, t, 0.006, vol, dur * 0.3, vol * 0.5, dur * 0.7);

    osc.start(t);
    osc.stop(t + dur + 0.05);

    osc.onended = () => {
      try { osc.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); } catch (_) {}
    };
  }

  function clickBurst(audioCtx, masterGain, t, pan, vol) {
    const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.025), audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const decay = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * decay * decay;
    }

    const src = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();

    src.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 1600;
    panner.pan.value = clamp(pan, -1, 1);

    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(masterGain);

    src.start(t);
    src.stop(t + 0.035);

    src.onended = () => {
      try { src.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect(); } catch (_) {}
    };
  }

  // Each packet type gets a distinct modem "dialect"
  function typeProfile(typeName) {
    switch (typeName) {
      case 'TEXT_MESSAGE':
      case 'DIRECT_MESSAGE':
        return { base: 1200, sweep: 700, spacing: 0.10, osc: 'square' };
      case 'POSITION':
      case 'GPS':
        return { base: 1600, sweep: 500, spacing: 0.08, osc: 'triangle' };
      case 'NODEINFO':
      case 'TELEMETRY':
        return { base: 2100, sweep: 350, spacing: 0.07, osc: 'square' };
      default:
        return { base: 1450, sweep: 600, spacing: 0.09, osc: 'square' };
    }
  }

  function play(audioCtx, masterGain, parsed, opts) {
    const { payloadBytes, typeName, hopCount, obsCount, lon } = parsed;
    if (!payloadBytes || !payloadBytes.length) return 0.35;

    const now = audioCtx.currentTime;
    const tm = opts?.tempoMultiplier || 1;
    const profile = typeProfile(typeName);

    // Pan from longitude when available; otherwise derive from bytes
    let pan = 0;
    if (typeof lon === 'number' && Number.isFinite(lon)) {
      pan = clamp(lon / 180, -0.9, 0.9);
    } else {
      pan = mapRange((byteAt(payloadBytes, 0) + byteAt(payloadBytes, 1)) / 2, 0, 255, -0.5, 0.5);
    }

    // More hops = duller/narrower "radio" tone (like hearing it through more relays)
    const bandHz = mapRange(clamp(hopCount || 0, 0, 8), 0, 8, 2800, 1200);

    // More observations = slightly denser phrase
    const chirpCount = clamp(3 + Math.floor((obsCount || 0) / 2), 3, 8);

    for (let i = 0; i < chirpCount; i++) {
      const b0 = byteAt(payloadBytes, i * 2);
      const b1 = byteAt(payloadBytes, i * 2 + 1, 127);

      const t = now + i * profile.spacing * tm;

      // FSK sweep region — driven by payload bytes
      const f0 = profile.base + mapRange(b0, 0, 255, -250, profile.sweep);
      const f1 = profile.base + mapRange(b1, 0, 255, 100, profile.sweep + 250);

      // Longer durations: 0.06–0.20s per chirp (was 0.025–0.09)
      const dur = mapRange((b0 ^ b1) & 0xff, 0, 255, 0.06, 0.20) * tm;

      // Louder: 0.08–0.25 (was 0.018–0.05)
      const vol = mapRange(b0, 0, 255, 0.08, 0.25);

      chirp(audioCtx, masterGain, {
        t,
        f0,
        f1,
        dur,
        type: profile.osc,
        vol,
        pan,
        bandHz,
        q: 5
      });

      // Click/static accents on every other chirp
      if (((b0 + b1 + i) % 3) === 0) {
        clickBurst(audioCtx, masterGain, t + dur * 0.4, pan * 0.7, vol * 0.6);
      }
    }

    // Packet-end "ack" beep — longer and louder
    const tailT = now + chirpCount * profile.spacing * tm + 0.02;
    const tailMidi = 76 + ((byteAt(payloadBytes, 0) ^ byteAt(payloadBytes, payloadBytes.length - 1)) % 8);
    const tailFreq = midiToFreq(tailMidi);

    chirp(audioCtx, masterGain, {
      t: tailT,
      f0: tailFreq,
      f1: tailFreq * 0.97,
      dur: 0.10 * tm,
      type: 'triangle',
      vol: 0.12,
      pan: -pan * 0.4,
      bandHz: Math.max(1000, bandHz - 200),
      q: 6
    });

    // Total duration: chirpCount * spacing + tail
    return (chirpCount * profile.spacing + 0.15) * tm;
  }

  MeshAudio.registerVoice('retro-modem', {
    name: 'retro-modem',
    play
  });
})();
