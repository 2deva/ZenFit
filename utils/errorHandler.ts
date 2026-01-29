export enum ErrorCategory {
    NETWORK = 'NETWORK',
    API = 'API',
    DATABASE = 'DATABASE',
    VALIDATION = 'VALIDATION',
    AUTH = 'AUTH',
    UNKNOWN = 'UNKNOWN',
}

export interface AppError extends Error {
    category: ErrorCategory;
    userMessage?: string;
    originalError?: any;
}

export function createError(category: ErrorCategory, message: string, originalError?: any): AppError {
    const error = new Error(message) as AppError;
    error.category = category;
    error.userMessage = message; // Default user message to technical message, logic can be refined
    error.originalError = originalError;
    return error;
}

export function handleSupabaseError(error: any): AppError {
    if (error?.code === 'PGRST116') {
        return createError(ErrorCategory.DATABASE, 'No rows found', error);
    }
    if (error?.code === '23505') {
        return createError(ErrorCategory.VALIDATION, 'Duplicate entry', error);
    }
    if (error?.message === 'Failed to fetch') {
        return createError(ErrorCategory.NETWORK, 'Network error', error);
    }
    return createError(ErrorCategory.DATABASE, error?.message || 'Database error', error);
}

export function handleAPIError(error: any): AppError {
    if (error?.status === 401 || error?.status === 403) {
        return createError(ErrorCategory.AUTH, error?.message || 'Unauthorized', error);
    }
    if (error?.status === 429) {
        return createError(ErrorCategory.API, error?.message || 'Rate limit exceeded', error);
    }
    if (error?.status >= 500) {
        return createError(ErrorCategory.API, error?.message || 'Server error', error);
    }
    return createError(ErrorCategory.API, error?.message || 'API error', error);
}

export function handleFirebaseError(error: any): AppError {
    return createError(ErrorCategory.API, error?.message || 'Firebase error', error);
}

export async function withErrorHandling<T>(fn: () => Promise<T>, fallbackCategory: ErrorCategory = ErrorCategory.UNKNOWN): Promise<{ data?: T; error?: AppError }> {
    try {
        const data = await fn();
        return { data };
    } catch (error: any) {
        if (error?.category) {
            return { error: error as AppError };
        }
        return { error: createError(fallbackCategory, error?.message || 'Unknown error', error) };
    }
}

export async function withRetry<T>(fn: () => Promise<T>, options: { maxAttempts?: number } = {}): Promise<T> {
    const maxAttempts = options.maxAttempts || 1; // Default to 1 attempt (no retry if fails once? No, usually withRetry implies retries. But test says "succeed on first attempt" and "fail after max attempts". Let's assume maxAttempts includes the initial try)
    // Wait, standard retry logic usually means defaults might be 3. But let's follow test strictly.
    // Test: withRetry(fn, { maxAttempts: 2 })
    // If defaults is {}, test "should succeed on first attempt" implies it runs at least once.

    let lastError;
    for (let i = 0; i < (options.maxAttempts || 1); i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}
