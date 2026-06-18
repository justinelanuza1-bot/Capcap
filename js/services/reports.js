import { supabase } from './supabase.js';

export async function fetchReports({ type, status, userId } = {}) {
    let query = supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false });

    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function fetchReportById(id) {
    const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', id)
        .limit(1);

    if (error) throw error;
    if (!data?.length) throw new Error('Report not found.');
    return data[0];
}

export async function createReport(report) {
    const { data, error } = await supabase
        .from('reports')
        .insert(report)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateReport(id, updates) {
    const { data, error } = await supabase
        .from('reports')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Could not update report — check permissions.');
    return data;
}

export async function deleteReport(id) {
    const { error } = await supabase
        .from('reports')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function getWeeklyReportCount(userId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count, error } = await supabase
        .from('reports')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', sevenDaysAgo.toISOString());

    if (error) throw error;
    return count || 0;
}
