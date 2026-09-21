import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe,
  Terminal as TerminalIcon,
  FolderTree,
  X,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Home,
  File,
  Folder,
  Play,
  Square,
  FolderOpen,
} from "lucide-react";

export function WorkspaceTools({ 
  activePanel, 
  onClose, 
  browserUrl,
  browserHtml,
  terminalCommand,
  explorerPath,
  onBrowserNavigate,
  onTerminalRun,
  onExplorerSelect,
}) {
  if (!activePanel) return null;

  return (
    <div className="workspace-tools">
      <div className="workspace-tools-header">
        <div className="workspace-tools-tabs">
          <button 
            className={activePanel === 'browser' ? 'active' : ''}
            onClick={() => onClose('browser')}
          >
            <Globe size={14} />
            Browser
          </button>
          <button 
            className={activePanel === 'terminal' ? 'active' : ''}
            onClick={() => onClose('terminal')}
          >
            <TerminalIcon size={14} />
            Terminal
          </button>
          <button 
            className={activePanel === 'files' ? 'active' : ''}
            onClick={() => onClose('files')}
          >
            <FolderTree size={14} />
            Files
          </button>
        </div>
        <button className="workspace-tools-close" onClick={() => onClose(null)}>
          <X size={16} />
        </button>
      </div>
      <div className="workspace-tools-content">
        {activePanel === 'browser' && (
          <BrowserPanel 
            initialUrl={browserUrl}
            htmlContent={browserHtml}
            onNavigate={onBrowserNavigate}
          />
        )}
        {activePanel === 'terminal' && (
          <TerminalPanel 
            initialCommand={terminalCommand}
            onRun={onTerminalRun}
          />
        )}
        {activePanel === 'files' && (
          <FileExplorerPanel 
            initialPath={explorerPath}
            onSelect={onExplorerSelect}
          />
        )}
      </div>
    </div>
  );
}

function BrowserPanel({ initialUrl, htmlContent, onNavigate }) {
  const [url, setUrl] = useState(initialUrl || '');
  const [currentUrl, setCurrentUrl] = useState(initialUrl || '');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef(null);

  useEffect(() => {
    if (htmlContent && iframeRef.current) {
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      setCurrentUrl(blobUrl);
      setUrl('about:preview');
    }
  }, [htmlContent]);

  useEffect(() => {
    if (initialUrl && initialUrl !== currentUrl) {
      navigateTo(initialUrl);
    }
  }, [initialUrl]);

  const navigateTo = useCallback((targetUrl) => {
    if (!targetUrl) return;
    
    let normalizedUrl = targetUrl;
    if (!targetUrl.startsWith('http://') && 
        !targetUrl.startsWith('https://') && 
        !targetUrl.startsWith('blob:') &&
        !targetUrl.startsWith('about:')) {
      normalizedUrl = 'https://' + targetUrl;
    }
    
    setCurrentUrl(normalizedUrl);
    setUrl(targetUrl);
    setLoading(true);
    
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(normalizedUrl);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    onNavigate?.(normalizedUrl);
  }, [history, historyIndex, onNavigate]);

  const handleSubmit = (e) => {
    e.preventDefault();
    navigateTo(url);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCurrentUrl(history[historyIndex - 1]);
      setUrl(history[historyIndex - 1]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCurrentUrl(history[historyIndex + 1]);
      setUrl(history[historyIndex + 1]);
    }
  };

  const refresh = () => {
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = currentUrl;
    }
  };

  return (
    <div className="browser-panel">
      <div className="browser-toolbar">
        <button 
          className="browser-nav-btn" 
          onClick={goBack} 
          disabled={historyIndex <= 0}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button 
          className="browser-nav-btn" 
          onClick={goForward} 
          disabled={historyIndex >= history.length - 1}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button className="browser-nav-btn" onClick={refresh} title="Refresh">
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
        </button>
        <form className="browser-url-form" onSubmit={handleSubmit}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Enter URL or search..."
            className="browser-url-input"
          />
        </form>
        <button 
          className="browser-nav-btn" 
          onClick={() => window.open(currentUrl, '_blank')}
          title="Open in external browser"
        >
          <ExternalLink size={14} />
        </button>
      </div>
      <div className="browser-viewport">
        {currentUrl ? (
          <iframe
            ref={iframeRef}
            src={currentUrl}
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => setLoading(false)}
            title="Browser Preview"
          />
        ) : (
          <div className="browser-empty">
            <Globe size={48} />
            <h3>In-App Browser</h3>
            <p>Enter a URL above or preview HTML content from agent outputs</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TerminalPanel({ initialCommand, onRun }) {
  const [command, setCommand] = useState(initialCommand || '');
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [currentOutput, setCurrentOutput] = useState('');
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history, currentOutput]);

  const runCommand = async () => {
    if (!command.trim() || running) return;
    
    const cmd = command.trim();
    setCommand('');
    setRunning(true);
    setCurrentOutput('');
    
    const entry = { 
      command: cmd, 
      output: '', 
      status: 'running',
      timestamp: new Date().toLocaleTimeString()
    };
    setHistory(prev => [...prev, entry]);
    
    try {
      if (window.anybot?.runCommand) {
        const result = await window.anybot.runCommand(cmd, (chunk) => {
          setCurrentOutput(prev => prev + chunk);
        });
        setHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { 
            ...entry, 
            output: result.output || currentOutput,
            status: result.exitCode === 0 ? 'success' : 'error',
            exitCode: result.exitCode
          };
          return updated;
        });
      } else {
        setHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { 
            ...entry, 
            output: 'Terminal requires desktop runtime. Run npm start to use the terminal.',
            status: 'error'
          };
          return updated;
        });
      }
    } catch (error) {
      setHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { 
          ...entry, 
          output: String(error.message),
          status: 'error'
        };
        return updated;
      });
    } finally {
      setRunning(false);
      setCurrentOutput('');
      onRun?.(cmd);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runCommand();
    }
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-output" ref={outputRef}>
        {history.length === 0 && !running && (
          <div className="terminal-welcome">
            <TerminalIcon size={32} />
            <p>anyBot Terminal</p>
            <small>Run commands in your workspace. Type a command below.</small>
          </div>
        )}
        {history.map((entry, i) => (
          <div key={i} className={`terminal-entry ${entry.status}`}>
            <div className="terminal-prompt">
              <span className="terminal-time">{entry.timestamp}</span>
              <span className="terminal-cmd">$ {entry.command}</span>
            </div>
            {entry.output && (
              <pre className="terminal-result">{entry.output}</pre>
            )}
            {entry.status === 'running' && currentOutput && (
              <pre className="terminal-result streaming">{currentOutput}</pre>
            )}
          </div>
        ))}
        {running && !currentOutput && (
          <div className="terminal-running">
            <span className="terminal-spinner" />
            Running...
          </div>
        )}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt-symbol">$</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command..."
          className="terminal-input"
          disabled={running}
        />
        <button 
          className={`terminal-run-btn ${running ? 'running' : ''}`}
          onClick={running ? undefined : runCommand}
          disabled={running || !command.trim()}
        >
          {running ? <Square size={14} /> : <Play size={14} />}
        </button>
      </div>
    </div>
  );
}

