/**
 * Message feed component — chronological message timeline with turn separators
 * and grouped reasoning notes.
 */

// eslint-disable-next-line no-unused-vars
const MessageFeed = {
  /**
   * Render a full transcript (historical view) with notes grouped as reasoning.
   */
  render(messages, container, session) {
    if (!messages || messages.length === 0) {
      const hasDead = (session?.agents || []).some((a) => a.status === 'dead');
      const showReason = session?.status === 'failed' || session?.status === 'stopped' || hasDead;
      const reason = showReason
        ? `<p style="margin-top: 8px; font-size: 11px; color: var(--text-muted)">Session ${session.status}${session.endedAt ? ' after ' + ((new Date(session.endedAt) - new Date(session.createdAt)) / 1000).toFixed(1) + 's' : ''}. Agents may have timed out or errored before producing output.</p>`
        : '';
      container.innerHTML = `<div class="empty-state">
        <p>No messages recorded</p>
        ${reason}
      </div>`;
      return;
    }

    const groups = MessageFeed.groupMessages(messages);
    let lastTurn = -1;
    const html = [];

    for (const group of groups) {
      const primaryMsg = group.msg;

      if (primaryMsg.turn !== lastTurn) {
        html.push(`<div class="turn-separator">Turn ${primaryMsg.turn}</div>`);
        lastTurn = primaryMsg.turn;
      }

      if (group.notes) {
        html.push(MessageFeed.renderGrouped(group.msg, group.notes));
      } else {
        html.push(MessageFeed.renderMessage(group.msg, false));
      }
    }

    container.innerHTML = html.join('');
    MessageFeed.cleanupExpandButtons(container);
    MessageFeed.scrollToBottom(container);
  },

  /**
   * Group adjacent notes with their routed message from the same agent.
   * Handles both patterns: notes→routed (pre-reasoning) and routed→notes (post-reasoning).
   */
  groupMessages(messages) {
    const groups = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];
      const type = MessageFeed.classifyMessage(msg);

      if (type === 'notes') {
        // Collect consecutive notes from this agent
        const batch = [msg];
        let j = i + 1;
        while (j < messages.length &&
               messages[j].from === msg.from &&
               MessageFeed.classifyMessage(messages[j]) === 'notes') {
          batch.push(messages[j]);
          j++;
        }
        // If next message is routed from same agent, group as pre-reasoning
        if (j < messages.length &&
            messages[j].from === msg.from &&
            MessageFeed.classifyMessage(messages[j]) === 'routed') {
          groups.push({ msg: messages[j], notes: batch });
          i = j + 1;
        } else {
          for (const n of batch) groups.push({ msg: n });
          i = j;
        }
      } else if (type === 'routed') {
        // Check if immediately followed by notes from same agent (post-reasoning)
        const trailing = [];
        let j = i + 1;
        while (j < messages.length &&
               messages[j].from === msg.from &&
               MessageFeed.classifyMessage(messages[j]) === 'notes') {
          trailing.push(messages[j]);
          j++;
        }
        if (trailing.length > 0) {
          groups.push({ msg, notes: trailing });
          i = j;
        } else {
          groups.push({ msg });
          i++;
        }
      } else {
        groups.push({ msg });
        i++;
      }
    }

    return groups;
  },

  /**
   * Append a single message (live mode — no grouping, shown as-is).
   */
  appendMessage(container, msg, currentTurn) {
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
   * Classify a message for styling and filtering.
   */
  classifyMessage(msg) {
    if (msg.to === 'notes') return 'notes';
    if (msg.from === 'user') return 'initial';
    return 'routed';
  },

  /**
   * Render a grouped message: routed message + collapsed reasoning notes.
   */
  renderGrouped(msg, notes) {
    const fromColor = AgentCard.getColor(msg.from);
    const toColor = msg.to === 'user' ? -1 : (msg.to === 'notes' ? -1 : AgentCard.getColor(msg.to));
    const time = MessageFeed.formatTime(msg.timestamp);
    const content = MessageFeed.escape(msg.content || '');
    const isLong = content.length > 200;
    const toLabel = msg.to === 'notes' ? 'notes' : MessageFeed.escape(msg.to);

    const notesHtml = notes.map((n) => {
      const nContent = MessageFeed.escape(n.content || '');
      const nTime = MessageFeed.formatTime(n.timestamp);
      return `<div class="reasoning-note">
        <span class="reasoning-note-time">${nTime}</span>
        <div class="reasoning-note-content" onclick="this.classList.toggle('expanded')">${nContent}</div>
      </div>`;
    }).join('');

    const label = notes.length === 1 ? '1 reasoning note' : `${notes.length} reasoning notes`;

    return `
      <div class="message message-routed border-color-${fromColor}" data-msg-type="routed" data-msg-from="${MessageFeed.escape(msg.from)}" data-msg-to="${toLabel}">
        <div class="message-header">
          <span class="message-from agent-color-${fromColor}">${MessageFeed.escape(msg.from)}</span>
          <span class="message-arrow">\u2192</span>
          <span class="message-to ${toColor >= 0 ? `agent-color-${toColor}` : ''}">${toLabel}</span>
          <span class="message-turn">T${msg.turn ?? 0}</span>
          <span class="message-time">${time}</span>
        </div>
        <div class="reasoning-toggle" onclick="this.closest('.message').classList.toggle('show-reasoning')">
          <span class="reasoning-icon">\u25B8</span> ${label}
        </div>
        <div class="reasoning-notes">${notesHtml}</div>
        <div class="message-content${isLong ? '' : ' expanded'}" onclick="this.classList.toggle('expanded')">${content}</div>
        ${isLong ? '<span class="message-expand" onclick="this.previousElementSibling.classList.toggle(\'expanded\'); this.textContent = this.previousElementSibling.classList.contains(\'expanded\') ? \'collapse\' : \'expand\'">expand</span>' : ''}
      </div>
    `;
  },

  /**
   * Render a single message to HTML string (routed, initial, or standalone note).
   */
  renderMessage(msg, isNew) {
    const fromColor = AgentCard.getColor(msg.from);
    const toColor = msg.to === 'user' ? -1 : (msg.to === 'notes' ? -1 : AgentCard.getColor(msg.to));
    const time = MessageFeed.formatTime(msg.timestamp);
    const content = MessageFeed.escape(msg.content || '');
    const msgType = MessageFeed.classifyMessage(msg);
    const isLong = content.length > 200;
    const newClass = isNew ? ' new' : '';
    const typeClass = ` message-${msgType}`;
    const toLabel = msg.to === 'notes' ? 'notes' : MessageFeed.escape(msg.to);

    return `
      <div class="message${newClass}${typeClass} border-color-${fromColor}" data-msg-type="${msgType}" data-msg-from="${MessageFeed.escape(msg.from)}" data-msg-to="${toLabel}">
        <div class="message-header">
          <span class="message-from agent-color-${fromColor}">${MessageFeed.escape(msg.from)}</span>
          <span class="message-arrow">\u2192</span>
          <span class="message-to ${toColor >= 0 ? `agent-color-${toColor}` : ''}">${toLabel}</span>
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
    const turnDisplay = session.maxTurns > 0
      ? `${session.turn ?? 0}/${session.maxTurns}`
      : `${session.turn ?? 0}`;

    container.innerHTML = `
      <span>Turn <span class="turn-stat-value">${turnDisplay}</span></span>
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

  cleanupExpandButtons(container) {
    requestAnimationFrame(() => {
      container.querySelectorAll('.message-content:not(.expanded)').forEach((el) => {
        if (el.scrollHeight <= el.clientHeight + 2) {
          el.classList.add('expanded');
          const btn = el.nextElementSibling;
          if (btn && btn.classList.contains('message-expand')) {
            btn.style.display = 'none';
          }
        }
      });
    });
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
