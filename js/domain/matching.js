const SYNONYMS = {
    wallet: ['purse', 'billfold', 'cardholder'],
    phone: ['cellphone', 'smartphone', 'mobile', 'cellular'],
    bag: ['backpack', 'knapsack', 'sack', 'pouch', 'tote'],
    laptop: ['notebook', 'computer', 'pc', 'macbook'],
    glasses: ['eyeglasses', 'spectacles', 'shades', 'sunglasses'],
    key: ['keys', 'keychain', 'keyholder'],
    umbrella: ['parasol', 'brolly'],
    charger: ['adapter', 'cable', 'cord'],
    id: ['identification', 'student id', 'school id', 'idcard'],
    notebook: ['journal', 'notes', 'pad'],
    earphones: ['earbuds', 'headphones', 'airpods', 'headset'],
    jacket: ['coat', 'hoodie', 'sweater', 'cardigan'],
    shoes: ['sneakers', 'rubber shoes', 'footwear', 'sandals', 'slippers'],
    pen: ['ballpen', 'marker', 'pencil'],
    book: ['textbook', 'module', 'workbook'],
    watch: ['timepiece', 'wristwatch'],
    ring: ['band', 'jewelry'],
    necklace: ['chain', 'jewelry', 'pendant'],
    folder: ['binder', 'envelope', 'portfolio']
};

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'it', 'its', 'was', 'were', 'this', 'that',
    'with', 'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for', 'by', 'i', 'my', 'your', 'their'
]);

export function levenshtein(a, b) {
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

export function stringSimilarity(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = levenshtein(a, b);
    return Math.max(0, 1 - dist / maxLen);
}

export function extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

export function expandWithSynonyms(keywords) {
    const expanded = new Set(keywords);
    keywords.forEach(kw => {
        Object.entries(SYNONYMS).forEach(([base, syns]) => {
            if (kw === base || syns.includes(kw)) {
                expanded.add(base);
                syns.forEach(s => expanded.add(s));
            }
        });
    });
    return Array.from(expanded);
}

export function calculateMatchScore(lostReport, foundReport) {
    const nameSim = stringSimilarity(lostReport.item_name, foundReport.item_name);
    const nameScore = nameSim >= 0.8 ? nameSim : nameSim * 0.5;

    let locScore = 0;
    const lostLoc = (lostReport.location || '').toLowerCase().trim();
    const foundLoc = (foundReport.location || '').toLowerCase().trim();
    if (lostLoc && foundLoc) {
        if (lostLoc === foundLoc) {
            locScore = 1;
        } else if (lostLoc.includes(foundLoc) || foundLoc.includes(lostLoc)) {
            locScore = 0.5;
        } else {
            const locSim = stringSimilarity(lostLoc, foundLoc);
            locScore = locSim >= 0.7 ? locSim * 0.5 : 0;
        }
    }

    const lostKws = expandWithSynonyms(extractKeywords(
        `${lostReport.item_name || ''} ${lostReport.description || ''} ${lostReport.category || ''}`
    ));
    const foundKws = expandWithSynonyms(extractKeywords(
        `${foundReport.item_name || ''} ${foundReport.description || ''} ${foundReport.category || ''}`
    ));

    let kwScore = 0;
    if (lostKws.length > 0 && foundKws.length > 0) {
        const matchedKws = lostKws.filter(k => foundKws.includes(k));
        kwScore = matchedKws.length / Math.max(lostKws.length, foundKws.length);
    }

    const total = (nameScore * 0.40) + (locScore * 0.30) + (kwScore * 0.30);
    return Math.round(total * 100);
}

export function getMatchBadge(score) {
    if (score >= 85) return `<span class="match-badge match-high">🟢 High Match (${score}%)</span>`;
    if (score >= 50) return `<span class="match-badge match-possible">🟡 Possible Match (${score}%)</span>`;
    return '';
}

export function scoreSightingTip(lostReport, description, locationSeen) {
    return calculateMatchScore(lostReport, {
        item_name: lostReport.item_name,
        location: locationSeen || '',
        description,
        category: lostReport.category
    });
}

export function getSightingMatchLabel(score) {
    if (score >= 85) return 'high';
    if (score >= 50) return 'possible';
    return 'low';
}

export function getSightingMatchBadge(score) {
    if (score >= 85) return `<span class="match-badge match-high">🟢 Strong lead (${score}%)</span>`;
    if (score >= 50) return `<span class="match-badge match-possible">🟡 Possible lead (${score}%)</span>`;
    return `<span class="match-badge match-low">🔵 Weak lead (${score}%)</span>`;
}

export function getSightingResultMessage(score) {
    if (score >= 85) {
        return 'Your tip closely matches this lost item. The owner has been notified and may reach out. Consider messaging them directly for faster contact.';
    }
    if (score >= 50) {
        return 'Your tip has some overlap with the lost item description. The owner will review it — add more specific details next time for a stronger match.';
    }
    return 'Your tip was saved, but it has a low match score. The owner may still find it useful. Try including location, color, brand, or unique marks.';
}

export async function findMatches(lostReport, fetchReports) {
    const foundReports = await fetchReports({ type: 'found', status: 'pending' });
    return foundReports
        .map(f => ({ report: f, score: calculateMatchScore(lostReport, f) }))
        .filter(m => m.score >= 50)
        .sort((a, b) => b.score - a.score);
}