function FileExplorerPanel({ initialPath, onSelect }) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedDirs, setExpandedDirs] = useState(new Set());

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath]);

  useEffect(() => {
    if (initialPath && initialPath !== currentPath) {
      setCurrentPath(initialPath);
    }
  }, [initialPath]);

  const loadDirectory = async (path) => {
    if (!window.anybot?.listDirectory) {
      setError('File explorer requires desktop runtime. Run npm start to browse files.');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const result = await window.anybot.listDirectory(path);
      setEntries(result.entries || []);
    } catch (err) {
      setError(String(err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async () => {
    if (!window.anybot?.chooseDirectory) {
      setError('Directory picker requires desktop runtime.');
      return;
    }
    
    try {
      const path = await window.anybot.chooseDirectory();
      if (path) {
        setCurrentPath(path);
        onSelect?.(path);
      }
    } catch (err) {
      setError(String(err.message));
    }
  };

  const toggleDir = (dirPath) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split(/[/\\]/);
    parts.pop();
    const parent = parts.join('/') || '/';
    setCurrentPath(parent);
    onSelect?.(parent);
  };

  const openInSystem = async (path) => {
    if (window.anybot?.revealPath) {
      await window.anybot.revealPath(path);
    }
  };

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="file-explorer-panel">
      <div className="file-explorer-toolbar">
        <button className="file-explorer-btn" onClick={navigateUp} disabled={!currentPath}>
          <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="file-explorer-path" title={currentPath}>
          <FolderOpen size={14} />
          <span>{currentPath || 'No directory selected'}</span>
        </div>
        <button className="file-explorer-btn" onClick={handleSelect}>
          <Folder size={14} />
          Browse
        </button>
        <button 
          className="file-explorer-btn" 
          onClick={() => currentPath && loadDirectory(currentPath)}
          disabled={!currentPath || loading}
        >
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
        </button>
      </div>
      
      <div className="file-explorer-content">
        {error && (
          <div className="file-explorer-error">{error}</div>
        )}
        
        {!currentPath && !error && (
          <div className="file-explorer-empty">
            <FolderTree size={48} />
            <h3>File Explorer</h3>
            <p>Browse files in your workspace</p>
            <button className="secondary" onClick={handleSelect}>
              <Folder size={14} />
              Choose Directory
            </button>
          </div>
        )}
        
        {currentPath && !error && (
          <div className="file-tree">
            {loading ? (
              <div className="file-explorer-loading">Loading...</div>
            ) : sortedEntries.length === 0 ? (
              <div className="file-explorer-empty-dir">
                <p>This directory is empty</p>
              </div>
            ) : (
              sortedEntries.map((entry) => (
                <div 
                  key={entry.path}
                  className={`file-tree-item ${entry.isDirectory ? 'directory' : 'file'}`}
                >
                  <button 
                    className="file-tree-item-btn"
                    onClick={() => {
                      if (entry.isDirectory) {
                        setCurrentPath(entry.path);
                        onSelect?.(entry.path);
                      } else {
                        openInSystem(entry.path);
                      }
                    }}
                  >
                    {entry.isDirectory ? (
                      expandedDirs.has(entry.path) ? 
                        <FolderOpen size={14} /> : 
                        <Folder size={14} />
                    ) : (
                      <File size={14} />
                    )}
                    <span className="file-tree-name">{entry.name}</span>
                    {!entry.isDirectory && entry.size && (
                      <span className="file-tree-size">
                        {formatFileSize(entry.size)}
                      </span>
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default WorkspaceTools;
