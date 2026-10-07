"""Synthesizes Calm Mode's built-in background tracks.

Every sound here is generated from oscillators and noise in this file, so the
tracks carry no third-party rights. Each loop is mono 22.05 kHz 16-bit WAV and
loops seamlessly: anything that rings past the end is folded back onto the
start before the file is written.

    python tools/make_tracks.py sounds/          # writes all four tracks
    python tools/make_tracks.py sounds/ night-rain

Tracks:
    neon-drive      110 BPM A-minor synthwave: saw bass, pad, square arp, 4/4 drums
    night-rain       78 BPM lo-fi: electric piano 7th chords, dusty drums, rain
    hacker-pulse    128 BPM dark techno: rolling D-minor bass, claps, glitch hats
    chrome-ambient   no drums: slow evolving pads over a deep drone
"""
import os
import sys
import wave

import numpy as np

SR = 22050


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def saw(freq, length, detune=0.0):
    t = np.arange(length) / SR
    return 2 * ((t * freq * (1 + detune)) % 1.0) - 1


def square(freq, length):
    t = np.arange(length) / SR
    return np.sign(np.sin(2 * np.pi * freq * t))


def sine(freq, length, phase=0.0):
    t = np.arange(length) / SR
    return np.sin(2 * np.pi * freq * t + phase)


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a number or a per-sample array."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def env(length, attack, decay, sustain=0.0):
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    e = np.full(length, float(sustain))
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


def kick(length_s=0.28, top=110, bottom=50, decay=9):
    n = int(length_s * SR)
    t = np.arange(n) / SR
    sweep = bottom + top * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t * decay)


def noise_hit(rng, length_s, decay):
    n = int(length_s * SR)
    return rng.uniform(-1, 1, n) * np.exp(-np.arange(n) / SR * decay)


def finish(track, loop_len, peak=0.7):
    """Folds the tail past loop_len back onto the start, then normalizes."""
    out = track[:loop_len].copy()
    tail = track[loop_len:]
    out[: len(tail)] += tail
    out = np.tanh(out * 1.2)
    out = out / max(1e-9, np.max(np.abs(out))) * peak
    fade = int(0.004 * SR)
    out[:fade] *= np.linspace(0.6, 1, fade)
    out[-fade:] *= np.linspace(1, 0.6, fade)
    return out


# ── Neon Drive ──────────────────────────────────────────────────────────────


def neon_drive():
    rng = np.random.default_rng(2077)
    bpm, bars = 110, 16
    beat = 60 / bpm
    bar_s = 4 * beat
    loop = int(round(bars * bar_s * SR))
    n = loop + int(2 * SR)
    progression = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [55, 60, 64]), (43, [55, 59, 62])]
    bass, pad, lead, drums = (np.zeros(n) for _ in range(4))
    six = beat / 4
    for bar in range(bars):
        root, chord = progression[bar % 4]
        b0 = bar * bar_s
        for step in range(8):
            ln = int(beat / 2 * SR)
            place(bass, saw(midi(root + (12 if step % 2 else 0)), ln) * env(ln, 0.005, 0.22, 0.35), (b0 + step * beat / 2) * SR)
        ln = int(bar_s * SR)
        chord_sig = sum(saw(midi(c), ln, d) for c in chord for d in (-0.004, 0.004))
        place(pad, chord_sig * env(ln, 0.25, bar_s, 0.8), b0 * SR)
        pattern = [0, 1, 2, 1, 2, 0, 2, 1]
        for step in range(16):
            ln = int(six * SR)
            note = chord[pattern[step % 8]] + 12
            place(lead, square(midi(note), ln) * env(ln, 0.002, six * 0.9), (b0 + step * six) * SR)
        for bt in range(4):
            t0 = b0 + bt * beat
            place(drums, kick() * 1.1, t0 * SR)
            if bt in (1, 3):
                place(drums, noise_hit(rng, 0.2, 18) * 0.55, t0 * SR)
            place(drums, highpass(noise_hit(rng, 0.05, 90), 6000) * 0.35, (t0 + beat / 2) * SR)
    bass = lowpass(bass, 700) * 0.5
    pad = lowpass(pad, 1400) * 0.09
    lead = lowpass(lead, 2600) * 0.12
    delay = int(beat * 0.75 * SR)
    echo = np.roll(lead, delay) * 0.35 + np.roll(lead, 2 * delay) * 0.15
    return finish(bass + pad + lead + echo + drums * 0.6, loop)


