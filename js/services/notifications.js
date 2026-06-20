import { supabase } from './supabase.js';

// All functions degrade gracefully: if the notifications table / migration 017
// has not been run yet, they no-op instead of throwing, so the app keeps working.

function isMissingTable(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.code || '';
    return (
        code === '42P01' ||
        code === 'PGRST205' ||
        (msg.includes('notifications') &&
            (msg.includes('does not exist') ||
             msg.includes('could not find') ||
             msg.includes('schema cache')))
    );
}

/**
 * Create a notification for a user. Never throws — notifications are best-effort.
 * @param {{user_id:string, type?:string, title:string, body?:string, link?:string}} n
 */
export async function createNotification(n) {
    if (!n?.user_id || !n?.title) return null;
    try {
        const { error } = await supabase.from('notifications').insert({
            user_id: n.user_id,
            type: n.type || 'info',
            title: n.title,
            body: n.body || '',
            link: n.link || ''
        });
        if (error && !isMissingTable(error)) {
            console.warn('createNotification failed:', error.message);
        }
    } catch (err) {
        console.warn('createNotification error:', err.message);
    }
    return null;
}

/** Create the same notification for several users (e.g. all admins). */
export async function createNotificationsForMany(userIds, base) {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    await Promise.all(ids.map(id => createNotification({ ...base, user_id: id })));
}

export async function fetchNotifications(userId, { limit = 30 } = {}) {
    if (!userId) return [];
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) {
            if (!isMissingTable(error)) console.warn('fetchNotifications:', error.message);
            return [];
        }
        return data || [];
    } catch {
        return [];
    }
}

export async function fetchUnreadCount(userId) {
    if (!userId) return 0;
    try {
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false);
        if (error) return 0;
        return count || 0;
    } catch {
        return 0;
    }
}

export async function markNotificationRead(id) {
    try {
        await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    } catch { /* ignore */ }
}

export async function markAllNotificationsRead(userId) {
    if (!userId) return;
    try {
        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', userId)
            .eq('is_read', false);
    } catch { /* ignore */ }
}

/**
 * Subscribe to new notifications for a user via Realtime.
 * Requires notifications in the supabase_realtime publication (migration 017).
 * @returns {() => void} unsubscribe
 */
export function subscribeToNotifications(userId, onInsert) {
    if (!userId) return () => {};
    let channel;
    try {
        channel = supabase
            .channel(`notifications-${userId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
                (payload) => { if (payload.new) onInsert(payload.new); }
            )
            .subscribe();
    } catch {
        return () => {};
    }
    return () => {
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
    };
}
