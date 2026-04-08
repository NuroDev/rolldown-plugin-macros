/**
 * Macro that returns a non-serializable value (a function).
 */
export function getFunction() {
	return () => 'hello';
}

/**
 * Macro that returns a value that's not a function.
 */
export const notAFunction = 42;
