#!/bin/sh
set -eu
mkdir -p /qa/media
cd /qa/media
# Synthetic movement plus a simultaneous flash/beep every two seconds.
ffmpeg -v error -f lavfi -i testsrc2=size=1920x1080:rate=25 -f lavfi -i "aevalsrc=if(lt(mod(t\,2)\,0.12)\,0.4*sin(2*PI*440*t)\,0):s=48000" -f lavfi -i "aevalsrc=if(lt(mod(t\,2)\,0.12)\,0.4*sin(2*PI*880*t)\,0):s=48000" -vf "drawbox=x=0:y=0:w=160:h=160:color=black:t=fill,drawbox=x=0:y=0:w=160:h=160:color=white:t=fill:enable='lt(mod(t,2),0.12)'" -map 0:v -map 1:a -map 2:a -t 32 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -g 50 -keyint_min 50 -sc_threshold 0 -c:a eac3 -b:a 192k -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa -threads 2 -y h264-eac3.mkv
for codec in ac3 dca aac; do
  ffmpeg -v error -i h264-eac3.mkv -map 0 -c:v copy -c:a "$codec" -strict -2 -b:a 192k -threads 1 -y "h264-$codec.mkv"
done
ffmpeg -v error -i h264-aac.mkv -map 0 -c copy -movflags +faststart -y h264-aac.mp4
mkdir -p hls
ffmpeg -v error -i h264-eac3.mkv -map 0:v:0 -map 0:a:0 -c:v copy -tag:v avc1 -c:a aac -ac 2 -b:a 192k -threads 1 -avoid_negative_ts make_zero -f hls -hls_time 4 -hls_list_size 0 -hls_flags independent_segments -hls_segment_type fmp4 -y hls/index.m3u8
