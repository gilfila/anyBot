import React, { useContext } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { matchArtifacts } from "../../lib/chat.js";
import { fileSize } from "../../lib/file-refs.js";
import { ChatContext } from "./ChatContext.js";

// The files a reply returned (its ```anybot-artifacts block), as cards.
// Clicking one opens the copy Any Bot stored (artifacts.preview); the folder
// button shows it in Explorer (artifacts.reveal). A listed file the run
// didn't collect says so; the "Files were not collected" notice says why.
export function ArtifactCards({ paths, artifacts }) {
  const chat = useContext(ChatContext);
  const items = matchArtifacts(paths, artifacts);
  return (
    <ul className="artifact-cards" aria-label="Files returned">
      {items.map(({ path, name, artifact }, index) => (
        <li key={`${path}:${index}`} className={artifact ? "artifact-card" : "artifact-card is-missing"} title={path}>
          {artifact && chat ? (
            <>
              <button type="button" className="artifact-card-main" onClick={() => chat.onOpenArtifact(artifact)}>
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
    </ul>
  );
}
