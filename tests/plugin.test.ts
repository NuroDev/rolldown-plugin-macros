import path from 'node:path';

import { parseAst } from 'rolldown/parseAst';
import { describe, expect, it } from 'vitest';

import { collectMacroCallsites, collectMacroImports } from '../src/analyze.js';
import { evaluateStaticExpression, serializeToSource } from '../src/evaluate.js';
import { clearModuleCache, executeMacro } from '../src/executor.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const SIMPLE_MACROS = path.join(FIXTURES_DIR, 'simple-macros.js');

describe('collectMacroImports', () => {
	it('should detect import with { type: "macro" }', () => {
		const code = `import { greet } from './macros' with { type: 'macro' };`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(1);
		expect(imports[0].moduleSpecifier).toBe('./macros');
		expect(imports[0].bindings).toHaveLength(1);
		expect(imports[0].bindings[0].localName).toBe('greet');
		expect(imports[0].bindings[0].exportedName).toBe('greet');
	});

	it('should detect aliased imports', () => {
		const code = `import { greet as hello } from './macros' with { type: 'macro' };`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(1);
		expect(imports[0].bindings[0].localName).toBe('hello');
		expect(imports[0].bindings[0].exportedName).toBe('greet');
	});

	it('should detect default import', () => {
		const code = `import myMacro from './macros' with { type: 'macro' };`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(1);
		expect(imports[0].bindings[0].localName).toBe('myMacro');
		expect(imports[0].bindings[0].exportedName).toBe('default');
	});

	it('should detect multiple named imports', () => {
		const code = `import { greet, double, getConfig } from './macros' with { type: 'macro' };`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(1);
		expect(imports[0].bindings).toHaveLength(3);
		expect(imports[0].bindings.map((b) => b.localName)).toEqual([
			'greet',
			'double',
			'getConfig',
		]);
	});

	it('should ignore imports without macro attribute', () => {
		const code = `import { foo } from './not-macro';`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(0);
	});

	it('should ignore imports with different attribute type', () => {
		const code = `import data from './data.json' with { type: 'json' };`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(0);
	});

	it('should throw on namespace imports', () => {
		const code = `import * as macros from './macros' with { type: 'macro' };`;
		const ast = parseAst(code);

		expect(() => collectMacroImports(ast)).toThrow('Namespace import');
	});

	it('should handle multiple macro imports from different modules', () => {
		const code = `
			import { greet } from './macros-a' with { type: 'macro' };
			import { double } from './macros-b' with { type: 'macro' };
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(imports).toHaveLength(2);
		expect(imports[0].moduleSpecifier).toBe('./macros-a');
		expect(imports[1].moduleSpecifier).toBe('./macros-b');
	});
});

describe('collectMacroCallsites', () => {
	it('should find direct callsites', () => {
		const code = `
			import { greet } from './macros' with { type: 'macro' };
			const msg = greet("world");
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites).toHaveLength(1);
		expect(callsites[0].binding.localName).toBe('greet');
		expect(callsites[0].staticArgs).toEqual(['world']);
	});

	it('should find multiple callsites', () => {
		const code = `
			import { greet, double } from './macros' with { type: 'macro' };
			const a = greet("alice");
			const b = double(21);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites).toHaveLength(2);
	});

	it('should evaluate static literal arguments', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn("hello", 42, true, null);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites[0].staticArgs).toEqual(['hello', 42, true, null]);
	});

	it('should evaluate array arguments', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn(["a", "b", "c"]);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites[0].staticArgs).toEqual([['a', 'b', 'c']]);
	});

	it('should evaluate object arguments', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn({ key: "value", count: 3 });
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites[0].staticArgs).toEqual([{ count: 3, key: 'value' }]);
	});

	it('should evaluate negative number arguments', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn(-42);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites[0].staticArgs).toEqual([-42]);
	});

	it('should throw on non-static arguments (variable reference)', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			const x = 5;
			fn(x);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(() =>
			collectMacroCallsites(
				ast,
				imports.flatMap((i) => i.bindings),
			),
		).toThrow('Cannot statically evaluate');
	});

	it('should throw on spread arguments', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn(...args);
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);

		expect(() =>
			collectMacroCallsites(
				ast,
				imports.flatMap((i) => i.bindings),
			),
		).toThrow('Spread arguments');
	});

	it('should handle zero-argument calls', () => {
		const code = `
			import { fn } from './m' with { type: 'macro' };
			fn();
		`;
		const ast = parseAst(code);
		const imports = collectMacroImports(ast);
		const callsites = collectMacroCallsites(
			ast,
			imports.flatMap((i) => i.bindings),
		);

		expect(callsites[0].staticArgs).toEqual([]);
	});
});

describe('evaluateStaticExpression', () => {
	function evalExpr(code: string): unknown {
		// Wrap in expression statement to parse
		const ast = parseAst(code);
		const stmt = ast.body[0];
		if (stmt.type !== 'ExpressionStatement') {
			throw new Error('Expected expression statement');
		}
		return evaluateStaticExpression(stmt.expression);
	}

	it('should evaluate string literals', () => {
		expect(evalExpr('"hello"')).toBe('hello');
	});

	it('should evaluate number literals', () => {
		expect(evalExpr('42')).toBe(42);
		expect(evalExpr('3.14')).toBe(3.14);
	});

	it('should evaluate boolean literals', () => {
		expect(evalExpr('true')).toBe(true);
		expect(evalExpr('false')).toBe(false);
	});

	it('should evaluate null', () => {
		expect(evalExpr('null')).toBe(null);
	});

	it('should evaluate undefined', () => {
		expect(evalExpr('undefined')).toBe(undefined);
	});

	it('should evaluate template literals without expressions', () => {
		expect(evalExpr('`hello world`')).toBe('hello world');
	});

	it('should reject template literals with expressions', () => {
		expect(() => evalExpr('`hello ${name}`')).toThrow(
			'Template literals with expressions',
		);
	});

	it('should evaluate nested objects and arrays', () => {
		// Wrap in parens so the parser sees an object expression, not a block
		expect(evalExpr('({ a: [1, 2], b: { c: true } })')).toEqual({
			a: [1, 2],
			b: { c: true },
		});
	});

	it('should evaluate unary negation', () => {
		expect(evalExpr('-5')).toBe(-5);
	});

	it('should evaluate unary not', () => {
		expect(evalExpr('!true')).toBe(false);
		expect(evalExpr('!false')).toBe(true);
	});
});

describe('serializeToSource', () => {
	it('should serialize strings', () => {
		expect(serializeToSource('hello')).toBe('"hello"');
	});

	it('should serialize numbers', () => {
		expect(serializeToSource(42)).toBe('42');
		expect(serializeToSource(-3.14)).toBe('-3.14');
	});

	it('should serialize booleans', () => {
		expect(serializeToSource(true)).toBe('true');
		expect(serializeToSource(false)).toBe('false');
	});

	it('should serialize null', () => {
		expect(serializeToSource(null)).toBe('null');
	});

	it('should serialize undefined', () => {
		expect(serializeToSource(undefined)).toBe('undefined');
	});

	it('should serialize arrays', () => {
		expect(serializeToSource([1, 'two', true])).toBe('[1, "two", true]');
	});

	it('should serialize objects', () => {
		expect(serializeToSource({ a: 1, b: 'two' })).toBe('{"a": 1, "b": "two"}');
	});

	it('should serialize nested structures', () => {
		const value = { items: [1, 2], nested: { ok: true } };
		expect(serializeToSource(value)).toBe(
			'{"items": [1, 2], "nested": {"ok": true}}',
		);
	});

	it('should serialize bigints', () => {
		expect(serializeToSource(BigInt(42))).toBe('42n');
	});

	it('should serialize special numbers', () => {
		expect(serializeToSource(NaN)).toBe('NaN');
		expect(serializeToSource(Infinity)).toBe('Infinity');
		expect(serializeToSource(-Infinity)).toBe('-Infinity');
	});

	it('should throw on functions', () => {
		expect(() => serializeToSource(() => {})).toThrow('Cannot serialize');
	});
});

describe('executeMacro', () => {
	it('should execute a simple macro', async () => {
		clearModuleCache();
		const result = await executeMacro(
			'./simple-macros.js',
			'greet',
			['world'],
			path.join(FIXTURES_DIR, 'test.js'),
		);
		expect(result).toBe('Hello, world!');
	});

	it('should execute a macro with number args', async () => {
		clearModuleCache();
		const result = await executeMacro(
			'./simple-macros.js',
			'double',
			[21],
			path.join(FIXTURES_DIR, 'test.js'),
		);
		expect(result).toBe(42);
	});

	it('should execute a macro returning an object', async () => {
		clearModuleCache();
		const result = await executeMacro(
			'./simple-macros.js',
			'getConfig',
			['production'],
			path.join(FIXTURES_DIR, 'test.js'),
		);
		expect(result).toEqual({
			debug: false,
			env: 'production',
			version: '1.0.0',
		});
	});

	it('should execute an async macro', async () => {
		clearModuleCache();
		const result = await executeMacro(
			'./simple-macros.js',
			'asyncMacro',
			['test'],
			path.join(FIXTURES_DIR, 'test.js'),
		);
		expect(result).toBe('async:test');
	});

	it('should throw when macro throws', async () => {
		clearModuleCache();
		await expect(
			executeMacro(
				'./throwing-macro.js',
				'willThrow',
				[],
				path.join(FIXTURES_DIR, 'test.js'),
			),
		).rejects.toThrow('intentional macro error');
	});

	it('should throw when export is not a function', async () => {
		clearModuleCache();
		await expect(
			executeMacro(
				'./non-serializable-macro.js',
				'notAFunction',
				[],
				path.join(FIXTURES_DIR, 'test.js'),
			),
		).rejects.toThrow('is not a function');
	});
});
