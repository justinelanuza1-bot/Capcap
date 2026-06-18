import { supabase } from './supabase.js';

export async function createSighting(sighting) {
    const { data, error } = await supabase
        .from('sightings')
        .insert(sighting)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function fetchSightingsForReport(reportId) {
    const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .eq('report_id', reportId)
        .order('match_score', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// NOTE: We never use PostgREST embedding (reports(...)) here. With two FKs
// between sightings and reports (report_id + reports.recovery_sighting_id),
// embedding is ambiguous ("more than one relationship"). We attach reports
// manually with a second query instead — bulletproof regardless of schema.
async function attachReportToSightings(sightings) {
    if (!sightings?.length) return sightings;
    const reportIds = [...new Set(sightings.map(s => s.report_id))];
    const { data: reports, error } = await supabase
        .from('reports')
        .select('id, item_name, user_id, user_name, status')
        .in('id', reportIds);
    if (error) throw error;
    const byId = Object.fromEntries((reports || []).map(r => [r.id, r]));
    return sightings.map(s => ({ ...s, reports: byId[s.report_id] || null }));
}

export async function fetchSightingsForOwner(userId) {
    const { data: reports, error: reportsError } = await supabase
        .from('reports')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'lost');
    if (reportsError) throw reportsError;
    if (!reports.length) return [];

    const reportIds = reports.map(r => r.id);
    const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .in('report_id', reportIds)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return attachReportToSightings(data);
}

export async function countSightingsForReport(reportId) {
    const { count, error } = await supabase
        .from('sightings')
        .select('*', { count: 'exact', head: true })
        .eq('report_id', reportId);
    if (error) throw error;
    return count || 0;
}

export async function fetchSightingById(id) {
    const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
}

export async function updateSighting(id, updates) {
    const { data, error } = await supabase
        .from('sightings')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        throw new Error('Could not update sighting — you may not have permission. Run 008_sighting_verification.sql if this persists.');
    }
    return data;
}

export async function fetchMySightings(userId) {
    const { data, error } = await supabase
        .from('sightings')
        .select('*')
        .eq('reporter_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return attachReportToSightings(data);
}

/** Returns { data, error } so dashboard can warn without crashing */
export async function safeFetchSightingsForOwner(userId) {
    try {
        const data = await fetchSightingsForOwner(userId);
        return { data, error: null };
    } catch (err) {
        console.warn('fetchSightingsForOwner failed:', err.message);
        return { data: [], error: err };
    }
}

export async function safeFetchMySightings(userId) {
    try {
        const data = await fetchMySightings(userId);
        return { data, error: null };
    } catch (err) {
        console.warn('fetchMySightings failed:', err.message);
        return { data: [], error: err };
    }
}

export function isSightingsSchemaError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.code || '';
    return (
        code === '42P01' ||
        code === 'PGRST205' ||
        msg.includes('sightings') && (
            msg.includes('does not exist') ||
            msg.includes('could not find') ||
            msg.includes('schema cache')
        )
    );
}
