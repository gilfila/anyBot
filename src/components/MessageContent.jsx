import React, { useState, useMemo } from "react";
import { Code, FileText, ExternalLink, ChevronDown, ChevronUp, Eye } from "lucide-react";
import { TABLE_ROW, TABLE_RULE, renderMarkdownInline, tableCells } from "../lib/markdown.js";

const HTML_PATTERN = /^\s*<!doctype\s+html|^\s*<html[\s>]/i;
const CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;
const HTML_TAG_PATTERN = /<[a-z][\s\S]*?>/i;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/gm;
const LIST_ITEM_PATTERN = /^(\s*)[-*]\s+(.+)$/gm;

const MAX_INLINE_HTML_LENGTH = 2000;
const MAX_INLINE_CODE_LENGTH = 5000;

function isFullHtmlDocument(text) {
  return HTML_PATTERN.test(text.trim());
}

function hasSignificantHtml(text) {
  const tagMatches = text.match(/<[a-z][^>]*>/gi) || [];
  return tagMatches.length > 5;
}

function extractCodeBlocks(text) {
  const blocks = [];
  let match;
  const regex = new RegExp(CODE_BLOCK_PATTERN.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      full: match[0],
      language: match[1] || 'plaintext',
      code: match[2],
      index: match.index
    });
  }
  return blocks;
}

