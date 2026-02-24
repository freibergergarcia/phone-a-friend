/**
 * Session list component — renders session rows.
 */

// eslint-disable-next-line no-unused-vars
const SessionList = {
  render(sessions, container) {
    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No agentic sessions yet.</p>
          <p style="margin-top: 8px; font-size: 11px; color: var(--text-muted)">
            Run one with: <code style="color: var(--accent)">phone-a-friend agentic run --agents reviewer:claude,critic:claude --prompt "..."</code>
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = sessions.map((s) => {
      const agents = (s.agents || []).map((a) => a.name).join(', ');
      const time = SessionList.formatTime(s.createdAt);
      const prompt = SessionList.truncate(s.prompt || '', 60);
      const statusClass = s.status || 'completed';
      const elapsed = SessionList.formatElapsed(s.createdAt, s.endedAt);
      const msgCount = (s.agents || []).reduce((sum, a) => sum + (a.messageCount ?? 0), 0);

      return `
        <div class="session-row" data-id="${s.id}" onclick="App.viewSession('${s.id}')">
          <span class="session-id">${s.id}</span>
          <span class="status-pill ${statusClass}">${s.status}</span>
          <span class="session-prompt">${SessionList.escape(prompt)}</span>
          <span class="session-meta-inline">
            <span class="meta-chip">${msgCount} msg</span>
            <span class="meta-chip">${elapsed}</span>
          </span>
          <span class="session-agents">${SessionList.escape(agents)}</span>
          <span class="session-time">${time}</span>
          <span class="session-actions">
            <button class="btn btn-sm btn-danger" onclick="App.deleteSession('${s.id}', event)" title="Delete session">&times;</button>
          </span>
        </div>
      `;
    }).join('');
  },

  formatTime(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  },

  truncate(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + '\u2026';
  },

  formatElapsed(startStr, endStr) {
    try {
      const start = new Date(startStr);
      const end = endStr ? new Date(endStr) : new Date();
      const sec = (end - start) / 1000;
      if (sec < 60) return sec.toFixed(1) + 's';
      if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.floor(sec % 60) + 's';
      return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    } catch {
      return '—';
    }
  },

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
