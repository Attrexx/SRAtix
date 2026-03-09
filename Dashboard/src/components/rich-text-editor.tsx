'use client';

import { useRef, useCallback, useEffect } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const TOOLBAR_BUTTONS = [
  { cmd: 'bold', icon: 'B', style: 'font-weight:700' },
  { cmd: 'italic', icon: 'I', style: 'font-style:italic' },
  { cmd: 'underline', icon: 'U', style: 'text-decoration:underline' },
  { cmd: 'insertUnorderedList', icon: '•', style: '' },
  { cmd: 'insertOrderedList', icon: '1.', style: '' },
] as const;

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);

  // Sync external value changes (initial load, reset) into the editor.
  // Skip if the editor itself triggered the change to prevent caret jumping.
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const el = editorRef.current;
    if (el && el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    isInternalUpdate.current = true;
    onChange(el.innerHTML);
  }, [onChange]);

  const exec = useCallback((cmd: string) => {
    document.execCommand(cmd, false);
    editorRef.current?.focus();
    handleInput();
  }, [handleInput]);

  const insertLink = useCallback(() => {
    const url = prompt('URL:');
    if (url) {
      document.execCommand('createLink', false, url);
      editorRef.current?.focus();
      handleInput();
    }
  }, [handleInput]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) {
      const clean = html.replace(/font-family\s*:[^;"']*(;|(?=[;"']))/gi, '');
      document.execCommand('insertHTML', false, clean);
    } else {
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    }
    handleInput();
  }, [handleInput]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 border-b"
        style={{
          background: 'var(--color-bg-muted)',
          borderColor: 'var(--color-border)',
        }}
      >
        {TOOLBAR_BUTTONS.map((btn) => (
          <button
            key={btn.cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(btn.cmd)}
            className="rounded px-2 py-0.5 text-sm hover:opacity-80"
            style={{
              color: 'var(--color-text)',
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              ...(btn.style ? { [btn.style.split(':')[0]]: btn.style.split(':')[1] } : {}),
            }}
            title={btn.cmd}
          >
            <span style={btn.style ? { [btn.style.split(':')[0]]: btn.style.split(':')[1] } : {}}>
              {btn.icon}
            </span>
          </button>
        ))}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertLink}
          className="rounded px-2 py-0.5 text-sm hover:opacity-80"
          style={{
            color: 'var(--color-text)',
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
          }}
          title="Link"
        >
          🔗
        </button>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className="min-h-[100px] px-3 py-2 text-sm outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-400 [&:empty]:before:pointer-events-none"
        style={{
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text)',
        }}
      />
    </div>
  );
}
