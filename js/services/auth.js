import { supabase } from './supabase.js';

export async function signUp({ email, password, metadata }) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata }
    });
    return { data, error };
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
}

export async function signOut() {
    return supabase.auth.signOut();
}

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Re-fetches the authenticated user's role directly from the database.
 * Call this at the start of every admin page load to prevent stale in-memory
 * role values from granting access after a demotion.
 */
export async function getMyRole() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'user';
    const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
    return data?.role || 'user';
}

export async function ensureProfile() {
    const { data, error } = await supabase.rpc('ensure_user_profile');
    if (error) throw error;
    return data;
}

export async function waitForProfile(userId, retries = 6) {
    for (let i = 0; i < retries; i++) {
        const profile = await getProfile(userId);
        if (profile) return profile;
        await new Promise(r => setTimeout(r, 400));
    }
    return ensureProfile();
}

export async function updateProfile(userId, updates) {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Profile update failed — check permissions or try signing in again.');
    return data;
}

export async function addPoints(userId, amount) {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('You must be logged in to award points.');

    if (user.id === userId) {
        const profile = await getProfile(userId);
        if (!profile) throw new Error('Profile not found');
        return updateProfile(userId, { points: profile.points + amount });
    }

    const { data, error } = await supabase.rpc('award_points', {
        p_user_id: userId,
        p_amount: amount
    });
    if (error) {
        if ((error.message || '').includes('Could not find the function')) {
            throw new Error('Points could not be awarded to another user. Run docs/sql/011_award_points_rpc.sql in Supabase.');
        }
        throw error;
    }
    return data;
}

export async function getEmailByUsername(username) {
    const { data, error } = await supabase.rpc('get_login_email', {
        p_username: username
    });
    if (error) throw error;
    return data || null;
}

export async function checkProfileExists({ username, email, id_number }) {
    const { data, error } = await supabase.rpc('check_profile_available', {
        p_username: username,
        p_email: email,
        p_id_number: id_number
    });
    if (error) throw error;
    return data === false;
}

export async function fetchLeaderboardUsers() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, username, points, role')
        .eq('role', 'user')
        .order('points', { ascending: false });
    if (error) throw error;
    return data;
}

export async function fetchAllProfiles() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, username, email, role, role_label, points, contact_number, created_at')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}
