import { supabase } from './supabase.js';

export async function createClaim(claim) {
    const { error } = await supabase.from('claims').insert(claim);
    if (error) {
        throw new Error('Claim could not be saved: ' + error.message);
    }
    return claim;
}

export async function fetchClaims({ status } = {}) {
    let query = supabase
        .from('claims')
        .select('*')
        .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data: claims, error } = await query;
    if (error) throw error;
    if (!claims?.length) return [];

    // Attach the related found-item report so the admin can compare
    // descriptions. We use a separate query (not embedding) to avoid
    // ambiguous-FK issues if the schema evolves.
    const reportIds = [...new Set(claims.map(c => c.report_id))];
    const { data: reports, error: rErr } = await supabase
        .from('reports')
        .select('id, description, image_url, location, user_name, contact_number, category, date_reported, user_id')
        .in('id', reportIds);

    if (rErr) {
        // Non-fatal: return claims without report detail rather than crashing
        console.warn('fetchClaims: could not load related reports:', rErr.message);
        return claims;
    }

    const reportById = Object.fromEntries((reports || []).map(r => [r.id, r]));
    return claims.map(c => ({ ...c, report: reportById[c.report_id] || null }));
}

// Attach the related found-item report to a list of claims (separate query,
// never embedding, to avoid ambiguous-FK issues).
async function attachReportsToClaims(claims) {
    if (!claims?.length) return claims || [];
    const reportIds = [...new Set(claims.map(c => c.report_id))];
    const { data: reports, error } = await supabase
        .from('reports')
        .select('id, description, image_url, location, user_name, contact_number, category, date_reported, user_id, status')
        .in('id', reportIds);
    if (error) {
        console.warn('attachReportsToClaims:', error.message);
        return claims;
    }
    const byId = Object.fromEntries((reports || []).map(r => [r.id, r]));
    return claims.map(c => ({ ...c, report: byId[c.report_id] || null }));
}

/** Claims submitted by a user (claimant view / My Claims). */
export async function fetchClaimsByClaimant(claimantId) {
    if (!claimantId) return [];
    const { data, error } = await supabase
        .from('claims')
        .select('*')
        .eq('claimant_id', claimantId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return attachReportsToClaims(data || []);
}

/** Claims against items a user reported as found (finder view). */
export async function fetchClaimsByFinder(finderId) {
    if (!finderId) return [];
    const { data, error } = await supabase
        .from('claims')
        .select('*')
        .eq('finder_id', finderId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return attachReportsToClaims(data || []);
}

export async function updateClaim(id, updates) {
    const { error } = await supabase
        .from('claims')
        .update(updates)
        .eq('id', id);

    if (error) throw error;

    const { data, error: fetchErr } = await supabase
        .from('claims')
        .select('*')
        .eq('id', id)
        .limit(1);

    if (fetchErr) throw fetchErr;
    if (!data?.length) throw new Error('Could not update claim — admin access may be required.');
    return data[0];
}

export async function fetchClaimById(id) {
    const { data, error } = await supabase
        .from('claims')
        .select('*')
        .eq('id', id)
        .limit(1);

    if (error) throw error;
    if (!data?.length) throw new Error('Claim not found.');
    return data[0];
}

function parseRpcJson(data) {
    if (data == null) return null;
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return null; }
    }
    return data;
}

function formatRpcError(error, rpcName, sqlFile) {
    const msg = error?.message || String(error);
    const code = error?.code || '';
    if (
        msg.includes('Could not find the function')
        || msg.includes('schema cache')
        || code === 'PGRST202'
    ) {
        return new Error(
            `${rpcName} is not available. Run docs/sql/${sqlFile} in Supabase SQL Editor, `
            + 'wait a few seconds, then hard-refresh the app (Ctrl+Shift+R).'
        );
    }
    if (msg.includes('Cannot coerce')) {
        return new Error(
            `${rpcName} returned an unexpected response. Re-run docs/sql/${sqlFile} and `
            + 'docs/sql/013_fix_claim_hash.sql in Supabase, then hard-refresh.'
        );
    }
    return error;
}

/** One-shot claim submit (requires 014_submit_claim_rpc.sql). */
export async function submitClaimRpc(reportId, answer1, answer2, answer3) {
    const { data, error } = await supabase.rpc('submit_claim', {
        p_report_id: reportId,
        p_answer1: answer1,
        p_answer2: answer2,
        p_answer3: answer3
    });

    if (error) throw formatRpcError(error, 'submit_claim', '014_submit_claim_rpc.sql');

    const result = parseRpcJson(data);
    if (!result) {
        throw new Error('submit_claim returned empty data. Re-run 014 in Supabase and hard-refresh.');
    }
    return result;
}

/** Finder or admin confirms physical handover (requires 017). Closes the loop. */
export async function confirmHandoverRpc(claimId) {
    const { data, error } = await supabase.rpc('confirm_handover', { p_claim_id: claimId });
    if (error) throw formatRpcError(error, 'confirm_handover', '017_notifications_and_unified_flow.sql');
    return parseRpcJson(data);
}

/** Resolve found report after auto-approved claim (requires 012_fix_claims_rls.sql). */
export async function resolveReportForClaim(reportId) {
    const { data, error } = await supabase.rpc('resolve_report_for_claim', {
        p_report_id: reportId
    });
    if (error) throw formatRpcError(error, 'resolve_report_for_claim', '012_fix_claims_rls.sql');
    return parseRpcJson(data);
}

/** Server-side blind verification (requires 010_verify_claim_rpc.sql). */
export async function verifyClaimAnswers(reportId, answer1, answer2, answer3) {
    const { data, error } = await supabase.rpc('verify_claim_answers', {
        p_report_id: reportId,
        p_answer1: answer1,
        p_answer2: answer2,
        p_answer3: answer3
    });
    if (error) throw error;
    return parseRpcJson(data);
}
