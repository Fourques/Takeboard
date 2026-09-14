import { useState } from "react";
import { seekPreviewFrame } from "./video-preview";

/** One natural-ratio preview for asset, node and generation details. Never crops media. */
export function DetailMedia({ src, kind, label }: { src: string; kind: string; label: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <div className="detail-media">
      {failedSource === src ? (
        <p role="status">无法预览此文件，请下载后查看。</p>
      ) : kind === "video" ? (
        <video
          key={src}
          src={src}
          aria-label={label}
          controls
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => seekPreviewFrame(event.currentTarget)}
          onLoadedData={(event) => seekPreviewFrame(event.currentTarget)}
          onProgress={(event) => seekPreviewFrame(event.currentTarget)}
          onError={() => setFailedSource(src)}
        />
      ) : kind === "audio" ? (
        // biome-ignore lint/a11y/useMediaCaption: Imported audio may not provide a transcript.
        <audio
          key={src}
          src={src}
          aria-label={label}
          controls
          preload="metadata"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <img src={src} alt={label} onError={() => setFailedSource(src)} />
      )}
    </div>
  );
}
