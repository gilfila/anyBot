import React, { useContext, useEffect, useState } from "react";
import { Eye, FileText, FolderOpen } from "lucide-react";
import { matchArtifacts } from "../../lib/chat.js";
import { fileSize } from "../../lib/file-refs.js";
import { FloatingMenu } from "../FloatingMenu.jsx";
import { ChatContext } from "./ChatContext.js";

// The files a reply returned (its ```anybot-artifacts block), as cards.
// Clicking one opens the copy Any Bot stored (artifacts.preview); the folder
// button shows it in Explorer (artifacts.reveal). Like a file link, Shift+click
// shows it in its folder and right-click (or the Menu key) has both. A listed
// file the run didn't collect says so; the "Files were not collected" notice
// says why.
export function ArtifactCards({ paths, artifacts }) {
  const chat = useContext(ChatContext);
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return undefined;
    const away = (event) => {
      if (!event.target?.closest?.(".artifact-card-menu")) setMenu(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [menu]);
  const items = matchArtifacts(paths, artifacts);
  const openMenu = (event, artifact) => {
    event.preventDefault();
    setMenu({ el: event.currentTarget, artifact });
  };
  return (
    <ul className="artifact-cards" aria-label="Files returned">
      {items.map(({ path, name, artifact }, index) => (
        <li key={`${path}:${index}`} className={artifact ? "artifact-card" : "artifact-card is-missing"} title={path}>
          {artifact && chat ? (
            <>
              <button
                type="button"
                className="artifact-card-main"
                title={`${path}\nClick to preview · Shift+click to show in folder · Right-click for more`}
                onClick={(event) => (event.shiftKey ? chat.onRevealArtifact(artifact) : chat.onOpenArtifact(artifact))}
                onContextMenu={(event) => openMenu(event, artifact)}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) openMenu(event, artifact);
                }}
              >
                <FileText size={18} aria-hidden="true" />
                <span>
                  <strong>{name}</strong>
                  <small>{fileSize(artifact.bytes)}</small>
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Show ${name} in its folder`}
                title="Show in folder"
                onClick={() => chat.onRevealArtifact(artifact)}
              >
                <FolderOpen size={16} />
              </button>
            </>
          ) : (
            <span className="artifact-card-main">
              <FileText size={18} aria-hidden="true" />
              <span>
                <strong>{name}</strong>
                <small>{artifact ? fileSize(artifact.bytes) : "Not collected"}</small>
              </span>
            </span>
          )}
        </li>
      ))}
      {menu && (
        <FloatingMenu anchor={menu.el} label={`Actions for ${menu.artifact.name}`} onClose={() => setMenu(null)} className="bot-row-menu file-link-menu artifact-card-menu">
          {[
            ["Preview", Eye, chat.onOpenArtifact],
            ["Show in folder", FolderOpen, chat.onRevealArtifact],
          ].map(([label, Icon, act]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                act(menu.artifact);
              }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </FloatingMenu>
      )}
    </ul>
  );
}
