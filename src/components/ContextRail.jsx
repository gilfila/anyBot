import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe,
  Terminal as TerminalIcon,
  FolderTree,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  File,
  Folder,
  Play,
  Square,
  FolderOpen,
  FileText,
  Monitor,
  Workflow,
  ShieldCheck,
  Users,
} from "lucide-react";
import { RobotAvatar } from "./RobotAvatar.jsx";
import { ProjectDoc } from "./doc/ProjectDoc.jsx";

export function ContextRail({
  open,
  conversation,
  employees,
  activeRuns,
  artifacts,
  conversationId,
  harnessName,
  onOpenArtifact,
  onRevealArtifact,
  data,
  act,
  onOpenTask,
  onExpandCanvas,
  activeToolsTab,
  onToolsTabChange,
  browserUrl,
  browserHtml,
  explorerPath,
  onBrowserNavigate,
  onExplorerSelect,
}) {
  const [activeTab, setActiveTab] = useState("context");

  useEffect(() => {
    if (activeToolsTab) {
      setActiveTab("tools");
    }
  }, [activeToolsTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab !== "tools") {
      onToolsTabChange(null);
    }
  };

  if (!open) return null;

  return (
    <aside className={`context-rail${activeTab === "canvas" ? " is-canvas" : ""}`}>
      <div className="context-rail-tabs">
        <button
          className={activeTab === "context" ? "active" : ""}
          onClick={() => handleTabChange("context")}
        >
          <Users size={14} />
          Context
        </button>
        <button
          className={activeTab === "canvas" ? "active" : ""}
          onClick={() => handleTabChange("canvas")}
        >
          <FileText size={14} />
          Canvas
        </button>
        <button
          className={activeTab === "tools" ? "active" : ""}
          onClick={() => handleTabChange("tools")}
        >
          <TerminalIcon size={14} />
          Tools
        </button>
      </div>
      
      <div className="context-rail-content">
        {activeTab === "context" && (
          <ContextTab
            conversation={conversation}
            employees={employees}
            activeRuns={activeRuns}
            harnessName={harnessName}
          />
        )}
        {activeTab === "canvas" && conversation && data && (
          <ProjectDoc
            compact
            conversation={conversation}
            data={data}
            act={act}
            onOpenTask={onOpenTask}
            onOpenArtifact={onOpenArtifact}
            onRevealArtifact={onRevealArtifact}
            onExpand={onExpandCanvas}
          />
        )}
        {activeTab === "tools" && (
          <ToolsTab
            activePanel={activeToolsTab}
            onPanelChange={onToolsTabChange}
            browserUrl={browserUrl}
            browserHtml={browserHtml}
            explorerPath={explorerPath}
            onBrowserNavigate={onBrowserNavigate}
            onExplorerSelect={onExplorerSelect}
          />
        )}
      </div>
    </aside>
  );
}

function ContextTab({ conversation, employees, activeRuns, harnessName }) {
  return (
    <div className="context-tab-content">
      <div className="eyebrow">IN THIS CONVERSATION</div>
      {conversation?.members.map((id) => {
        const e = employees.find((emp) => emp.id === id);
        const isWorking = activeRuns?.some((r) => r.employee === id);
        return (
          <div className="participant" key={id}>
            <RobotAvatar size={46} employee={e} working={isWorking} />
            <div>
              <strong>{e?.name}</strong>
              <small>{e?.role}</small>
              <span>{harnessName(e?.harness)}</span>
            </div>
          </div>
        );
      })}
      <div className="context-divider" />
      <div className="eyebrow">HOW WORK HAPPENS</div>
      <p>
        Each employee runs in their own workspace. Handoffs stay within
        this conversation.
      </p>
      <div className="detail-line">
        <Workflow size={15} />
        Up to 8 runs per task
      </div>
      <div className="detail-line">
        <Monitor size={15} />
        Runs on this computer
      </div>
      <div className="detail-line">
        <ShieldCheck size={15} />
        Trusted local execution
      </div>
    </div>
  );
}

