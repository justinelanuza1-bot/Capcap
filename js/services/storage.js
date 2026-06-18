import { supabase } from './supabase.js';

export async function uploadReportImage(userId, reportId, file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${userId}/${reportId}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from('report-images')
        .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('report-images').getPublicUrl(path);
    return data.publicUrl;
}

export async function uploadSightingImage(userId, sightingKey, file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `sightings/${userId}/${sightingKey}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from('report-images')
        .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('report-images').getPublicUrl(path);
    return data.publicUrl;
}
