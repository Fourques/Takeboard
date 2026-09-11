import { useEffect, useRef, useState } from "react";

/** Metadata alone does not paint a video poster on WebKit. Decode a real frame. */
export function seekPreviewFrame(video: HTMLVideoElement) {
  if (
    video.paused &&
    !video.seeking &&
    video.currentTime === 0 &&
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    video.seekable.length > 0 &&
    video.seekable.end(video.seekable.length - 1) > 0
  )
    video.currentTime = Math.min(0.2, video.duration / 2);
}

export function VideoThumbnail({ src, label = "视频预览" }: { src: string; label?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  // A cached source may already be ready when React attaches media listeners.
  // biome-ignore lint/correctness/useExhaustiveDependencies: inspect readiness again for a different source.
  useEffect(() => {
    if (preview.current) seekPreviewFrame(preview.current);
  }, [src]);
  return failedUrl === src ? (
    <span className="video-preview-unavailable">视频 · 暂无预览</span>
  ) : (
    <video
      ref={preview}
      src={src}
      aria-label={label}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => seekPreviewFrame(event.currentTarget)}
      onLoadedData={(event) => seekPreviewFrame(event.currentTarget)}
      onProgress={(event) => seekPreviewFrame(event.currentTarget)}
      onCanPlay={(event) => seekPreviewFrame(event.currentTarget)}
      onError={() => setFailedUrl(src)}
    />
  );
}

/** Only transport controls consume pointers; the picture remains a drag surface. */
export function CanvasVideo({
  src,
  label,
  onLoaded,
  onError,
}: {
  src: string;
  label: string;
  onLoaded?: () => void;
  onError?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  return (
    <>
      <video
        ref={video}
        src={src}
        aria-label={label}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        disablePictureInPicture
        disableRemotePlayback
        onLoadStart={() => {
          setPlaying(false);
          setTime(0);
          setDuration(0);
        }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setDuration(Number.isFinite(element.duration) ? element.duration : 0);
          seekPreviewFrame(element);
        }}
        onLoadedData={(event) => {
          seekPreviewFrame(event.currentTarget);
          onLoaded?.();
        }}
        onError={onError}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
      />
      <fieldset
        className="canvas-video-controls nodrag nopan nowheel"
        aria-label="视频播放控制"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={playing ? "暂停视频" : "播放视频"}
          onClick={() => {
            if (playing) video.current?.pause();
            else void video.current?.play().catch(() => setPlaying(false));
          }}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <input
          type="range"
          aria-label="视频播放进度"
          min={0}
          max={duration || 1}
          step={0.05}
          value={Math.min(time, duration || 1)}
          disabled={!duration}
          onChange={(event) => {
            if (video.current) video.current.currentTime = Number(event.target.value);
          }}
        />
        <span>
          {Math.floor(time)} / {Math.ceil(duration)}s
        </span>
        <button
          type="button"
          aria-label={muted ? "开启视频声音" : "静音视频"}
          onClick={() => setMuted((current) => !current)}
        >
          {muted ? "静音" : "声音"}
        </button>
        <a href={src} target="_blank" rel="noreferrer" aria-label="打开原视频">
          ↗
        </a>
      </fieldset>
    </>
  );
}
