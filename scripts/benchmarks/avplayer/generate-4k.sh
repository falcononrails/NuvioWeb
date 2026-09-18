#!/bin/sh
set -eu
cd /qa/media
ffmpeg -v error -i h264-eac3.mkv -map 0 -vf scale=3840:2160 -c:v libx265 -preset ultrafast -crf 28 -pix_fmt yuv420p10le -x265-params pools=none:frame-threads=1:rc-lookahead=1:bframes=0:log-level=error:keyint=50 -c:a copy -filter_threads 1 -threads 2 -y hevc-eac3-4k.mkv
