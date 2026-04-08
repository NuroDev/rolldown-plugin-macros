> [!IMPORTANT]  
> This project is 100% AI generated as a proof-of-concept and should not be used in production.

# rolldown-plugin-macros

Rolldown plugin for Bun-compatible build macros using import attributes.

Detects `import { fn } from './macros' with { type: 'macro' }`, evaluates macro function calls at build time, and inlines the results as static values.

## Setup

```bash
bun add -D rolldown-plugin-macros
```

```ts
// rolldown.config.ts
import { macros } from 'rolldown-plugin-macros';

export default {
	input: 'src/index.ts',
	plugins: [macros()],
};
```

## Usage

### Define a macro module

```js
// macros.js
export function greet(name) {
	return `Hello, ${name}!`;
}

export function getConfig(env) {
	return {
		debug: env === 'development',
		version: '1.0.0',
	};
}
```

### Use it in your source code

```js
import { greet, getConfig } from './macros' with { type: 'macro' };

const message = greet('world');
const config = getConfig('production');
```

### Build output

```js
const message = 'Hello, world!';
const config = { debug: false, version: '1.0.0' };
```

The macro import is removed entirely, and each call is replaced with the inlined return value.

## How it works

1. **Detection** — scans each module's AST for `ImportDeclaration` nodes with `with { type: 'macro' }` attributes.
2. **Static argument evaluation** — extracts call arguments as static JS values (literals, arrays, plain objects). Non-static arguments are rejected with a clear error.
3. **Execution** — loads the macro module via `import()` and calls the referenced export with the static arguments. Async macros are awaited.
4. **Inlining** — serializes the return value to source code and replaces the call expression using `RolldownMagicString` for correct source maps.
5. **Cleanup** — removes the macro import declaration from the output.

## Options

```ts
macros({
	// Custom file filter. Defaults to .js/.ts/.jsx/.tsx/.mjs/.mts files.
	filter: (id) => id.endsWith('.ts'),
});
```

## Supported patterns

| Pattern                                                    | Supported            |
| ---------------------------------------------------------- | -------------------- |
| `import { fn } from './m' with { type: 'macro' }`          | Yes                  |
| `import fn from './m' with { type: 'macro' }`              | Yes (default export) |
| `import { fn as alias } from './m' with { type: 'macro' }` | Yes                  |
| `fn("string", 42, true, null)`                             | Yes (literal args)   |
| `fn([1, 2, 3])`                                            | Yes (array args)     |
| `fn({ key: "value" })`                                     | Yes (object args)    |
| `fn(-42)`                                                  | Yes (unary +/-/!)    |
| `fn()`                                                     | Yes (no args)        |
| Async macro functions                                      | Yes                  |
| Source maps                                                | Yes                  |

## Limitations (PoC scope)

This is a proof-of-concept. The following are not supported:

- **Namespace imports** — `import * as macros from './m' with { type: 'macro' }` is rejected.
- **Non-call usage** — passing a macro binding as a value (e.g., `const fn = macroFn; fn()`) is not detected.
- **Dynamic arguments** — only statically evaluable arguments are allowed. Variable references, function calls, or expressions are rejected.
- **Non-serializable returns** — macro functions must return JSON-serializable values (plus `undefined` and `bigint`). Functions, symbols, etc. will throw.
- **Spread arguments** — `fn(...args)` is not supported.
- **Template literals with expressions** — ``fn(`${x}`)`` is rejected (plain template strings are fine).
- **Computed property keys** — `fn({ [key]: value })` is rejected.
- **Module side effects** — macro modules are imported and executed at build time. Side effects in the macro module will run during the build.
- **Watch mode cache invalidation** — the macro module cache is cleared at `buildStart` but not on individual file changes within a build.

## Bun parity

This plugin implements the same `with { type: 'macro' }` import attribute syntax as [Bun's build macros](https://bun.sh/docs/bundler/macros). The intent is to allow the same macro source files to work with both Bun's bundler and Rolldown.

Key differences from Bun:

- Bun evaluates macros in a Bun-specific runtime; this plugin uses Node's `import()`.
- Bun supports additional patterns (e.g., `JSX` return values) that are not covered here.
- Bun's macro execution has access to Bun-specific APIs; this plugin runs macros in a standard Node.js environment.

## License

MIT
