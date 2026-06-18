import { supabase } from './supabase.js';

export async function fetchUserMessages(userId) {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

export async function fetchConversationMessages(reportId, userId, otherUserId) {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('report_id', reportId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).filter(m =>
        (m.sender_id === userId && m.receiver_id === otherUserId) ||
        (m.sender_id === otherUserId && m.receiver_id === userId)
    );
}

export async function sendMessage(msg) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        throw new Error('You must be logged in to send messages. Please sign in again.');
    }

    const receiverId = String(msg.receiver_id || '').trim();
    if (!receiverId) throw new Error('Invalid recipient.');
    if (receiverId === user.id) throw new Error('You cannot message yourself.');

    const payload = {
        report_id: Number(msg.report_id),
        sender_id: user.id,
        sender_name: msg.sender_name,
        receiver_id: receiverId,
        message: String(msg.message || '').trim()
    };

    if (!payload.report_id || !payload.message) {
        throw new Error('Missing report or message text.');
    }

    const { error } = await supabase.from('messages').insert(payload);
    if (error) throw error;
    return payload;
}

export async function markMessagesAsRead(reportId, receiverId) {
    const { error } = await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('report_id', reportId)
        .eq('receiver_id', receiverId)
        .eq('is_read', false);

    if (error) throw error;
}

export async function fetchMessageCount() {
    const { count, error } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return count || 0;
}

/**
 * Subscribe to new messages for the current user (sender or receiver).
 * Requires `messages` in Supabase Realtime publication (see 010_verify_claim_rpc.sql).
 * @returns {() => void} unsubscribe
 */
export function subscribeToMessages(userId, onMessage) {
    if (!userId) return () => {};

    const channel = supabase
        .channel(`messages-${userId}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
                const msg = payload.new;
                if (!msg) return;
                if (msg.sender_id === userId || msg.receiver_id === userId) {
                    onMessage(msg);
                }
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
}
