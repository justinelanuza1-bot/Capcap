/**
 * Messages UI controller — chat panel, conversations, realtime updates.
 */
export function createMessagesController(deps) {
    let currentChatReportId = null;
    let currentChatOtherUserId = null;
    let unsubscribeRealtime = null;

    function getUser() {
        return deps.getCurrentUser();
    }

    function showChatPanel(open) {
        const container = document.querySelector('.messages-container');
        const chatEmpty = document.getElementById('chatEmpty');
        const chatWindow = document.getElementById('chatWindow');
        if (open) {
            chatEmpty?.classList.add('hidden');
            chatWindow?.classList.remove('hidden');
            container?.classList.add('chat-active');
        } else {
            chatWindow?.classList.add('hidden');
            chatEmpty?.classList.remove('hidden');
            container?.classList.remove('chat-active');
        }
    }

    function highlightActiveConversation() {
        document.querySelectorAll('.conversation-item').forEach(el => {
            const match = Number(el.dataset.reportId) === currentChatReportId &&
                el.dataset.otherId === currentChatOtherUserId;
            el.classList.toggle('active', match);
        });
    }

    function appendMessageBubble(msg) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const empty = container.querySelector('.empty-state');
        if (empty) container.innerHTML = '';

        const user = getUser();
        const bubble = document.createElement('div');
        bubble.className = `message ${msg.sender_id === user?.id ? 'sent' : 'received'}`;
        bubble.innerHTML = `
            <div class="message-bubble">${deps.esc(msg.message)}</div>
            <div class="message-time">${new Date(msg.created_at).toLocaleString()}</div>`;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
    }

    function isCurrentConversation(msg) {
        if (!currentChatReportId || !currentChatOtherUserId) return false;
        const user = getUser();
        if (!user) return false;
        if (Number(msg.report_id) !== currentChatReportId) return false;
        const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        return String(otherId) === String(currentChatOtherUserId);
    }

    function handleRealtimeMessage(msg) {
        if (!isCurrentConversation(msg)) {
            loadConversations();
            return;
        }
        const container = document.getElementById('chatMessages');
        const alreadyShown = container?.querySelector(`[data-msg-id="${msg.id}"]`);
        if (alreadyShown) return;

        appendMessageBubble(msg);
        const lastBubble = container?.lastElementChild;
        if (lastBubble) lastBubble.dataset.msgId = String(msg.id);

        const user = getUser();
        if (msg.receiver_id === user?.id) {
            deps.markMessagesAsRead(currentChatReportId, user.id).catch(() => {});
        }
        loadConversations();
    }

    function startRealtime() {
        stopRealtime();
        const user = getUser();
        if (!user) return;
        unsubscribeRealtime = deps.subscribeToMessages(user.id, handleRealtimeMessage);
    }

    function stopRealtime() {
        if (unsubscribeRealtime) {
            unsubscribeRealtime();
            unsubscribeRealtime = null;
        }
    }

    function ensureConversationInList(reportId, otherId, otherName, itemName) {
        const list = document.getElementById('conversationsList');
        if (!list) return;

        const selector = `[data-report-id="${reportId}"][data-other-id="${otherId}"]`;
        if (list.querySelector(selector)) return;

        const empty = list.querySelector('.empty-state');
        if (empty) list.innerHTML = '';

        const item = document.createElement('div');
        item.className = 'conversation-item active';
        item.dataset.reportId = String(reportId);
        item.dataset.otherId = otherId;
        item.innerHTML = `
            <div style="font-weight:600;margin-bottom:4px;">${deps.esc(otherName || 'User')}</div>
            <div style="font-size:0.85rem;color:#7f8c8d;margin-bottom:4px;">🔍 ${deps.esc(itemName || 'Item')}</div>
            <div style="font-size:0.85rem;color:#95a5a6;">Start a conversation…</div>`;
        list.prepend(item);
    }

    async function openChat(reportId, receiverId, receiverName, itemName) {
        const user = getUser();
        if (!user) {
            alert('Please log in to send messages.');
            return;
        }

        const otherId = String(receiverId || '').trim();
        const reportIdNum = Number(reportId);
        if (!otherId || !reportIdNum) {
            alert('Cannot start this conversation.');
            return;
        }
        if (otherId === user.id) {
            alert('You cannot message yourself.');
            return;
        }

        currentChatReportId = reportIdNum;
        currentChatOtherUserId = otherId;

        document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
        document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
        document.getElementById('messages')?.classList.remove('hidden');
        document.querySelectorAll('.sidebar-nav a').forEach(link => {
            if (link.textContent.toLowerCase().includes('messages')) link.classList.add('active');
        });

        showChatPanel(true);
        await loadConversations();
        ensureConversationInList(reportIdNum, otherId, receiverName, itemName);
        highlightActiveConversation();
        await loadMessages();
        showChatPanel(true);
        document.getElementById('messageInput')?.focus();
        document.getElementById('chatInputBar')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function openMessageModal(reportId, receiverId, receiverName, itemName) {
        openChat(reportId, receiverId, receiverName, itemName);
    }

    function closeMessageModal() {}

    async function sendNewMessage() {
        openChat(
            document.getElementById('messageReportId')?.value,
            document.getElementById('messageReceiverId')?.value,
            document.getElementById('messageReceiverName')?.textContent,
            document.getElementById('messageItemName')?.textContent
        );
    }

    async function loadConversations() {
        const user = getUser();
        deps.showLoading('conversationsList', 'Loading conversations...');
        try {
            const messages = await deps.fetchUserMessages(user.id);
            const reports = await deps.fetchReports();

            const map = new Map();
            for (const msg of messages) {
                const isSender = msg.sender_id === user.id;
                const otherId = isSender ? msg.receiver_id : msg.sender_id;
                const key = `${msg.report_id}-${otherId}`;
                if (!map.has(key) || new Date(msg.created_at) > new Date(map.get(key).last_message_at)) {
                    const report = reports.find(r => r.id === msg.report_id);
                    map.set(key, {
                        report_id: msg.report_id,
                        other_user_id: otherId,
                        item_name: report ? report.item_name : 'Unknown item',
                        report_type: report ? report.type : 'lost',
                        last_message: msg.message,
                        last_message_at: msg.created_at,
                        unread: !isSender && !msg.is_read
                    });
                }
            }

            const conversations = [];
            for (const conv of map.values()) {
                const profile = await deps.getProfile(conv.other_user_id);
                conv.other_user_name = profile?.name || 'Unknown user';
                conversations.push(conv);
            }

            conversations.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
            const container = document.getElementById('conversationsList');

            if (conversations.length === 0) {
                if (currentChatReportId && currentChatOtherUserId) {
                    container.innerHTML = '';
                } else {
                    deps.showEmpty('conversationsList', 'No conversations yet. Message someone from Lost Items or Sightings.');
                }
                return;
            }

            container.innerHTML = conversations.map(c => {
                const isActive = currentChatReportId === c.report_id &&
                    currentChatOtherUserId === c.other_user_id;
                return `
                <div class="conversation-item${isActive ? ' active' : ''}" data-report-id="${c.report_id}" data-other-id="${c.other_user_id}">
                    <div style="font-weight:600;margin-bottom:4px;">${deps.esc(c.other_user_name)}${c.unread ? ' <span style="color:#2563eb;">●</span>' : ''}</div>
                    <div style="font-size:0.85rem;color:#7f8c8d;margin-bottom:4px;">
                        ${c.report_type === 'lost' ? '🔍' : '✅'} ${deps.esc(c.item_name)}
                    </div>
                    <div style="font-size:0.85rem;color:#95a5a6;">
                        ${deps.esc(c.last_message.substring(0, 50))}${c.last_message.length > 50 ? '...' : ''}
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            console.error('Load conversations failed:', err);
            deps.showEmpty('conversationsList', 'Could not load conversations.');
        }
    }

    function openConversation(reportId, otherUserId) {
        currentChatReportId = Number(reportId);
        currentChatOtherUserId = String(otherUserId);
        showChatPanel(true);
        highlightActiveConversation();
        loadMessages();
    }

    async function loadMessages() {
        if (!currentChatReportId) return;
        const user = getUser();

        try {
            const messages = await deps.fetchConversationMessages(
                currentChatReportId, user.id, currentChatOtherUserId
            );

            const report = await deps.fetchReportById(currentChatReportId);
            const other = await deps.getProfile(currentChatOtherUserId);

            document.getElementById('chatUserName').textContent = other?.name || 'Unknown user';
            document.getElementById('chatItemName').textContent = report
                ? `About: ${report.item_name}`
                : '';

            const container = document.getElementById('chatMessages');
            if (messages.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No messages yet. Say hello!</p></div>';
                showChatPanel(true);
                return;
            }

            container.innerHTML = messages.map(m => `
                <div class="message ${m.sender_id === user.id ? 'sent' : 'received'}" data-msg-id="${m.id}">
                    <div class="message-bubble">${deps.esc(m.message)}</div>
                    <div class="message-time">${new Date(m.created_at).toLocaleString()}</div>
                </div>`).join('');
            container.scrollTop = container.scrollHeight;

            await deps.markMessagesAsRead(currentChatReportId, user.id);
            highlightActiveConversation();
            showChatPanel(true);
        } catch (err) {
            console.error('Load messages failed:', err);
            document.getElementById('chatMessages').innerHTML =
                '<div class="empty-state" style="padding:20px;"><p>Could not load messages. Try again.</p></div>';
        }
    }

    async function sendMessage() {
        const user = getUser();
        const input = document.getElementById('messageInput');
        const message = input.value.trim();
        if (!message) return;
        if (!currentChatReportId || !currentChatOtherUserId) {
            alert('Select a conversation first.');
            return;
        }

        try {
            await deps.sendMessageToDb({
                report_id: currentChatReportId,
                sender_name: user?.name || 'User',
                receiver_id: String(currentChatOtherUserId).trim(),
                message
            });
            input.value = '';
            await loadMessages();
            await loadConversations();
        } catch (err) {
            const hint = (err.message || '').includes('row-level security')
                ? '\n\nTry: run docs/sql/009_fix_messages_rls.sql in Supabase, then sign out and sign in again.'
                : '';
            alert('❌ Failed to send message: ' + err.message + hint);
        }
    }

    function closeChatWindow() {
        showChatPanel(false);
        currentChatReportId = null;
        currentChatOtherUserId = null;
    }

    function enterMessagesPage() {
        loadConversations();
        if (currentChatReportId && currentChatOtherUserId) {
            showChatPanel(true);
            loadMessages();
        } else {
            showChatPanel(false);
        }
    }

    return {
        openChat,
        openMessageModal,
        closeMessageModal,
        sendNewMessage,
        loadConversations,
        openConversation,
        loadMessages,
        sendMessage,
        closeChatWindow,
        enterMessagesPage,
        startRealtime,
        stopRealtime
    };
}