function ToolsTab({
  activePanel,
  onPanelChange,
  browserUrl,
  browserHtml,
  explorerPath,
  onBrowserNavigate,
  onExplorerSelect,
}) {
  const [localPanel, setLocalPanel] = useState(activePanel || "browser");

  useEffect(() => {
    if (activePanel) {
      setLocalPanel(activePanel);
    }
  }, [activePanel]);

  const handlePanelChange = (panel) => {
    setLocalPanel(panel);
    onPanelChange(panel);
  };

  return (
    <div className="tools-tab-content">
      <div className="tools-subtabs">
        <button
          className={localPanel === "browser" ? "active" : ""}
          onClick={() => handlePanelChange("browser")}
        >
          <Globe size={14} />
          Browser
        </button>
        <button
          className={localPanel === "terminal" ? "active" : ""}
          onClick={() => handlePanelChange("terminal")}
        >
          <TerminalIcon size={14} />
          Terminal
        </button>
        <button
          className={localPanel === "files" ? "active" : ""}
          onClick={() => handlePanelChange("files")}
        >
          <FolderTree size={14} />
          Files
        </button>
      </div>
      <div className="tools-panel-content">
        {localPanel === "browser" && (
          <BrowserPanel
            initialUrl={browserUrl}
            htmlContent={browserHtml}
            onNavigate={onBrowserNavigate}
          />
        )}
        {localPanel === "terminal" && (
          <TerminalPanel onRun={() => {}} />
        )}
        {localPanel === "files" && (
          <FileExplorerPanel
            initialPath={explorerPath}
            onSelect={onExplorerSelect}
          />
        )}
      </div>
    </div>
  );
}

const PREVIEW_URL = "about:preview";
const isWebUrl = (value) => /^https?:\/\//i.test(value || "");

function BrowserPanel({ initialUrl, htmlContent, onNavigate }) {
  const [url, setUrl] = useState(htmlContent ? PREVIEW_URL : initialUrl || "");
  const [currentUrl, setCurrentUrl] = useState(htmlContent ? PREVIEW_URL : initialUrl || "");
  const [history, setHistory] = useState(htmlContent ? [PREVIEW_URL] : []);
  const [historyIndex, setHistoryIndex] = useState(htmlContent ? 0 : -1);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef(null);

  // Employee HTML handed over from a preview. Rendered through srcdoc in an
  // opaque-origin sandbox (see the iframe below), never a same-origin blob.
  useEffect(() => {
    if (htmlContent && currentUrl !== PREVIEW_URL) navigateTo(PREVIEW_URL);
  }, [htmlContent]);

  useEffect(() => {
    if (initialUrl && initialUrl !== currentUrl) {
      navigateTo(initialUrl);
    }
  }, [initialUrl]);

  const navigateTo = useCallback(
    (targetUrl) => {
      if (!targetUrl) return;

      let normalizedUrl = targetUrl.trim();
      if (normalizedUrl !== PREVIEW_URL && !isWebUrl(normalizedUrl)) {
        normalizedUrl =
          "https://" +
          normalizedUrl.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|file|blob|vbscript):)/i, "");
      }

      setCurrentUrl(normalizedUrl);
      setUrl(targetUrl);
      setLoading(normalizedUrl !== PREVIEW_URL);

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(normalizedUrl);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      onNavigate?.(normalizedUrl);
    },
    [history, historyIndex, onNavigate]
  );

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
    if (!currentUrl) return;
    if (currentUrl !== PREVIEW_URL) setLoading(true);
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="rail-browser-panel">
      <div className="rail-browser-toolbar">
        <button
          className="rail-nav-btn"
          onClick={goBack}
          disabled={historyIndex <= 0}
          title="Back"
        >
          <ArrowLeft size={12} />
        </button>
        <button
          className="rail-nav-btn"
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          title="Forward"
        >
          <ArrowRight size={12} />
        </button>
        <button className="rail-nav-btn" onClick={refresh} title="Refresh">
          <RefreshCw size={12} className={loading ? "spinning" : ""} />
        </button>
      </div>
      <form className="rail-browser-url-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Enter URL..."
          className="rail-browser-url-input"
        />
      </form>
      <div className="rail-browser-viewport">
        {currentUrl === PREVIEW_URL && htmlContent ? (
          <iframe
            key={`preview-${reloadKey}`}
            ref={iframeRef}
            srcDoc={htmlContent}
            sandbox="allow-scripts"
            title="HTML preview"
          />
        ) : isWebUrl(currentUrl) ? (
          // Remote sites keep their own (cross) origin, so allow-same-origin
          // does not give them access to this window.
          <iframe
            key={`web-${reloadKey}`}
            ref={iframeRef}
            src={currentUrl}
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => setLoading(false)}
            title="Browser Preview"
          />
        ) : (
          <div className="rail-browser-empty">
            <Globe size={32} />
            <p>Enter a URL or preview HTML from agent outputs</p>
          </div>
        )}
      </div>
      {isWebUrl(currentUrl) && (
        <button
          className="rail-external-btn"
          onClick={() => window.anybot?.openUrl?.(currentUrl)}
          title="Open in external browser"
        >
          <ExternalLink size={12} />
          Open external
        </button>
      )}
    </div>
  );
}

