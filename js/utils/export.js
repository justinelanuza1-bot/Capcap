function csvEscape(val) {
    const s = val == null ? '' : String(val);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function triggerDownload(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    triggerDownload(filename, blob);
}

export function downloadCsv(filename, rows) {
    const content = rows.map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
    triggerDownload(filename, blob);
}

export function dashboardInsightsToCsv(insights) {
    const rows = [
        ['Section', 'Category', 'Title', 'Detail', 'Location', 'Score', 'Status', 'Date']
    ];

    const s = insights.summary || {};
    rows.push(['Summary', 'Lost Items', s.lost_label || 'Lost', s.lost_count ?? '', '', '', '', insights.generated_at]);
    rows.push(['Summary', 'Found Items', s.found_label || 'Found', s.found_count ?? '', '', '', '', '']);
    rows.push(['Summary', 'Resolved', s.resolved_label || 'Resolved', s.resolved_count ?? '', '', '', '', '']);
    if (s.points != null) rows.push(['Summary', 'Your Points', '', s.points, '', '', '', '']);

    (insights.my_reports || []).forEach(r => {
        rows.push([
            'My Report', r.type, r.item_name, r.description || '',
            r.location || '', '', r.status, r.date_reported || r.created_at || ''
        ]);
    });

    (insights.smart_matches || []).forEach(m => {
        rows.push([
            'Smart Match', 'Lost → Found', m.lost_item_name,
            `Matches found: ${m.found_item_name}`,
            m.found_location || '', `${m.score}%`, 'pending', ''
        ]);
    });

    (insights.sightings_received || []).forEach(t => {
        rows.push([
            'Sighting Received', t.item_name || '', t.reporter_name,
            t.description || '', t.location_seen || '', `${t.match_score}%`,
            t.status || 'pending', t.created_at || ''
        ]);
    });

    (insights.sightings_submitted || []).forEach(t => {
        rows.push([
            'Sighting Submitted', t.item_name || '', t.owner_name || '',
            t.description || '', t.location_seen || '', `${t.match_score}%`,
            t.status || 'pending', t.created_at || ''
        ]);
    });

    if (insights.platform_reports?.length) {
        insights.platform_reports.forEach(r => {
            rows.push([
                'Platform Report', r.type, r.item_name, r.description || '',
                r.location || '', '', r.status, r.created_at || ''
            ]);
        });
    }

    return rows;
}
