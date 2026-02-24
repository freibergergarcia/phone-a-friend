/**
 * Message feed component — chronological message timeline with turn separators.
 */

// eslint-disable-next-line no-unused-vars
const MessageFeed = {
  /**
   * Render a full transcript (historical view).
   */
  render(messages, container) {
    if (!messages || messages.length === 0) {
      container.innerHTML = '<div class="empty-state">No messages recorded</div>';
      return;
    }

    let lastTurn = -1;
    const html = [];

    for (const msg of messages) {
      // Turn separator
      if (msg.turn !== lastTurn) {
        html.push(`<div class="turn-separator">Turn ${msg.turn}</div>`);
        lastTurn = msg.turn;
      }

      html.push(MessageFeed.renderMessage(msg, false));
    }

    container.innerHTML = html.join('');
    MessageFeed.scrollToBottom(container);
  },

  /**
   * Append a single message (live mode).
   */
  appendMessage(container, msg, currentTurn) {
    // Check if we need a turn separator
    if (msg.turn !== undefined && msg.turn !== currentTurn) {
      const sep = document.createElement('div');
      sep.className = 'turn-separator';
      sep.textContent = `Turn ${msg.turn}`;
      container.appendChild(sep);
    }

    const div = document.createElement('div');
    div.innerHTML = MessageFeed.renderMessage(msg, true);
    const el = div.firstElementChild;
    container.appendChild(el);

    MessageFeed.scrollToBottom(container);
    return msg.turn;
  },

  /**
   * Append a guardrail alert.
   */
  appendGuardrail(container, guard, detail) {
    const div = document.createElement('div');
    const isError = guard === 'timeout' || guard === 'max_turns';
    div.className = `guardrail-alert${isError ? ' error' : ''}`;
    div.textContent = `${guard}: ${detail}`;
    container.appendChild(div);
    MessageFeed.scrollToBottom(container);
  },

  /**
   * Render a single message to HTML string.
   */
  renderMessage(msg, isNew) {
    const fromColor = AgentCard.getColor(msg.from);
    const toColor = msg.to === 'user' ? -1 : AgentCard.getColor(msg.to);
    const time = MessageFeed.formatTime(msg.timestamp);
    const content = MessageFeed.escape(msg.content || '');
    const isLong = content.length > 200;
    const newClass = isNew ? ' new' : '';

    return `
      <div class="message${newClass} border-color-${fromColor}">
        <div class="message-header">
          <span class="message-from agent-color-${fromColor}">${MessageFeed.escape(msg.from)}</span>
          <span class="message-arrow">\u2192</span>
          <span class="message-to ${toColor >= 0 ? `agent-color-${toColor}` : ''}">${MessageFeed.escape(msg.to)}</span>
          <span class="message-turn">T${msg.turn ?? 0}</span>
          <span class="message-time">${time}</span>
        </div>
        <div class="message-content${isLong ? '' : ' expanded'}" onclick="this.classList.toggle('expanded')">${content}</div>
        ${isLong ? '<span class="message-expand" onclick="this.previousElementSibling.classList.toggle(\'expanded\'); this.textContent = this.previousElementSibling.classList.contains(\'expanded\') ? \'collapse\' : \'expand\'">expand</span>' : ''}
      </div>
    `;
  },

  /**
   * Update turn info bar.
   */
  renderTurnInfo(container, session) {
    const elapsed = session.endedAt
      ? ((new Date(session.endedAt) - new Date(session.createdAt)) / 1000).toFixed(1) + 's'
      : 'running...';

    const totalMessages = (session.agents || []).reduce((sum, a) => sum + (a.messageCount ?? 0), 0);

    container.innerHTML = `
      <span>Turn <span class="turn-stat-value">${session.turn ?? 0}</span></span>
      <span>Messages <span class="turn-stat-value">${totalMessages}</span></span>
      <span>Agents <span class="turn-stat-value">${(session.agents || []).length}</span></span>
      <span>Elapsed <span class="turn-stat-value">${elapsed}</span></span>
      <span>Status <span class="turn-stat-value">${session.status || 'unknown'}</span></span>
    `;
  },

  formatTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  },

  scrollToBottom(container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  },

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
