import React, { useState, useMemo } from "react";
import { Code, FileText, ExternalLink, ChevronDown, ChevronUp, Eye } from "lucide-react";

const HTML_PATTERN = /^\s*<!doctype\s+html|^\s*<html[\s>]/i;
const CODE_BLOCK_PATTERN = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_PATTERN = /`([^`]+)`/g;
const HTML_TAG_PATTERN = /<[a-z][\s\S]*?>/i;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const ITALIC_PATTERN = /\*([^*]+)\*/g;
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

function renderMarkdownInline(text) {
  let result = text;
  result = result.replace(LINK_PATTERN, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  result = result.replace(BOLD_PATTERN, '<strong>$1</strong>');
  result = result.replace(ITALIC_PATTERN, '<em>$1</em>');
  result = result.replace(INLINE_CODE_PATTERN, '<code>$1</code>');
  return result;
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

function MarkdownText({ text }) {
  const lines = text.split('\n');
  const elements = [];
  let listItems = [];
  let inList = false;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`}>
          {listItems.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: renderMarkdownInline(item) }} />
          ))}
        </ul>
      );
      listItems = [];
    }
    inList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const Tag = `h${Math.min(level + 2, 6)}`;
      elements.push(
        <Tag key={i} dangerouslySetInnerHTML={{ __html: renderMarkdownInline(headingMatch[2]) }} />
      );
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      inList = true;
      listItems.push(listMatch[1]);
      continue;
    }

    if (inList && line.trim() === '') {
      flushList();
      continue;
    }

    if (inList) {
      flushList();
    }

    if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <p key={i} dangerouslySetInnerHTML={{ __html: renderMarkdownInline(line) }} />
      );
    }
  }

  flushList();
  return <div className="markdown-content">{elements}</div>;
}

export function MessageContent({ body, onOpenPreview, onOpenBrowser }) {
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

  const handlePreview = (html, type) => {
    if (onOpenPreview) {
      onOpenPreview(html, type);
    } else if (onOpenBrowser) {
      const blob = new Blob([html], { type: 'text/html' });
      onOpenBrowser(URL.createObjectURL(blob));
    }
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
            <MarkdownText key={`text-${lastIndex}`} text={textBefore} />
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
          <MarkdownText key={`text-${lastIndex}`} text={textAfter} />
        );
      }
    }

    return <div className="mixed-content">{parts}</div>;
  }

  if (content.type === 'markdown') {
    return <MarkdownText text={content.content} />;
  }

  return <span>{content.content}</span>;
}

function sanitizeHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const scripts = doc.querySelectorAll('script');
  scripts.forEach(s => s.remove());
  
  const elements = doc.querySelectorAll('*');
  elements.forEach(el => {
    const attrs = [...el.attributes];
    attrs.forEach(attr => {
      if (attr.name.startsWith('on') || 
          (attr.name === 'href' && attr.value.startsWith('javascript:')) ||
          (attr.name === 'src' && attr.value.startsWith('javascript:'))) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}

export default MessageContent;
