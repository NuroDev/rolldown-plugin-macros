import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Cache of already-loaded macro modules to avoid re-importing
 * the same module on every transform call.
 */
const moduleCache = new Map<string, Record<string, unknown>>();

/**
 * Clear the module cache. Useful for tests or watch mode.
 */
export function clearModuleCache(): void {
	moduleCache.clear();
}

/**
 * Resolve a macro module specifier to an absolute file path.
 * The specifier is resolved relative to the importing file.
 */
function resolveModulePath(specifier: string, importer: string): string {
	if (specifier.startsWith('.') || specifier.startsWith('/'))
		return path.resolve(path.dirname(importer), specifier);

	// For bare specifiers (e.g., npm packages), rely on Node's resolution
	return specifier;
}

/**
 * Load a macro module and return its exports.
 * Uses dynamic import() so it works with both ESM and CJS modules.
 */
async function loadMacroModule(
	specifier: string,
	importer: string,
): Promise<Record<string, unknown>> {
	const resolved = resolveModulePath(specifier, importer);
	const cacheKey = resolved;

	const cached = moduleCache.get(cacheKey);
	if (cached) return cached;

	let moduleUrl: string;
	if (path.isAbsolute(resolved)) {
		moduleUrl = pathToFileURL(resolved).href;
	} else {
		// Bare specifier — let Node resolve it from the importer's directory
		moduleUrl = resolved;
	}

	const mod = (await import(moduleUrl)) as Record<string, unknown>;
	moduleCache.set(cacheKey, mod);
	return mod;
}

/**
 * Execute a macro function with the given arguments.
 * Returns the result value.
 */
export async function executeMacro(
	specifier: string,
	exportedName: string,
	args: Array<unknown>,
	importer: string,
): Promise<unknown> {
	const mod = await loadMacroModule(specifier, importer);

	const fn = mod[exportedName];
	if (typeof fn !== 'function')
		throw new Error(
			`[macros] Export '${exportedName}' from '${specifier}' is not a function ` +
				`(got ${typeof fn}). Macro imports must reference exported functions.`,
		);

	try {
		const result: unknown = await fn(...args);
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`[macros] Macro '${exportedName}' from '${specifier}' threw an error: ${message}`,
			{ cause: err },
		);
	}
}
