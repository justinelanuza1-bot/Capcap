import { describe, it, expect } from 'vitest';
import {
    simpleHash,
    hashAnswers,
    compareClaimHashes,
    isVagueClaim,
    generateRetrievalCode
} from '../js/domain/verification.js';

describe('blind verification', () => {
    it('normalizes case and whitespace before hashing', () => {
        expect(simpleHash('  Hello   World  ')).toBe(simpleHash('hello world'));
    });

    it('returns empty string for empty input', () => {
        expect(simpleHash('')).toBe('');
        expect(simpleHash(null)).toBe('');
    });

    it('hashAnswers produces q1/q2/q3 keys', () => {
        const hashes = hashAnswers('red', 'nike', 'size 10');
        expect(hashes).toHaveProperty('q1');
        expect(hashes).toHaveProperty('q2');
        expect(hashes).toHaveProperty('q3');
        expect(hashes.q1).toMatch(/^H[0-9A-Z]+$/);
    });

    it('compareClaimHashes detects exact match', () => {
        const stored = hashAnswers('red', 'nike', 'size 10');
        const answers = hashAnswers('red', 'nike', 'size 10');
        expect(compareClaimHashes(answers, stored)).toBe(true);
    });

    it('compareClaimHashes rejects mismatch', () => {
        const stored = hashAnswers('red', 'nike', 'size 10');
        const answers = hashAnswers('blue', 'nike', 'size 10');
        expect(compareClaimHashes(answers, stored)).toBe(false);
    });

    it('isVagueClaim flags short combined answers', () => {
        expect(isVagueClaim('red', 'nike', '10')).toBe(true);
        expect(isVagueClaim('bright red color', 'nike brand logo', 'size ten shoes')).toBe(false);
    });

    it('generateRetrievalCode uses LF- prefix', () => {
        expect(generateRetrievalCode()).toMatch(/^LF-[A-Z0-9]+$/);
    });
});
