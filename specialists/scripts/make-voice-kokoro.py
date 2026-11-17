#!/usr/bin/env python3
"""
Voice-over for the demo: the trailer line spoken by Kokoro-82M, locally, no network at run time.

Model: Kokoro-82M by hexgrad, weights and voices under Apache License 2.0
       (https://huggingface.co/hexgrad/Kokoro-82M), ONNX files from the kokoro-onnx release "model-files-v1.0".
Runtime: kokoro-onnx (MIT, https://github.com/thewh1teagle/kokoro-onnx) and onnxruntime (MIT).
Voice: af_heart, the same voice the game's own agent uses.

usage: <venv>/bin/python make-voice-kokoro.py --model-dir DIR --text voice-script.txt --out voice-full.mp3
                                               [--voice af_heart] [--speed 1.0] [--preview voice-preview-3s.mp3]
"""
import argparse
import os
import subprocess
import tempfile

import soundfile as sf
from kokoro_onnx import Kokoro


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model-dir', required=True)
    ap.add_argument('--text', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--voice', default='af_heart')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--preview')
    a = ap.parse_args()
    text = open(a.text, encoding='utf-8').read().strip()
    k = Kokoro(os.path.join(a.model_dir, 'kokoro-v1.0.onnx'), os.path.join(a.model_dir, 'voices-v1.0.bin'))
    samples, rate = k.create(text, voice=a.voice, speed=a.speed, lang='en-us')
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, 'v.wav')
        sf.write(wav, samples, rate)
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100',
             '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1',
             '-metadata', f'artist=Kokoro-82M ({a.voice}), Apache-2.0',
             '-metadata', 'comment=AI voice, generated locally', a.out],
            check=True,
        )
    if a.preview:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.out, '-t', '3.0', '-af', 'afade=t=out:st=2.6:d=0.4',
                        '-c:a', 'libmp3lame', '-b:a', '96k', a.preview], check=True)
    print(f'{len(samples) / rate:.2f} s at {rate} Hz, voice {a.voice}, speed {a.speed}')


if __name__ == '__main__':
    main()
