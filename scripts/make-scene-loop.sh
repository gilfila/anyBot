#!/usr/bin/env bash
# Turns a generated theme clip into a seamless backdrop loop (see CLAUDE.md, Themes).
# Usage: scripts/make-scene-loop.sh in.mp4 src/themes/media/NAME.webm src/themes/media/NAME.jpg [crf=34] [fade=1]
# Seamless loop: the clip's last F seconds crossfade into its first F
# seconds, so the output (T - F long) ends exactly where it begins.
set -euo pipefail
in="$1"; out="$2"; poster="$3"; crf="${4:-34}"; F="${5:-1}"
T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
tail_start=$(awk -v t="$T" -v f="$F" 'BEGIN{printf "%.3f", t-f}')
graph="[0:v]scale=1920:1080:flags=lanczos,fps=24,format=yuv420p,split=3[a][b][c];
[a]trim=start=${tail_start}:end=${T},setpts=PTS-STARTPTS[tail];
[b]trim=start=0:end=${F},setpts=PTS-STARTPTS[head];
[tail][head]xfade=transition=fade:duration=${F}:offset=0[blend];
[c]trim=start=${F}:end=${tail_start},setpts=PTS-STARTPTS[mid];
[blend][mid]concat=n=2:v=1:a=0[out]"
ffmpeg -v error -y -i "$in" -filter_complex "$graph" -map "[out]" -an \
  -c:v libvpx-vp9 -b:v 0 -crf "$crf" -row-mt 1 -deadline good -cpu-used 2 -g 480 -keyint_min 480 "$out"
ffmpeg -v error -y -i "$out" -frames:v 1 -q:v 4 "$poster"
ls -la "$out" "$poster"
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of compact "$out"
