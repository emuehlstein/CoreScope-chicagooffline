// Voice v3: "Notify" — cellphone text notification chimes
// Each packet plays a short, bright notification tone like a text message arriving.
// Packet type determines the chime pattern: messages get the classic two-tone,
// adverts get a single ping, traces get a triple tap, etc.

(function () {
  'use strict';

  const { midiToFreq, mapRange } = MeshAudio.helpers;

  // Chime patterns per packet type: arrays of [midiNote, startOffsetSec, durationSec]
  // Inspired by common phone notification sounds
  const CHIME_PATTERNS = {
    // Text messages: classic two-tone ascending (like iMessage / SMS)
    TXT_MSG: [
      [76, 0.00, 0.08],   // E5 — first note
      [80, 0.10, 0.12],   // E5+4 (Ab5) — second note, slightly longer
    ],
    GRP_TXT: [
      [74, 0.00, 0.08],   // D5
      [78, 0.09, 0.08],   // F#5
      [81, 0.18, 0.14],   // A5 — three-note ascending for group
    ],
    // Adverts: single bright ping (like a notification badge)
    ADVERT: [
      [79, 0.00, 0.15],   // G5 — clean single tone
    ],
    // Trace: quick triple-tap (like a typing indicator)
    TRACE: [
      [72, 0.00, 0.04],   // C5
      [72, 0.07, 0.04],   // C5
      [72, 0.14, 0.04],   // C5
    ],
    // ACK: soft descending two-tone (like "sent" confirmation)
    ACK: [
      [77, 0.00, 0.06],   // F5
      [74, 0.08, 0.10],   // D5 — descending = done
    ],
    // Path/Request/Response: muted double-tap
    PATH: [
      [69, 0.00, 0.05],   // A4
      [71, 0.08, 0.08],   // B4
    ],
    REQUEST: [
      [71, 0.00, 0.06],   // B4
      [74, 0.08, 0.10],   // D5
    ],
    RESPONSE: [
      [74, 0.00, 0.06],   // D5
      [71, 0.08, 0.10],   // B4 — descending
    ],
  };

  // Default: generic two-tone
  const DEFAULT_PATTERN = [
    [76, 0.00, 0.08],
    [79, 0.10, 0.12],
  ];

  function play(audioCtx, masterGain, parsed, opts) {
    const { typeName, hopCount, obsCount, payload, hops } = parsed;
    const tm = opts.tempoMultiplier;

    const pattern = CHIME_PATTERNS[typeName] || DEFAULT_PATTERN;

    // Subtle pitch variation from payload bytes (keeps it from being monotonous)
    const pitchOffset = parsed.payloadBytes.length > 0
      ? (parsed.payloadBytes[0] % 5) - 2  // -2 to +2 semitones
      : 0;

    // Pan from node position or slight random
    let panValue = 0;
    if (payload.lat !== undefined && payload.lon !== undefined) {
      panValue = Math.max(-1, Math.min(1, mapRange(payload.lon, -125, -65, -1, 1)));
    } else {
      panValue = (Math.random() - 0.5) * 0.6;
    }

    // Volume: slightly louder for messages, softer for acks/traces
    const baseVolume = typeName === 'TXT_MSG' || typeName === 'GRP_TXT' ? 0.5
      : typeName === 'ACK' || typeName === 'TRACE' ? 0.2
      : 0.35;
    const volume = Math.min(0.7, baseVolume + (obsCount - 1) * 0.02);

    const panner = audioCtx.createStereoPanner();
    panner.pan.value = panValue;
    panner.connect(masterGain);

    let maxEnd = 0;
    const nodes = []; // for cleanup

    pattern.forEach(([midi, offset, dur]) => {
      const freq = midiToFreq(midi + pitchOffset);
      const noteStart = audioCtx.currentTime + 0.01 + (offset * tm);
      const noteDur = dur * tm;
      const noteEnd = offset + dur;
      if (noteEnd > maxEnd) maxEnd = noteEnd;

      // Main tone: triangle wave (warm, phone-like)
      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      // Harmonic shimmer: quiet sine one octave up
      const shimmer = audioCtx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = freq * 2;

      const shimmerGain = audioCtx.createGain();
      shimmerGain.gain.value = 0.15; // subtle

      // Envelope: crisp attack, smooth decay (phone notification style)
      const env = audioCtx.createGain();
      env.gain.setValueAtTime(0.0001, noteStart);
      env.gain.exponentialRampToValueAtTime(volume, noteStart + 0.003); // 3ms attack — very snappy
      env.gain.setValueAtTime(volume, noteStart + 0.003);
      env.gain.exponentialRampToValueAtTime(volume * 0.4, noteStart + noteDur * 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteDur);

      // Bandpass filter for that clean phone speaker character
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq * 1.5;
      filter.Q.value = 1.5;

      // Connect: osc + shimmer → env → filter → panner
      osc.connect(env);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(env);
      env.connect(filter);
      filter.connect(panner);

      osc.start(noteStart);
      osc.stop(noteStart + noteDur + 0.05);
      shimmer.start(noteStart);
      shimmer.stop(noteStart + noteDur + 0.05);

      nodes.push(osc, shimmer, shimmerGain, env, filter);
    });

    const totalDuration = maxEnd * tm + 0.2;

    // Cleanup
    setTimeout(() => {
      try {
        nodes.forEach(n => n.disconnect());
        panner.disconnect();
      } catch (e) {}
    }, (totalDuration + 0.5) * 1000);

    return totalDuration;
  }

  MeshAudio.registerVoice('notify', { name: 'notify', play });
})();
