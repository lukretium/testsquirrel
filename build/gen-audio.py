#!/usr/bin/env python3
"""
Synthesises the soundtrack for the demo screencast and muxes it into the MP4.

Everything here is generated from scratch (oscillators + shaped noise), so the
track carries no third-party licensing. Event times are copied from the
constants in build/demo/app.html — if the animation timing changes, update
EVENTS below to match.

    python3 build/gen-audio.py            # -> videos/testsquirrel-demo.mp4 (with audio)
    python3 build/gen-audio.py --wav-only # just write the wav, don't touch the video
"""
import math
import os
import subprocess
import sys
import tempfile
import wave
from array import array

import numpy as np

SR = 48000
DUR = 42.0
N = int(SR * DUR)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

rng = np.random.default_rng(20260809)

# ---------------------------------------------------------------- event map
# (mirrors app.html: CLICK_TIMES, STEP_CHECK, CODE_T, typing windows, phase swaps)
CLICKS = [2.2, 5.6, 12.0, 13.8, 19.4, 25.2]
TYPING = [(2.2, 4.5), (5.6, 11.0), (13.8, 18.5)]   # name, spec, chat composer
CHAT_LINES = [19.6 + i * 0.88 for i in range(5)]    # assistant lines + step rows
STEP_CHECKS = [26.5, 28.1, 29.7, 31.3, 32.9]
WHOOSHES = [(12.0, 0.55), (25.5, 0.85)]             # modal out, browser slides in
SUCCESS_CARD = 33.5
RUN_PASSED = 36.0
END_CARD = 38.5

# ------------------------------------------------------------------- helpers
def idx(t):
    return int(round(t * SR))


def add(buf, start_t, mono, pan=0.0, gain=1.0):
    """Mix a mono event into the stereo buffer at start_t. pan -1..1."""
    i0 = idx(start_t)
    if i0 >= N or i0 < 0:
        return
    seg = mono[: N - i0]
    l = gain * math.sqrt(0.5 * (1.0 - pan))
    r = gain * math.sqrt(0.5 * (1.0 + pan))
    buf[i0:i0 + len(seg), 0] += seg * l
    buf[i0:i0 + len(seg), 1] += seg * r


def env_ad(n, attack, decay, curve=3.0):
    """Percussive attack/decay envelope."""
    a = max(1, int(attack * SR))
    t = np.arange(n)
    e = np.empty(n)
    e[:a] = np.linspace(0.0, 1.0, a) ** 0.6
    d = n - a
    if d > 0:
        e[a:] = np.exp(-curve * np.arange(d) / max(1, decay * SR))
    return e


