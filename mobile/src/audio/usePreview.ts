import { useEffect, useRef } from 'react';
import { AudioContext } from 'react-native-audio-api';
import type { VideoPlayer } from 'expo-video';
import { useSession } from '../state/session';
import { trackActiveValues } from '../data/TrackFile';
import { renderBlanket } from '../dsp/renderBlanket';
import { TARGET_SAMPLE_RATE } from '../dsp/AudioFile';
import type { Channels } from '../dsp';

type Buffer = ReturnType<AudioContext['createBuffer']>;
type Source = ReturnType<AudioContext['createBufferSource']>;

const RESYNC_THRESHOLD = 0.25; // seconds of drift before a hard resync
const RENDER_DEBOUNCE = 200; // ms of quiet after the last slider move

// Drives the processed-audio preview: the video is muted and this graph plays
// the FULL MIX instead — every decoded track rendered through its own Blanket
// chain and summed — kept in sync with the video's clock. Moving sliders
// re-renders (debounced) and swaps the playing buffer; per-track renders are
// cached by their values, so a knob drag re-renders only the touched track and
// the rest just re-mix.
export function usePreview(player: VideoPlayer) {
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<Buffer | null>(null);
  const sourceRef = useRef<Source | null>(null);
  // Bookkeeping to derive the audio's current playback position.
  const startCtxTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  // Per-track processed PCM, keyed by track id and stamped with the value set
  // that produced it (so a change invalidates just that track).
  const renderedRef = useRef(
    new Map<string, { sig: string; channels: Channels }>(),
  );

  // Everything the mix depends on, as a signature string (id + decoded flag +
  // active values per track). Selecting a signature — never `pcm` itself, which
  // is a large buffer — keeps the editor's re-render discipline: this only
  // changes when a knob settles, a mode flips, or a track's decode lands.
  const mixSig = useSession((s) =>
    (s.file?.tracks ?? [])
      .map((t) =>
        [t.id, t.pcm ? '1' : '0', JSON.stringify(trackActiveValues(t))].join('|'),
      )
      .join('\n'),
  );

  const stopSource = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // already stopped/ended
      }
      sourceRef.current = null;
    }
  };

  // A buffer source is one-shot, so each (re)start builds a fresh node and
  // begins playback at the given offset into the looping buffer.
  const startSource = (offsetSec: number) => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    stopSource();
    const offset = ((offsetSec % buffer.duration) + buffer.duration) % buffer.duration;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(ctx.destination);
    src.start(0, offset);
    sourceRef.current = src;
    startCtxTimeRef.current = ctx.currentTime;
    startOffsetRef.current = offset;
  };

  const audioPosition = (): number => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer || !sourceRef.current) return 0;
    const elapsed = ctx.currentTime - startCtxTimeRef.current;
    return (startOffsetRef.current + elapsed) % buffer.duration;
  };

  // Context + video-sync wiring, once per player.
  useEffect(() => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    player.muted = true; // our graph is the audio now
    player.timeUpdateEventInterval = 0.25; // enable drift checks

    const onPlaying = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) {
        ctx.resume();
        startSource(player.currentTime);
      } else {
        stopSource();
      }
    });

    const onTime = player.addListener('timeUpdate', ({ currentTime }) => {
      const buffer = bufferRef.current;
      if (!sourceRef.current || !buffer) return;
      let drift = Math.abs(currentTime - audioPosition());
      drift = Math.min(drift, buffer.duration - drift); // tolerate loop wrap
      if (drift > RESYNC_THRESHOLD) startSource(currentTime);
    });

    return () => {
      onPlaying.remove();
      onTime.remove();
      stopSource();
      ctx.close();
      ctxRef.current = null;
      bufferRef.current = null;
    };
  }, [player]);

  // (Re)render the mix when the sliders settle, then swap the buffer. Tracks
  // join the mix as their background decodes land — no waiting for all of them.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      // pcm is read via getState(), off the reactive path (big-buffer rule).
      const tracks = (useSession.getState().file?.tracks ?? []).filter(
        (t) => t.pcm !== null,
      );
      if (tracks.length === 0) return;

      const cache = renderedRef.current;
      const rendered: Channels[] = [];
      for (const t of tracks) {
        const values = trackActiveValues(t);
        const sig = JSON.stringify(values);
        const hit = cache.get(t.id);
        if (hit && hit.sig === sig) {
          rendered.push(hit.channels);
          continue;
        }
        const channels = await renderBlanket(t.pcm!, t.sampleRate, values);
        if (cancelled) return;
        cache.set(t.id, { sig, channels });
        rendered.push(channels);
      }
      // Drop cache entries for tracks that left the file.
      const ids = new Set(tracks.map((t) => t.id));
      for (const id of [...cache.keys()]) if (!ids.has(id)) cache.delete(id);

      const ctx = ctxRef.current;
      if (cancelled || !ctx) return;
      bufferRef.current = channelsToBuffer(ctx, mixDown(rendered));

      // Reflect the new audio right away if we are (or should be) playing.
      if (sourceRef.current) startSource(audioPosition());
      else if (player.playing) startSource(player.currentTime);
    }, RENDER_DEBOUNCE);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mixSig, player]);
}

// Sum per-track renders into one set of channels: length of the longest track
// (shorter ones just end early), channel count of the widest (mono tracks play
// centered, i.e. into every output channel). A plain sum, no normalization —
// levels are the tracks' volume faders' job, exactly like a console.
function mixDown(tracks: Channels[]): Channels {
  if (tracks.length === 1) return tracks[0];
  const channelCount = Math.max(...tracks.map((t) => t.length));
  const length = Math.max(...tracks.map((t) => t[0].length));
  const out: Channels = Array.from(
    { length: channelCount },
    () => new Float32Array(length),
  );
  for (const t of tracks) {
    for (let c = 0; c < channelCount; c++) {
      const src = t[c % t.length];
      const dst = out[c];
      for (let i = 0; i < src.length; i++) dst[i] += src[i];
    }
  }
  return out;
}

function channelsToBuffer(ctx: AudioContext, channels: Channels): Buffer {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, TARGET_SAMPLE_RATE);
  for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c);
  return buffer;
}