function TerminalPanel({ onRun }) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [currentOutput, setCurrentOutput] = useState("");
  const outputRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history, currentOutput]);

  const runCommand = async () => {
    if (!command.trim() || running) return;

    const cmd = command.trim();
    setCommand("");
    setRunning(true);
    setCurrentOutput("");

    const entry = {
      command: cmd,
      output: "",
      status: "running",
      timestamp: new Date().toLocaleTimeString(),
    };
    setHistory((prev) => [...prev, entry]);

    try {
      if (window.anybot?.runCommand) {
        const result = await window.anybot.runCommand(cmd, (chunk) => {
          setCurrentOutput((prev) => prev + chunk);
        });
        setHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...entry,
            output: result.output || currentOutput,
            status: result.exitCode === 0 ? "success" : "error",
            exitCode: result.exitCode,
          };
          return updated;
        });
      } else {
        setHistory((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...entry,
            output: "Terminal requires desktop runtime.",
            status: "error",
          };
          return updated;
        });
      }
    } catch (error) {
      setHistory((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...entry,
          output: String(error.message),
          status: "error",
        };
        return updated;
      });
    } finally {
      setRunning(false);
      setCurrentOutput("");
      onRun?.(cmd);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runCommand();
    }
  };

  return (
    <div className="rail-terminal-panel">
      <div className="rail-terminal-output" ref={outputRef}>
        {history.length === 0 && !running && (
          <div className="rail-terminal-welcome">
            <TerminalIcon size={24} />
            <p>Run commands in your workspace</p>
          </div>
        )}
        {history.map((entry, i) => (
          <div key={i} className={`rail-terminal-entry ${entry.status}`}>
            <div className="rail-terminal-prompt">
              <span className="rail-terminal-cmd">$ {entry.command}</span>
            </div>
            {entry.output && (
              <pre className="rail-terminal-result">{entry.output}</pre>
            )}
            {entry.status === "running" && currentOutput && (
              <pre className="rail-terminal-result streaming">{currentOutput}</pre>
            )}
          </div>
        ))}
        {running && !currentOutput && (
          <div className="rail-terminal-running">
            <span className="rail-terminal-spinner" />
            Running...
          </div>
        )}
      </div>
      <div className="rail-terminal-input-row">
        <span className="rail-terminal-prompt-symbol">$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command..."
          className="rail-terminal-input"
          disabled={running}
        />
        <button
          className={`rail-terminal-run-btn ${running ? "running" : ""}`}
          onClick={running ? undefined : runCommand}
          disabled={running || !command.trim()}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
        </button>
      </div>
    </div>
  );
}

function FileExplorerPanel({ initialPath, onSelect }) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      setError("File explorer requires desktop runtime.");
      return;
    }

    setLoading(true);
    setError("");

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
      setError("Directory picker requires desktop runtime.");
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

  const navigateUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split(/[/\\]/);
    parts.pop();
    const parent = parts.join("/") || "/";
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

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="rail-file-explorer-panel">
      <div className="rail-file-explorer-toolbar">
        <button
          className="rail-file-btn"
          onClick={navigateUp}
          disabled={!currentPath}
          title="Go up"
        >
          <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="rail-file-path" title={currentPath}>
          {currentPath ? (
            <span>{currentPath.split(/[/\\]/).pop() || currentPath}</span>
          ) : (
            <span className="muted">No directory</span>
          )}
        </div>
        <button className="rail-file-btn" onClick={handleSelect} title="Browse">
          <Folder size={12} />
        </button>
        <button
          className="rail-file-btn"
          onClick={() => currentPath && loadDirectory(currentPath)}
          disabled={!currentPath || loading}
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? "spinning" : ""} />
        </button>
      </div>

      <div className="rail-file-content">
        {error && <div className="rail-file-error">{error}</div>}

        {!currentPath && !error && (
          <div className="rail-file-empty">
            <FolderTree size={32} />
            <p>Browse files in workspace</p>
            <button className="rail-browse-btn" onClick={handleSelect}>
              <Folder size={12} />
              Choose Directory
            </button>
          </div>
        )}

        {currentPath && !error && (
          <div className="rail-file-tree">
            {loading ? (
              <div className="rail-file-loading">Loading...</div>
            ) : sortedEntries.length === 0 ? (
              <div className="rail-file-empty-dir">Empty directory</div>
            ) : (
              sortedEntries.map((entry) => (
                <button
                  key={entry.path}
                  className={`rail-file-item ${entry.isDirectory ? "directory" : "file"}`}
                  onClick={() => {
                    if (entry.isDirectory) {
                      setCurrentPath(entry.path);
                      onSelect?.(entry.path);
                    } else {
                      openInSystem(entry.path);
                    }
                  }}
                >
                  {entry.isDirectory ? <Folder size={14} /> : <File size={14} />}
                  <span className="rail-file-name">{entry.name}</span>
                  {!entry.isDirectory && entry.size && (
                    <span className="rail-file-size">{formatFileSize(entry.size)}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ContextRail;
