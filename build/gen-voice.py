#!/usr/bin/env python3
"""
Renders the mascot's voice-over lines with piper (neural TTS, runs offline).

The rendered clips are committed under build/voice/, so rebuilding the video
does NOT require piper — you only need this script if you change the script
text or the voice.

Setup (once):
    python3 -m venv piperenv && ./piperenv/bin/pip install piper-tts
    mkdir voices && cd voices && ../piperenv/bin/python -m piper.download_voices en_US-ryan-high

Then:
    python3 build/gen-voice.py --piper ./piperenv/bin/python --model voices/en_US-ryan-high.onnx

Each line is fitted into its window from pip.html's TALK array by adjusting
piper's --length-scale, so the mascot's mouth animation and the audio agree.
"""
import argparse
import json
import os
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'build', 'voice')

# (anchor start, latest acceptable end, text) — anchors follow the storyboard
# beats in demo/app.html; the mouth windows in demo/pip.html are rewritten to
# whatever we actually render, see --write-talk.
LINES = [
    (0.5,  5.2,  "Alright — new test case. I'll call this one: fill out form."),
    (7.0,  12.0, "Now the specification. Plain English: what the user should be able to do."),
    (13.5, 19.2, "I hand that to the agent. Go to the demo page, and fill out the contact form."),
    (21.0, 26.2, "And there are my steps. Readable by me, executable by the machine."),
    (28.0, 33.2, "Now watch it drive the real browser. Every step, verified."),
    (36.5, 41.4, "Five of five passed. Don't chat with your code. Specify it."),
]


def synth(piper, model, text, path, length_scale):
    subprocess.run(
        [piper, '-m', 'piper', '-m', model, '-f', path,
         '--length-scale', f'{length_scale:.4f}',
         '--noise-scale', '0.60', '--noise-w-scale', '0.75',
         '--sentence-silence', '0.16'],
        input=text.encode(), check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--piper', required=True, help='python interpreter with piper-tts installed')
    ap.add_argument('--model', required=True, help='path to the .onnx voice model')
    ap.add_argument('--write-talk', action='store_true',
                    help='rewrite the TALK windows in demo/pip.html to match')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    meta = []
    for i, (start, latest, text) in enumerate(LINES, 1):
        path = os.path.join(OUT_DIR, f'line{i}.wav')
        budget = latest - start
        scale = 1.0
        # speak a little faster until the line fits its window (max 4 tries)
        for _ in range(4):
            dur = synth(args.piper, args.model, text, path, scale)
            if dur <= budget:
                break
            scale *= (budget / dur) * 0.97
        flag = 'ok ' if dur <= budget else 'LONG'
        print(f'  line{i} {flag} {dur:5.2f}s / {budget:4.1f}s  length-scale {scale:.3f}')
        meta.append({'file': f'line{i}.wav', 'start': start, 'dur': round(dur, 3), 'text': text})

    with open(os.path.join(OUT_DIR, 'lines.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    print('wrote', OUT_DIR)

    if args.write_talk:
        pip_path = os.path.join(ROOT, 'build', 'demo', 'pip.html')
        src = open(pip_path).read()
        windows = ', '.join(f'[{m["start"]}, {round(m["start"] + m["dur"], 2)}]' for m in meta)
        start = src.index('const TALK = [')
        end = src.index('];', start) + 2
        src = src[:start] + f'const TALK = [{windows}];' + src[end:]
        open(pip_path, 'w').write(src)
        print('updated TALK windows in', pip_path)


if __name__ == '__main__':
    main()
