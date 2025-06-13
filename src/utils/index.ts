/**
 * Paginate results from a fetch function
 * @param fetchFn - The function to fetch the results
 * @param limit - The number of results to fetch per page
 * @returns An array of all results
 */
export async function paginateResults<T>(
    fetchFn: (skip: number, limit: number) => Promise<{
        rows: T[],
        total: number,
        skip: number,
        limit: number
    }>,
    limit = 100
): Promise<T[]> {
    let skip = 0;
    let allResults: T[] = [];
    let total = 0;

    try {
        do {
            const response = await fetchFn(skip, limit);
            const { rows, total: totalCount } = response;
            total = totalCount;
            allResults = [...allResults, ...rows];
            skip += limit;
        } while (allResults.length < total);

        return allResults;
    } catch (error) {
        console.error("Error in pagination:", error);
        throw error;
    }
}

/**
 * Normalize an action ID
 * @param raw - The raw action ID
 * @returns The normalized action ID
 */
export function normalizeActionId(raw: string): string {
    if (raw.includes("::")) {
        if (!raw.startsWith("conn_mod_def::")) {
            return `conn_mod_def::${raw}`;
        }
        return raw;
    }
    return raw;
}

/**
 * Replace path variables in a path
 * @param path - The path to replace variables in
 * @param variables - The variables to replace in the path
 * @returns The path with the variables replaced
 */
export function replacePathVariables(path: string, variables: Record<string, string | number | boolean>): string {
    return path.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
        const value = variables[variable];
        if (!value) {
            throw new Error(`Missing value for path variable: ${variable}`);
        }
        return value.toString();
    });
}
