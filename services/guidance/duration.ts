export function parseGuidanceDuration(duration: string): number {
    const normalized = duration.toLowerCase().trim();

    // Minutes
    const minMatch = normalized.match(/(\d+)\s*m(?:in(?:ute)?s?)?/);
    if (minMatch) {
        return parseInt(minMatch[1]) * 60;
    }

    // Seconds
    const secMatch = normalized.match(/(\d+)\s*s(?:ec(?:ond)?s?)?/);
    if (secMatch) {
        return parseInt(secMatch[1]);
    }

    // Plain number (assume seconds)
    const plainNum = parseInt(normalized);
    if (!isNaN(plainNum)) {
        return plainNum;
    }

    return 30; // Default 30 seconds
}