function CodeBlock({ language, code, onPreview }) {
  const [collapsed, setCollapsed] = useState(code.length > MAX_INLINE_CODE_LENGTH);
  const displayCode = collapsed ? code.slice(0, 500) + '\n... (truncated)' : code;
  const isHtmlLike = language === 'html' || language === 'htm' || 
    (language === 'plaintext' && isFullHtmlDocument(code));
  
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-language">
          <Code size={12} />
          {language}
        </span>
        <div className="code-block-actions">
          {isHtmlLike && (
            <button 
              className="code-action" 
              onClick={() => onPreview?.(code, 'html')}
              title="Preview HTML"
            >
              <Eye size={12} />
              Preview
            </button>
          )}
          {code.length > MAX_INLINE_CODE_LENGTH && (
            <button className="code-action" onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </div>
      </div>
      <pre><code>{displayCode}</code></pre>
    </div>
  );
}

function HtmlPreviewCard({ html, onPreview }) {
  const preview = useMemo(() => {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : 'HTML Document';
    const size = new Blob([html]).size;
    return { title, size };
  }, [html]);

  return (
    <div className="html-preview-card">
      <div className="html-preview-icon">
        <FileText size={24} />
      </div>
      <div className="html-preview-info">
        <strong>{preview.title}</strong>
        <small>{Math.ceil(preview.size / 1024)} KB HTML document</small>
      </div>
      <button className="secondary html-preview-button" onClick={() => onPreview?.(html, 'html')}>
        <Eye size={14} />
        Open Preview
      </button>
    </div>
  );
}

function MarkdownText({ text, people }) {
  const lines = text.split('\n');
  const elements = [];
  let list = null;
  let quote = [];

  const inline = (value) => ({ __html: renderMarkdownInline(value, { people }) });
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    elements.push(
      <Tag key={`list-${elements.length}`} start={list.ordered ? list.start : undefined}>
        {list.items.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={inline(item)} />
        ))}
      </Tag>
    );
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    elements.push(
      <blockquote key={`quote-${elements.length}`}>
        {quote.map((line, i) => (
          <p key={i} dangerouslySetInnerHTML={inline(line)} />
        ))}
      </blockquote>
    );
    quote = [];
  };
  const flush = () => {
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] || "")) {
      flush();
      const [head, ...body] = [tableCells(line), ...(() => {
        const rows = [];
        i += 2;
        while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(tableCells(lines[i++]));
        i -= 1;
        return rows;
      })()];
      elements.push(
        <div className="md-table" key={`table-${i}`}>
          <table>
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th key={c} dangerouslySetInnerHTML={inline(cell)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {head.map((_, c) => (
                    <td key={c} dangerouslySetInnerHTML={inline(row[c] || "")} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1].length;
      const Tag = `h${Math.min(level + 2, 6)}`;
      elements.push(<Tag key={i} dangerouslySetInnerHTML={inline(headingMatch[2])} />);
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (bulletMatch || orderedMatch) {
      flushQuote();
      const ordered = Boolean(orderedMatch);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, start: ordered ? Number(orderedMatch[1]) : 1, items: [] };
      list.items.push(ordered ? orderedMatch[2] : bulletMatch[1]);
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    flush();
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      elements.push(<hr key={i} />);
    } else if (line.trim() !== '') {
      elements.push(<p key={i} dangerouslySetInnerHTML={inline(line)} />);
    }
  }

  flush();
  return <div className="markdown-content">{elements}</div>;
}

// `people`: bot names to highlight where the message @mentions them.
export function MessageContent({ body, onOpenPreview, onOpenBrowser, people = [] }) {
  const content = useMemo(() => {
    if (!body || typeof body !== 'string') {
      return { type: 'text', content: String(body || '') };
    }

    const trimmed = body.trim();

    if (isFullHtmlDocument(trimmed)) {
      if (trimmed.length > MAX_INLINE_HTML_LENGTH) {
        return { type: 'html-preview', content: trimmed };
      }
      return { type: 'html-inline', content: trimmed };
    }

    const codeBlocks = extractCodeBlocks(trimmed);
    if (codeBlocks.length > 0) {
      return { type: 'mixed', content: trimmed, codeBlocks };
    }

    if (hasSignificantHtml(trimmed)) {
      return { type: 'html-inline', content: trimmed };
    }

    return { type: 'markdown', content: trimmed };
  }, [body]);

  // Previews always go through the sandboxed srcdoc modal. A same-origin blob:
  // URL would give employee HTML access to window.anybot.
  const handlePreview = (html, type) => {
    onOpenPreview?.(html, type);
  };

  if (content.type === 'html-preview') {
    return <HtmlPreviewCard html={content.content} onPreview={handlePreview} />;
  }

  if (content.type === 'html-inline') {
    return (
      <div className="html-inline-preview">
        <div className="html-preview-header">
          <FileText size={14} />
          <span>HTML Content</span>
          <button className="code-action" onClick={() => handlePreview(content.content, 'html')}>
            <ExternalLink size={12} />
            Open in Browser
          </button>
        </div>
        <div 
          className="html-sandboxed"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(content.content) }}
        />
      </div>
    );
  }

  if (content.type === 'mixed') {
    const parts = [];
    let lastIndex = 0;

    for (const block of content.codeBlocks) {
      if (block.index > lastIndex) {
        const textBefore = content.content.slice(lastIndex, block.index);
        if (textBefore.trim()) {
          parts.push(
            <MarkdownText key={`text-${lastIndex}`} text={textBefore} people={people} />
          );
        }
      }
      parts.push(
        <CodeBlock 
          key={`code-${block.index}`}
          language={block.language}
          code={block.code}
          onPreview={handlePreview}
        />
      );
      lastIndex = block.index + block.full.length;
    }

    if (lastIndex < content.content.length) {
      const textAfter = content.content.slice(lastIndex);
      if (textAfter.trim()) {
        parts.push(
          <MarkdownText key={`text-${lastIndex}`} text={textAfter} people={people} />
        );
      }
    }

    return <div className="mixed-content">{parts}</div>;
  }

  if (content.type === 'markdown') {
    return <MarkdownText text={content.content} people={people} />;
  }

  return <span>{content.content}</span>;
}

// Elements that can run code, load remote documents, restyle the whole app,
// or submit data. Rendered inline inside the app's own document, so this is
// an allowlist-by-exclusion backed by the page CSP (no inline script).
const BLOCKED_ELEMENTS =
  'script, style, link, meta, base, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, template, portal';
const URL_ATTRIBUTES = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'cite', 'srcset']);
const SAFE_URL_PATTERN = /^(https?:|mailto:|#|data:image\/(png|gif|jpe?g|webp);)/i;

function sanitizeHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll(BLOCKED_ELEMENTS).forEach((el) => el.remove());

  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      // Browsers ignore whitespace and control characters inside URL schemes.
      const value = attr.value.replace(/[\u0000- ]/g, '');
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        (URL_ATTRIBUTES.has(name) && value && !SAFE_URL_PATTERN.test(value))
      ) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return doc.body.innerHTML;
}

export default MessageContent;
