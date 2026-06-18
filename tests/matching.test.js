import { describe, it, expect } from 'vitest';
import {
    calculateMatchScore,
    stringSimilarity,
    scoreSightingTip,
    findMatches
} from '../js/domain/matching.js';

describe('matching engine', () => {
    const lost = {
        item_name: 'Black Wallet',
        location: 'Library 2nd Floor',
        description: 'Leather wallet with student ID inside',
        category: 'Accessories'
    };

    const foundMatch = {
        item_name: 'Black Wallet',
        location: 'Library 2nd Floor',
        description: 'Found a leather wallet near the study area',
        category: 'Accessories'
    };

    const foundWeak = {
        item_name: 'Blue Umbrella',
        location: 'Cafeteria',
        description: 'Rain umbrella left on chair',
        category: 'Other'
    };

    it('scores exact name and location highly', () => {
        const score = calculateMatchScore(lost, foundMatch);
        expect(score).toBeGreaterThanOrEqual(85);
    });

    it('scores unrelated items below match threshold', () => {
        const score = calculateMatchScore(lost, foundWeak);
        expect(score).toBeLessThan(50);
    });

    it('treats synonym keywords as overlap', () => {
        const score = calculateMatchScore(
            { item_name: 'cellphone', location: 'gym', description: 'samsung phone', category: 'Electronics' },
            { item_name: 'mobile phone', location: 'gym', description: 'android smartphone', category: 'Electronics' }
        );
        expect(score).toBeGreaterThanOrEqual(50);
    });

    it('stringSimilarity returns 1 for identical strings', () => {
        expect(stringSimilarity('Wallet', 'wallet')).toBe(1);
    });

    it('scoreSightingTip uses lost item name as anchor', () => {
        const score = scoreSightingTip(lost, 'Saw a black wallet near the library stairs', 'Library');
        expect(score).toBeGreaterThanOrEqual(50);
    });

    it('findMatches filters below 50% and sorts descending', async () => {
        const mockFetch = async () => [foundMatch, foundWeak];
        const results = await findMatches(lost, mockFetch);
        expect(results.length).toBe(1);
        expect(results[0].score).toBeGreaterThanOrEqual(50);
    });
});
