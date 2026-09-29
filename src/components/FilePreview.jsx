import React from "react";

// A file's contents in a modal, for artifacts (artifacts.preview) and file
// links in chat (files.preview): text in a <pre> (React text, never HTML),
// an image from a data: URL, or `fallback` when there's nothing to show.
// `children` renders under it (details and buttons).
export function FilePreview({ preview, name, fallback, children }) {
  const image = preview.kind === "image" && /^data:image\//.test(String(preview.url || ""));
  return (
    <div className="artifact-preview">
      {preview.kind === "text" ? (
        <>
          <pre>{preview.text}</pre>
          {preview.truncated && <p>Preview limited to the first 512 KB.</p>}
        </>
      ) : image ? (
        <img src={preview.url} alt={name} />
      ) : (
        <p>{fallback}</p>
      )}
      {children}
    </div>
  );
}
