/**
 * Simple macro that returns a greeting string.
 */
export function greet(name) {
	return `Hello, ${name}!`;
}

/**
 * Macro that returns the current timestamp at build time.
 */
export function buildTimestamp() {
	return Date.now();
}

/**
 * Macro that doubles a number.
 */
export function double(n) {
	return n * 2;
}

/**
 * Macro that returns a config object.
 */
export function getConfig(env) {
	return {
		debug: env === 'development',
		env,
		version: '1.0.0',
	};
}

/**
 * Macro that returns an array of items.
 */
export function getFeatureFlags(flags) {
	return flags.map((f) => f.toUpperCase());
}

/**
 * Async macro.
 */
export async function asyncMacro(value) {
	return `async:${value}`;
}
