"""Synthesizes an original, seamless cyberpunk/synthwave loop for Calm Mode.

16 bars at 110 BPM in A minor (Am - F - C - G), mono 22.05 kHz 16-bit WAV:
driving saw bass arpeggio, detuned pad, plucky lead arp, kick/snare/hats.
Everything is generated here, so the track carries no third-party rights.
"""
import sys
import wave

import numpy as np

SR = 22050
BPM = 110
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 16
N = int(round(BARS * BAR * SR))
rng = np.random.default_rng(2077)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def saw(freq, length, detune=0.0):
    t = np.arange(length) / SR
    f = freq * (1 + detune)
    return 2 * ((t * f) % 1.0) - 1


def square(freq, length):
    t = np.arange(length) / SR
    return np.sign(np.sin(2 * np.pi * freq * t))


def lowpass(x, cutoff):
    # one-pole low-pass, cheap and warm
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def env(length, attack, decay, sustain=0.0):
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    e = np.full(length, sustain)
    e[: min(a, length)] = np.linspace(0, 1, a)[: min(a, length)]
    if a < length:
        seg = min(d, length - a)
        e[a : a + seg] = np.linspace(1, sustain, d)[:seg]
    return e


def place(buf, sig, start):
    start = int(start)
    if start >= len(buf):
        return
    end = min(len(buf), start + len(sig))
    buf[start:end] += sig[: end - start]


# Am, F, C, G as (root, chord tones) in MIDI
PROGRESSION = [
    (45, [57, 60, 64]),  # A minor
    (41, [53, 57, 60]),  # F major
    (48, [55, 60, 64]),  # C major
    (43, [55, 59, 62]),  # G major
]

bass = np.zeros(N)
pad = np.zeros(N)
lead = np.zeros(N)
drums = np.zeros(N)

sixteenth = BEAT / 4
for bar in range(BARS):
    root, chord = PROGRESSION[bar % 4]
    bar_start = bar * BAR

    # Bass: driving eighth notes, octave jumps on the off-beats
    for step in range(8):
        note = root + (12 if step % 2 else 0)
        length = int(BEAT / 2 * SR)
        s = saw(midi(note), length) * env(length, 0.005, 0.22, 0.35)
        place(bass, s, (bar_start + step * BEAT / 2) * SR)

    # Pad: detuned saw chord for the whole bar
    length = int(BAR * SR)
    chord_sig = sum(saw(midi(n), length, d) for n in chord for d in (-0.004, 0.004))
    place(pad, chord_sig * env(length, 0.25, BAR, 0.8), bar_start * SR)

    # Lead: sixteenth-note arpeggio over the chord, an octave up
    pattern = [0, 1, 2, 1, 2, 0, 2, 1]
    for step in range(16):
        note = chord[pattern[step % len(pattern)]] + 12
        length = int(sixteenth * SR)
        s = square(midi(note), length) * env(length, 0.002, sixteenth * 0.9, 0.0)
        place(lead, s, (bar_start + step * sixteenth) * SR)

    # Drums: four-on-the-floor kick, snare on 2 and 4, off-beat hats
    for beat in range(4):
        t0 = bar_start + beat * BEAT
        k_len = int(0.28 * SR)
        t = np.arange(k_len) / SR
        sweep = 55 + 110 * np.exp(-t * 30)
        kick = np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t * 9)
        place(drums, kick * 1.1, t0 * SR)
        if beat in (1, 3):
            s_len = int(0.2 * SR)
            snare = rng.uniform(-1, 1, s_len) * np.exp(-np.arange(s_len) / SR * 18)
            place(drums, snare * 0.55, t0 * SR)
        h_len = int(0.05 * SR)
        hat = rng.uniform(-1, 1, h_len) * np.exp(-np.arange(h_len) / SR * 90)
        hat = hat - lowpass(hat, 6000)  # crude high-pass
        place(drums, hat * 0.35, (t0 + BEAT / 2) * SR)

bass = lowpass(bass, 700) * 0.5
pad = lowpass(pad, 1400) * 0.09
lead = lowpass(lead, 2600) * 0.12

# Simple echo on the lead for that neon-city space; wrap it so the loop stays seamless
delay = int(BEAT * 0.75 * SR)
echo = np.roll(lead, delay) * 0.35 + np.roll(lead, 2 * delay) * 0.15

mix = bass + pad + lead + echo + drums * 0.6
mix = np.tanh(mix * 1.2)  # soft saturation
mix = mix / np.max(np.abs(mix)) * 0.7

# Tiny crossfade at the seam so the loop never clicks
fade = int(0.01 * SR)
mix[:fade] *= np.linspace(0, 1, fade)
mix[-fade:] *= np.linspace(1, 0, fade)

out = sys.argv[1]
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"wrote {out}: {N / SR:.1f}s")