def bell(freq, dur, amp=0.25, partials=(1.0, 2.01, 3.02), decays=(1.0, 0.6, 0.4)):
    """Struck-bell tone: a few inharmonic partials with independent decays."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for p, dscale in zip(partials, decays):
        out += (1.0 / p) * np.sin(2 * math.pi * freq * p * t) * np.exp(-t / (dur * dscale * 0.42))
    return out * amp * env_ad(n, 0.004, dur * 0.5)


def lowpass(x, alpha):
    """One-pole lowpass; alpha may be scalar or per-sample."""
    y = np.empty_like(x)
    acc = 0.0
    if np.isscalar(alpha):
        a = float(alpha)
        for i in range(len(x)):
            acc += a * (x[i] - acc)
            y[i] = acc
    else:
        for i in range(len(x)):
            acc += alpha[i] * (x[i] - acc)
            y[i] = acc
    return y


# ------------------------------------------------------------------ the pad
# Am - F - C - G, 5.25 s per chord, two cycles = exactly 42 s.
CHORDS = [
    (220.00, 261.63, 329.63, 440.00),   # Am
    (174.61, 220.00, 261.63, 349.23),   # F
    (130.81, 164.81, 196.00, 261.63),   # C
    (196.00, 246.94, 293.66, 392.00),   # G
]
CHORD_LEN = 5.25


def make_pad():
    buf = np.zeros((N, 2))
    n = int((CHORD_LEN + 1.6) * SR)          # overlap into the next chord
    t = np.arange(n) / SR
    # slow swell in, long release out
    e = np.minimum(1.0, t / 1.3) * np.exp(-np.maximum(0.0, t - CHORD_LEN) / 0.7)
    e *= 0.85 + 0.15 * np.sin(2 * math.pi * 0.09 * t)   # gentle breathing
    for c in range(8):
        chord = CHORDS[c % 4]
        start = c * CHORD_LEN
        for vi, f in enumerate(chord):
            voice = np.zeros(n)
            for h, ha in ((1.0, 1.0), (2.0, 0.28), (3.0, 0.11)):
                # two slightly detuned oscillators per harmonic -> soft chorus
                voice += ha * (
                    np.sin(2 * math.pi * f * h * t + vi)
                    + np.sin(2 * math.pi * f * h * 1.004 * t + vi * 1.7)
                ) * 0.5
            pan = -0.45 + 0.3 * vi
            add(buf, start, voice * e, pan=pan, gain=0.080)
    return buf


def make_arp():
    """Sparse bell arpeggio, fading in once the workspace appears."""
    buf = np.zeros((N, 2))
    step = CHORD_LEN / 8.0
    k = 0
    t = 0.0
    while t < DUR:
        chord = CHORDS[int(t // CHORD_LEN) % 4]
        f = chord[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]] * 2.0
        # silent until the workspace, ducked during the test run, back for the outro
        if t < 12.0:
            g = 0.0
        elif t < 25.0:
            g = min(1.0, (t - 12.0) / 3.0)
        elif t < 36.0:
            g = 0.35
        else:
            g = 0.9
        if g > 0 and k % 2 == 0:
            add(buf, t, bell(f, 1.5, amp=0.14), pan=(-0.3 if k % 4 == 0 else 0.3), gain=g)
        t += step
        k += 1
    return buf


def make_pulse():
    """Soft low heartbeat while the specification is running."""
    buf = np.zeros((N, 2))
    t = 25.6
    while t < 35.9:
        n = int(0.35 * SR)
        tt = np.arange(n) / SR
        tone = np.sin(2 * math.pi * 92 * tt) * env_ad(n, 0.008, 0.12, curve=4.0)
        add(buf, t, tone, gain=0.12)
        t += 0.75
    return buf


# ------------------------------------------------------------------- sfx
def keystroke():
    n = int(0.035 * SR)
    noise = rng.normal(0, 1, n)
    click = np.diff(np.concatenate([[0.0], noise]))          # crude highpass
    body = np.sin(2 * math.pi * rng.uniform(1500, 2600) * np.arange(n) / SR)
    return (0.75 * click + 0.25 * body) * env_ad(n, 0.0008, 0.012, curve=6.0)


def mouse_click():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    tock = np.sin(2 * math.pi * 780 * t) + 0.5 * np.sin(2 * math.pi * 1240 * t)
    noise = np.diff(np.concatenate([[0.0], rng.normal(0, 1, n)]))
    return (0.6 * tock + 0.4 * noise) * env_ad(n, 0.001, 0.03, curve=5.0)


def whoosh(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # sweep the cutoff up then down so it reads as movement, not a hiss
    shape = np.sin(math.pi * t / dur)
    alpha = 0.0015 + 0.05 * shape
    swept = lowpass(noise, alpha)
    return swept * shape ** 2 * 3.0


def pop(freq):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = freq * (1.0 + 0.35 * np.exp(-t / 0.03))              # tiny upward chirp
    return np.sin(2 * math.pi * f * t) * env_ad(n, 0.002, 0.045, curve=5.0)


def tick():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * math.pi * 2100 * t) + 0.4 * np.sin(2 * math.pi * 3150 * t)) \
        * env_ad(n, 0.001, 0.028, curve=6.0)


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 180 * (2 ** (2.2 * t / dur))
    sweep = np.sin(2 * math.pi * np.cumsum(f) / SR)
    noise = lowpass(rng.normal(0, 1, n), 0.02) * 0.5
    return (sweep * 0.5 + noise) * (t / dur) ** 2.2


# ---------------------------------------------------------------- voice-over
VOICE_DIR = os.path.join(ROOT, 'build', 'voice')


def load_voice():
    """Load the rendered voice lines (see gen-voice.py), resampled to SR."""
    manifest = os.path.join(VOICE_DIR, 'lines.json')
    if not os.path.exists(manifest):
        print('no voice lines found — building an instrumental track')
        return []
    import json
    out = []
    for item in json.load(open(manifest)):
        src = os.path.join(VOICE_DIR, item['file'])
        # ffmpeg does the rate conversion properly; np.interp would alias
        raw = subprocess.run(
            ['ffmpeg', '-v', 'error', '-i', src, '-ac', '1', '-ar', str(SR),
             '-f', 'f32le', '-'],
            check=True, stdout=subprocess.PIPE).stdout
        mono = np.frombuffer(raw, dtype='<f4').astype(float)
        out.append((item['start'], mono))
    return out


def duck_envelope(voice, depth_db=-11.0, ramp=0.28):
    """Gain curve that pulls the music down while the squirrel is talking."""
    env = np.ones(N)
    depth = 10 ** (depth_db / 20)
    r = int(ramp * SR)
    for start, mono in voice:
        a = max(0, idx(start) - r)
        b = min(N, idx(start) + len(mono) + r)
        seg = np.full(b - a, depth)
        k = min(r, len(seg) // 2)
        if k > 0:
            seg[:k] = np.linspace(1.0, depth, k)
            seg[-k:] = np.linspace(depth, 1.0, k)
        env[a:b] = np.minimum(env[a:b], seg)
    return env


# ------------------------------------------------------------------- build
def build():
    voice = load_voice()

    music = make_pad() + make_arp() + make_pulse()
    music *= duck_envelope(voice)[:, None]
    buf = music

    # typing — irregular spacing so it sounds human, with pauses between words
    for t0, t1 in TYPING:
        t = t0
        while t < t1:
            add(buf, t, keystroke(), pan=rng.uniform(-0.25, 0.25), gain=rng.uniform(0.5, 1.0) * 0.26)
            gap = rng.uniform(0.055, 0.105)
            if rng.random() < 0.12:
                gap += rng.uniform(0.08, 0.22)          # thinking pause
            t += gap

    for t in CLICKS:
        add(buf, t, mouse_click(), gain=0.38)

    for t, d in WHOOSHES:
        add(buf, t, whoosh(d), gain=0.30)

    # a step row lands with each assistant line
    for i, t in enumerate(CHAT_LINES):
        add(buf, t + 0.55, pop(560 + i * 70), pan=-0.2, gain=0.26)

    # each verified step ticks off
    for i, t in enumerate(STEP_CHECKS):
        add(buf, t, tick(), pan=0.25, gain=0.22)

    # confirmation card
    for i, f in enumerate((523.25, 659.25, 783.99)):
        add(buf, SUCCESS_CARD + i * 0.075, bell(f, 1.6, amp=0.22), gain=0.85)

    # 5/5 passed
    for i, f in enumerate((523.25, 659.25, 783.99, 1046.50)):
        add(buf, RUN_PASSED + i * 0.085, bell(f, 2.4, amp=0.26), gain=0.95)

    # lift into the end card
    add(buf, END_CARD - 1.1, riser(1.1), gain=0.16)
    for i, f in enumerate((261.63, 329.63, 392.00, 523.25)):
        add(buf, END_CARD, bell(f, 3.2, amp=0.20), pan=-0.3 + 0.2 * i, gain=0.9)

    # the squirrel, centred and sitting on top of the ducked bed
    for start, mono in voice:
        add(buf, start, mono, gain=0.85)

    # fade in/out at the edges
    fi, fo = int(1.2 * SR), int(2.6 * SR)
    buf[:fi] *= np.linspace(0, 1, fi)[:, None] ** 1.5
    buf[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.6

    # gentle limiting, then leave headroom (target roughly the original's level)
    buf = np.tanh(buf * 1.15) * 0.92
    peak = np.max(np.abs(buf))
    if peak > 0:
        buf *= (10 ** (-6.0 / 20)) / peak
    return buf


def write_wav(buf, path):
    data = np.clip(buf, -1.0, 1.0)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    tmp = os.path.join(tempfile.gettempdir(), 'testsquirrel-demo-audio.wav')
    write_wav(build(), tmp)
    print('wrote', tmp)
    if '--wav-only' in sys.argv:
        return

    video = os.path.join(ROOT, 'videos', 'testsquirrel-demo.mp4')
    out = video.replace('.mp4', '.tmp.mp4')
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-i', video, '-i', tmp,
        '-map', '0:v:0', '-map', '1:a:0',
        '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11,aresample=48000',
        '-ar', '48000',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart', '-shortest', out,
    ], check=True)
    os.replace(out, video)
    print('muxed audio into', video)


if __name__ == '__main__':
    main()
