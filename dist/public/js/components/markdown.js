/**
 * Lightweight markdown renderer for the dashboard.
 * Handles: code blocks, inline code, bold, italic, headers, lists, links, blockquotes.
 * Input is raw text (NOT pre-escaped). Output is safe HTML.
 */

// eslint-disable-next-line no-unused-vars
const Markdown = {
  /**
   * Render markdown text to HTML. Escapes HTML entities first for safety,
   * then applies markdown transformations.
   */
  render(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const out = [];
    let inCode = false;
    let codeLang = '';
    let codeLines = [];
    let inList = false;
    let listType = ''; // 'ul' or 'ol'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Fenced code blocks
      if (line.trimStart().startsWith('```')) {
        if (!inCode) {
          Markdown._closeList(out, inList, listType);
          inList = false;
          inCode = true;
          codeLang = line.trimStart().slice(3).trim();
          codeLines = [];
        } else {
          const escaped = Markdown._esc(codeLines.join('\n'));
          const langAttr = codeLang ? ` data-lang="${Markdown._esc(codeLang)}"` : '';
          const langLabel = codeLang ? `<span class="md-code-lang">${Markdown._esc(codeLang)}</span>` : '';
          out.push(`<div class="md-code-block"${langAttr}>${langLabel}<pre><code>${escaped}</code></pre></div>`);
          inCode = false;
          codeLang = '';
          codeLines = [];
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      // Blank line — close list, add break
      if (line.trim() === '') {
        Markdown._closeList(out, inList, listType);
        inList = false;
        continue;
      }

      // Headers (# to ###)
      const hMatch = line.match(/^(#{1,3})\s+(.*)/);
      if (hMatch) {
        Markdown._closeList(out, inList, listType);
        inList = false;
        const level = hMatch[1].length;
        out.push(`<h${level + 2} class="md-h">${Markdown._inline(hMatch[2])}</h${level + 2}>`);
        continue;
      }

      // Blockquote
      if (line.trimStart().startsWith('> ')) {
        Markdown._closeList(out, inList, listType);
        inList = false;
        out.push(`<blockquote class="md-quote">${Markdown._inline(line.trimStart().slice(2))}</blockquote>`);
        continue;
      }

      // Unordered list: - or *
      const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          Markdown._closeList(out, inList, listType);
          out.push('<ul class="md-list">');
          inList = true;
          listType = 'ul';
        }
        out.push(`<li>${Markdown._inline(ulMatch[2])}</li>`);
        continue;
      }

      // Ordered list: 1. 2. etc.
      const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          Markdown._closeList(out, inList, listType);
          out.push('<ol class="md-list">');
          inList = true;
          listType = 'ol';
        }
        out.push(`<li>${Markdown._inline(olMatch[2])}</li>`);
        continue;
      }

      // Horizontal rule
      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        Markdown._closeList(out, inList, listType);
        inList = false;
        out.push('<hr class="md-hr">');
        continue;
      }

      // Table: detect | delimited rows
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        Markdown._closeList(out, inList, listType);
        inList = false;

        // Collect all consecutive table rows
        const tableRows = [line];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('|') && lines[j].trim().endsWith('|')) {
          tableRows.push(lines[j]);
          j++;
        }
        i = j - 1; // advance past table rows (loop will i++)

        out.push(Markdown._renderTable(tableRows));
        continue;
      }

      // Regular paragraph line
      Markdown._closeList(out, inList, listType);
      inList = false;
      out.push(`<p class="md-p">${Markdown._inline(line)}</p>`);
    }

    // Close any open code block
    if (inCode) {
      const escaped = Markdown._esc(codeLines.join('\n'));
      out.push(`<div class="md-code-block"><pre><code>${escaped}</code></pre></div>`);
    }

    Markdown._closeList(out, inList, listType);

    return out.join('\n');
  },

  /** Close an open list tag */
  _closeList(out, inList, listType) {
    if (inList) {
      out.push(listType === 'ol' ? '</ol>' : '</ul>');
    }
  },

  /** Process inline markdown: bold, italic, code, links */
  _inline(text) {
    let s = Markdown._esc(text);

    // Inline code (must be before bold/italic to avoid conflicts)
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

    // Bold + italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Strikethrough
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');

    // @mentions — highlight agent names
    s = s.replace(/@([\w.-]+)/g, '<span class="md-mention">@$1</span>');

    return s;
  },

  /** Render a pipe-delimited table */
  _renderTable(rows) {
    const parseRow = (row) =>
      row.trim().slice(1, -1).split('|').map((c) => c.trim());

    // Detect separator row (|---|---|)
    const isSep = (row) => /^\|[\s:|-]+\|$/.test(row.trim());

    const dataRows = rows.filter((r) => !isSep(r));
    if (dataRows.length === 0) return '';

    const header = parseRow(dataRows[0]);
    const body = dataRows.slice(1).map(parseRow);

    const thCells = header.map((c) => `<th>${Markdown._inline(c)}</th>`).join('');
    const bodyHtml = body.map((row) => {
      const cells = row.map((c) => `<td>${Markdown._inline(c)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<table class="md-table"><thead><tr>${thCells}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  },

  /** Escape HTML entities */
  _esc(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
