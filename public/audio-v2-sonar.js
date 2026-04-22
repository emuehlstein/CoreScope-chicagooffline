// Voice v2: "Sonar" — submarine ping-style packet sonification
// Packet arrival triggers a sonar ping: sharp attack, frequency sweep, reverb tail.
// Payload type controls ping tone, hops control depth/frequency, observations add reverb.

(function () {
  'use strict';

  const { midiToFreq, mapRange } = MeshAudio.helpers;

  // Base frequencies per payload type (in MIDI notes)
  // Shifted up ~1 octave for brighter, more audible pings
  const PING_TONES = {
    ADVERT: 72,      // C5 — high, bright
    GRP_TXT: 67,     // G4 — medium-high
    TXT_MSG: 62,     // D4 — medium
    TRACE: 57,       // A3 — lower
  };
  const DEFAULT_TONE = 67;

  function play(audioCtx, masterGain, parsed, opts) {
    const { typeName, hopCount, obsCount, payload, hops } = parsed;
    const tm = opts.tempoMultiplier;

    // Base ping frequency from packet type
    const baseMidi = PING_TONES[typeName] || DEFAULT_TONE;
    const baseFreq = midiToFreq(baseMidi);

    // Frequency sweep: hops → deeper sweep (more hops = lower end frequency)
    const sweepStartFreq = baseFreq * 1.3; // start ~30% higher (less dramatic)
    const sweepEndMultiplier = mapRange(Math.min(hopCount, 10), 1, 10, 0.85, 0.6); // shallower sweep
    const sweepEndFreq = baseFreq * sweepEndMultiplier;

    // Pan from longitude (if available)
    let panValue = 0;
    if (payload.lat !== undefined && payload.lon !== undefined) {
      panValue = Math.max(-1, Math.min(1, mapRange(payload.lon, -125, -65, -1, 1)));
    } else if (hops.length > 0) {
      panValue = (Math.random() - 0.5) * 0.4;
    }

    // Volume from observations (more observers = louder ping)
    const volume = Math.min(0.8, 0.2 + (obsCount - 1) * 0.03);

    // Reverb amount from observations (more observers = more echo)
    const reverbMix = Math.min(0.6, 0.15 + (obsCount - 1) * 0.02);

    // Audio chain: osc → gain → filter → reverb (wet+dry mix) → panner → master
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const convolver = audioCtx.createConvolver();
    const dryGain = audioCtx.createGain();
    const wetGain = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();

    // Generate impulse response for reverb (exponential decay)
    const reverbDuration = mapRange(obsCount, 1, 20, 0.8, 2.5) * tm; // longer reverb for more observers
    const reverbSamples = Math.floor(audioCtx.sampleRate * reverbDuration);
    const impulse = audioCtx.createBuffer(2, reverbSamples, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const channelData = impulse.getChannelData(ch);
      for (let i = 0; i < reverbSamples; i++) {
        // Exponential decay with random noise
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbSamples, 3);
      }
    }
    convolver.buffer = impulse;

    // Oscillator: sine wave, frequency sweep
    osc.type = 'sine';
    osc.frequency.setValueAtTime(sweepStartFreq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(sweepEndFreq, audioCtx.currentTime + 0.08 * tm); // shorter sweep

    // Envelope: sharp attack, quick decay
    const now = audioCtx.currentTime + 0.01; // small lookahead
    const attackTime = 0.003; // very sharp attack (3ms)
    const decayTime = 0.12 * tm; // shorter decay
    const releaseTime = 0.2 * tm; // shorter release
    const totalDuration = attackTime + decayTime + releaseTime;

    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(volume, now + attackTime);
    oscGain.gain.exponentialRampToValueAtTime(volume * 0.1, now + attackTime + decayTime);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + attackTime + decayTime + releaseTime);

    // Filter: highpass to cut low-end rumble, resonance for "ping" character
    filter.type = 'highpass';
    filter.frequency.value = 100;
    filter.Q.value = 2;

    // Reverb mix: dry/wet based on observation count
    dryGain.gain.value = 1 - reverbMix;
    wetGain.gain.value = reverbMix;

    // Panner: stereo field
    panner.pan.value = panValue;

    // Connect audio chain
    osc.connect(oscGain);
    oscGain.connect(filter);
    
    // Dry path (direct)
    filter.connect(dryGain);
    dryGain.connect(panner);
    
    // Wet path (reverb)
    filter.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(panner);
    
    // Final output
    panner.connect(masterGain);

    // Start oscillator
    osc.start(now);
    osc.stop(now + totalDuration);

    // Cleanup
    const cleanupDelay = (totalDuration + reverbDuration + 0.5) * 1000;
    setTimeout(() => {
      try {
        osc.disconnect();
        oscGain.disconnect();
        filter.disconnect();
        convolver.disconnect();
        dryGain.disconnect();
        wetGain.disconnect();
        panner.disconnect();
      } catch (e) {}
    }, cleanupDelay);

    return totalDuration + reverbDuration;
  }

  MeshAudio.registerVoice('sonar', { name: 'sonar', play });
})();
