export function simpleHash(str) {
    if (!str) return '';
    const normalized = str
        .toLowerCase()
        .trim()
        .replace(/['".,!?;:()]/g, '')
        .replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
        const chr = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return 'H' + Math.abs(hash).toString(36).toUpperCase();
}

export function hashAnswers(a1, a2, a3) {
    return {
        q1: simpleHash(a1),
        q2: simpleHash(a2),
        q3: simpleHash(a3)
    };
}

export function compareClaimHashes(answerHashes, storedHashes) {
    if (!storedHashes) return false;
    return answerHashes.q1 === storedHashes.q1
        && answerHashes.q2 === storedHashes.q2
        && answerHashes.q3 === storedHashes.q3;
}

export function isVagueClaim(a1, a2, a3) {
    const totalWords = `${a1} ${a2} ${a3}`.trim().split(/\s+/).filter(Boolean).length;
    return totalWords <= 5;
}

export function generateRetrievalCode() {
    return 'LF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function retrievalExpiresAt(hours = 48) {
    return new Date(Date.now() + hours * 3600000).toISOString();
}
