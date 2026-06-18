export const CATEGORIES = [
    'Electronics',
    'Clothing',
    'Accessories',
    'Documents',
    'Books / School Supplies',
    'Bag / Backpack',
    'Keys',
    'Other'
];

export const POINTS = {
    lost: 5,
    found: 10,
    resolved: 20,
    sightingHelpful: 10,
    sightingRecovered: 25
};

export const BADGE_TIERS = [
    { min: 100, label: '⭐ Hero' },
    { min: 50, label: '💫 Helper' },
    { min: 20, label: '✨ Contributor' },
    { min: 0, label: '🌟 Beginner' }
];

export function getBadgeLabel(points) {
    return BADGE_TIERS.find(t => points >= t.min)?.label || BADGE_TIERS.at(-1).label;
}

export function getUserInitials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