# ── Night Rain (lo-fi) ──────────────────────────────────────────────────────


def epiano(freq, length):
    """Soft electric-piano tone: sine with a quick bell partial and a slow tremolo."""
    t = np.arange(length) / SR
    body = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)
    bell = 0.25 * np.sin(2 * np.pi * freq * 3.98 * t) * np.exp(-t * 6)
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return (body + bell) * trem * np.exp(-t * 1.1)


def night_rain():
    rng = np.random.default_rng(1984)
    bpm, bars = 78, 8
    beat = 60 / bpm
    bar_s = 4 * beat
    loop = int(round(bars * bar_s * SR))
    n = loop + int(4 * SR)
    # Fmaj7, Em7, Dm7, Cmaj7 (voiced around middle C)
    chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
    keys, bass, drums = np.zeros(n), np.zeros(n), np.zeros(n)
    swing = beat / 2 * 0.12
    for bar in range(bars):
        chord = chords[bar % 4]
        b0 = bar * bar_s
        for hit, offset in ((0, 0.0), (1, 2.5)):
            ln = int((bar_s - offset * beat + 1.5) * SR)
            for i, note in enumerate(chord):
                strum = i * 0.018
                place(keys, epiano(midi(note), ln) * (0.9 if hit == 0 else 0.6), (b0 + offset * beat + strum) * SR)
        ln = int(beat * 1.8 * SR)
        place(bass, sine(midi(chord[0] - 12), ln) * env(ln, 0.01, beat * 1.8, 0.0), b0 * SR)
        place(bass, sine(midi(chord[0] - 12), ln) * env(ln, 0.01, beat * 1.8, 0.0) * 0.7, (b0 + 2.5 * beat) * SR)
        for bt in range(4):
            t0 = b0 + bt * beat
            if bt in (0, 2) or (bt == 3 and bar % 2):
                place(drums, kick(0.3, 70, 45, 8) * 0.9, t0 * SR)
            if bt in (1, 3):
                place(drums, lowpass(noise_hit(rng, 0.25, 14), 3500) * 0.5, t0 * SR)
            for half in (0, 1):
                ht = t0 + half * beat / 2 + (swing if half else 0)
                place(drums, highpass(noise_hit(rng, 0.04, 110), 5000) * (0.2 if half else 0.3), ht * SR)
    rain = lowpass(highpass(rng.uniform(-1, 1, n), 900), 5000) * 0.07
    crackle = (rng.random(n) > 0.9993) * rng.uniform(-1, 1, n) * 0.5
    mix = lowpass(keys, 2800) * 0.16 + lowpass(bass, 300) * 0.45 + drums * 0.55 + rain + crackle
    return finish(lowpass(mix, 4200), loop, peak=0.6)


# ── Hacker Pulse (dark techno) ──────────────────────────────────────────────


