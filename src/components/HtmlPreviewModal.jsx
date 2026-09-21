import React, { useRef, useEffect, useState } from "react";
import { X, ExternalLink, Download, Maximize2, Minimize2, Globe } from "lucide-react";

export function HtmlPreviewModal({ html, title, onClose, onOpenInBrowser }) {
  const iframeRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (html) {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [html]);

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (title || 'document').replace(/[^a-z0-9]/gi, '_') + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenInBrowser = () => {
    if (onOpenInBrowser) {
      onOpenInBrowser(html);
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const extractTitle = () => {
    if (title) return title;
    const match = html?.match(/<title>([^<]+)<\/title>/i);
    return match ? match[1] : 'HTML Preview';
  };

  return (
    <div className={`html-preview-modal-overlay ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className={`html-preview-modal ${isFullscreen ? 'fullscreen' : ''}`}>
        <div className="html-preview-modal-header">
          <div className="html-preview-modal-title">
            <Globe size={16} />
            <span>{extractTitle()}</span>
          </div>
          <div className="html-preview-modal-actions">
            <button 
              className="html-preview-action" 
              onClick={handleOpenInBrowser}
              title="Open in workspace browser"
            >
              <ExternalLink size={14} />
              Open in Browser
            </button>
            <button 
              className="html-preview-action" 
              onClick={handleDownload}
              title="Download HTML file"
            >
              <Download size={14} />
              Download
            </button>
            <button 
              className="html-preview-action icon-only" 
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button 
              className="html-preview-action icon-only close" 
              onClick={onClose}
              title="Close preview"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="html-preview-modal-content">
          {blobUrl && (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              sandbox="allow-scripts allow-same-origin"
              title="HTML Preview"
              className="html-preview-iframe"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default HtmlPreviewModal;
