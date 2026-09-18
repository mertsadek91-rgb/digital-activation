'use client';

import React, { useRef, useState } from 'react';

import { useT } from '../../i18n/provider';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  dir: 'rtl' | 'ltr';
  disabled?: boolean;
}

export function RichTextEditor({ value, onChange, dir, disabled }: RichTextEditorProps) {
  const t = useT('editor');
  const [mode, setMode] = useState<'code' | 'preview'>('code');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const wrapSelection = (startTag: string, endTag: string) => {
    if (disabled || mode !== 'code') return;
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    const selectedText = text.substring(start, end);
    const newText =
      text.substring(0, start) + startTag + selectedText + endTag + text.substring(end);

    onChange(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + startTag.length,
        start + startTag.length + selectedText.length,
      );
    }, 0);
  };

  return (
    <div className="rte-container">
      <div className="rte-toolbar">
        <div className="rte-tools">
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<strong>', '</strong>')}
            title={t('bold')}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<em>', '</em>')}
            title={t('italic')}
          >
            <i>I</i>
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<p>', '</p>')}
            title={t('paragraph')}
          >
            P
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<h2>', '</h2>')}
            title={t('heading2')}
          >
            H2
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<h3>', '</h3>')}
            title={t('heading3')}
          >
            H3
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => wrapSelection('<ul>\n  <li>', '</li>\n</ul>')}
            title={t('list')}
          >
            ☰
          </button>
          <button
            type="button"
            disabled={disabled || mode === 'preview'}
            onClick={() => {
              const url = window.prompt(t('linkPrompt'));
              if (url) {
                wrapSelection('<a href="' + url + '" target="_blank" rel="noopener">', '</a>');
              }
            }}
            title={t('link')}
          >
            🔗
          </button>
        </div>
        <div className="rte-modes">
          <button
            type="button"
            className={mode === 'code' ? 'is-active' : ''}
            onClick={() => setMode('code')}
          >
            {t('modeCode')}
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'is-active' : ''}
            onClick={() => setMode('preview')}
          >
            {t('modePreview')}
          </button>
        </div>
      </div>

      {mode === 'code' ? (
        <textarea
          ref={textareaRef}
          value={value}
          dir={dir}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={10}
          className="rte-textarea"
        />
      ) : (
        <div
          className="rte-preview"
          dir={dir}
          dangerouslySetInnerHTML={{ __html: value || `<p>${t('emptyPreview')}</p>` }}
        />
      )}
    </div>
  );
}