def hacker_pulse():
    rng = np.random.default_rng(1337)
    bpm, bars = 128, 16
    beat = 60 / bpm
    bar_s = 4 * beat
    loop = int(round(bars * bar_s * SR))
    n = loop + int(2 * SR)
    roots = [38, 38, 41, 36]  # D, D, F, C
    bass, stab, drums = np.zeros(n), np.zeros(n), np.zeros(n)
    six = beat / 4
    for bar in range(bars):
        root = roots[(bar // 2) % 4]
        b0 = bar * bar_s
        for step in range(16):
            if step % 4 == 0:
                continue  # leave room for the kick
            ln = int(six * SR)
            note = root + (12 if step in (6, 14) else 0)
            place(bass, saw(midi(note), ln) * env(ln, 0.002, six * 0.8), (b0 + step * six) * SR)
        if bar % 2 == 0:
            ln = int(beat * 0.6 * SR)
            chord = [root + 24, root + 27, root + 31]  # minor triad, two octaves up
            sig = sum(saw(midi(c), ln, d) for c in chord for d in (-0.006, 0.006))
            place(stab, sig * env(ln, 0.003, beat * 0.6), (b0 + 1.5 * beat) * SR)
        for bt in range(4):
            t0 = b0 + bt * beat
            place(drums, kick(0.25, 140, 48, 11) * 1.2, t0 * SR)
            if bt in (1, 3):
                place(drums, highpass(noise_hit(rng, 0.15, 25), 1200) * 0.5, t0 * SR)
            place(drums, highpass(noise_hit(rng, 0.12, 30), 7000) * 0.3, (t0 + beat / 2) * SR)
            for q in (1, 3):
                place(drums, highpass(noise_hit(rng, 0.02, 200), 8000) * 0.18, (t0 + q * six) * SR)
        if bar % 4 == 3:  # glitch stutter on the last beat of every 4 bars
            for k in range(8):
                place(drums, highpass(noise_hit(rng, 0.015, 300), 6000) * 0.35, (b0 + 3 * beat + k * six / 2) * SR)
    t = np.arange(n) / SR
    sweep = 300 + 900 * (0.5 + 0.5 * np.sin(2 * np.pi * t / (bar_s * 4)))  # filter breathes every 4 bars
    mix = lowpass(bass, sweep) * 0.6 + lowpass(stab, 2200) * 0.1 + drums * 0.6
    delay = int(beat * 0.75 * SR)
    mix += np.roll(lowpass(stab, 2200) * 0.1, delay) * 0.4
    return finish(mix, loop)


# ── Chrome Ambient ──────────────────────────────────────────────────────────


def chrome_ambient():
    rng = np.random.default_rng(42)
    seconds = 32.0
    loop = int(seconds * SR)
    n = loop + int(6 * SR)
    t = np.arange(n) / SR
    drone = sine(midi(33), n) * 0.5 + sine(midi(45), n, 0.3) * 0.25  # low A
    pads = np.zeros(n)
    # Am9 then Fmaj7#11, each swelling for 16 s with an overlap
    for start, chord in ((0.0, [57, 60, 64, 67, 71]), (16.0, [53, 57, 60, 64, 71])):
        ln = int(22 * SR)
        sig = sum(saw(midi(c), ln, d) for c in chord for d in (-0.003, 0.0, 0.003))
        swell = np.sin(np.linspace(0, np.pi, ln)) ** 2
        place(pads, sig * swell, start * SR)
    cutoff = 500 + 400 * (0.5 + 0.5 * np.sin(2 * np.pi * t / seconds))
    shimmer = np.zeros(n)
    for _ in range(10):
        start = rng.uniform(0, seconds)
        ln = int(3 * SR)
        note = rng.choice([76, 79, 81, 83, 88])
        place(shimmer, sine(midi(note), ln) * env(ln, 1.0, 2.0) * 0.15, start * SR)
    air = lowpass(highpass(rng.uniform(-1, 1, n), 2000), 6000) * 0.015
    mix = lowpass(pads, cutoff) * 0.05 + drone * 0.2 + shimmer + air
    return finish(mix, loop, peak=0.55)


TRACKS = {
    'neon-drive': neon_drive,
    'night-rain': night_rain,
    'hacker-pulse': hacker_pulse,
    'chrome-ambient': chrome_ambient,
}


def write(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((samples * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    out_dir = sys.argv[1]
    names = sys.argv[2:] or list(TRACKS)
    for name in names:
        samples = TRACKS[name]()
        path = os.path.join(out_dir, f'{name}.wav')
        write(path, samples)
        print(f'{name}: {len(samples) / SR:.1f}s -> {path}')
