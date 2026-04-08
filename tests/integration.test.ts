import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rolldown } from 'rolldown';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { macroPlugin } from '../src/index.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-test-'));
});

afterEach(() => {
	fs.rmSync(tmpDir, { force: true, recursive: true });
});

function writeEntry(code: string): string {
	const entryPath = path.join(tmpDir, 'entry.js');
	fs.writeFileSync(entryPath, code, 'utf-8');
	return entryPath;
}

async function bundleAndGetCode(entryCode: string): Promise<string> {
	const entryPath = writeEntry(entryCode);

	const build = await rolldown({
		input: entryPath,
		plugins: [macroPlugin()],
	});

	const { output } = await build.generate({ format: 'esm' });
	return output[0].code;
}

describe('integration: full plugin through rolldown', () => {
	it('should inline a simple string macro', async () => {
		const code = await bundleAndGetCode(`
			import { greet } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const message = greet("world");
		`);

		expect(code).toContain('"Hello, world!"');
		// Should NOT contain the import
		expect(code).not.toContain('simple-macros');
		// Should NOT contain the function call
		expect(code).not.toContain('greet(');
	});

	it('should inline a numeric macro', async () => {
		const code = await bundleAndGetCode(`
			import { double } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const value = double(21);
		`);

		expect(code).toContain('42');
		expect(code).not.toContain('double(');
	});

	it('should inline an object-returning macro', async () => {
		const code = await bundleAndGetCode(`
			import { getConfig } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const config = getConfig("production");
		`);

		expect(code).toContain('"production"');
		expect(code).toContain('"1.0.0"');
		expect(code).toContain('false'); // debug: false
		expect(code).not.toContain('getConfig(');
	});

	it('should inline an array-returning macro', async () => {
		const code = await bundleAndGetCode(`
			import { getFeatureFlags } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const flags = getFeatureFlags(["dark-mode", "v2"]);
		`);

		expect(code).toContain('"DARK-MODE"');
		expect(code).toContain('"V2"');
		expect(code).not.toContain('getFeatureFlags(');
	});

	it('should handle multiple macro calls in one file', async () => {
		const code = await bundleAndGetCode(`
			import { greet, double } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const msg = greet("alice");
			export const num = double(5);
		`);

		expect(code).toContain('"Hello, alice!"');
		expect(code).toContain('10');
		expect(code).not.toContain('greet(');
		expect(code).not.toContain('double(');
	});

	it('should handle async macros', async () => {
		const code = await bundleAndGetCode(`
			import { asyncMacro } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const result = asyncMacro("hello");
		`);

		expect(code).toContain('"async:hello"');
		expect(code).not.toContain('asyncMacro(');
	});

	it('should preserve non-macro imports', async () => {
		const helperPath = path.join(tmpDir, 'helper.js');
		fs.writeFileSync(helperPath, 'export const helper = "I am helper";', 'utf-8');

		const code = await bundleAndGetCode(`
			import { helper } from './helper.js';
			import { greet } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const msg = greet("world");
			export { helper };
		`);

		expect(code).toContain('"Hello, world!"');
		expect(code).toContain('I am helper');
		expect(code).not.toContain("type: 'macro'");
	});

	it('should skip files that do not contain macro imports', async () => {
		const code = await bundleAndGetCode(`
			export const x = 42;
		`);

		expect(code).toContain('42');
	});

	it('should handle aliased imports', async () => {
		const code = await bundleAndGetCode(`
			import { greet as sayHello } from '${FIXTURES_DIR}/simple-macros.js' with { type: 'macro' };
			export const msg = sayHello("world");
		`);

		expect(code).toContain('"Hello, world!"');
		expect(code).not.toContain('sayHello(');
	});
});
