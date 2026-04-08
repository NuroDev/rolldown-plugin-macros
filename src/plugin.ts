import type { Plugin } from 'rolldown';
import { parseAst } from 'rolldown/parseAst';

import { collectMacroCallsites, collectMacroImports } from './analyze';
import { serializeToSource } from './evaluate';
import { clearModuleCache, executeMacro } from './executor';
import type { MacroCallsite, MacroImportInfo, MacroPluginOptions } from './types';

const DEFAULT_EXTENSIONS = /\.(m?[jt]sx?)$/;

/**
 * Rolldown plugin that evaluates macro imports at build time.
 *
 * Detects `import { fn } from './macros' with { type: 'macro' }`,
 * evaluates `fn(...)` calls at build time, and inlines the results
 * as static values.
 */
export function macroPlugin(options?: MacroPluginOptions): Plugin {
	const filter = options?.filter ?? ((id: string) => DEFAULT_EXTENSIONS.test(id));

	return {
		buildStart() {
			clearModuleCache();
		},
		name: 'macros',
		async transform(code, id) {
			if (!filter(id)) return null;

			// Quick check: does this file even contain import attributes?
			// This is a fast path to avoid parsing files that don't use macros.
			if (!code.includes('type') || !code.includes('macro')) return null;

			const ast = parseAst(code, undefined, id);

			// Step 1: Collect macro imports
			let macroImports = new Array<MacroImportInfo>();
			try {
				macroImports = collectMacroImports(ast);
			} catch (err) {
				this.error(err instanceof Error ? err.message : String(err));
			}

			if (macroImports.length === 0) return null;

			// Step 2: Collect all bindings from macro imports
			const allBindings = macroImports.flatMap((imp) => imp.bindings);

			// Step 3: Find all callsites
			let callsites = new Array<MacroCallsite>();
			try {
				callsites = collectMacroCallsites(ast, allBindings);
			} catch (err) {
				this.error(err instanceof Error ? err.message : String(err));
			}

			// Step 4: Check that every macro binding is actually called.
			// Warn about unused macro bindings (they're being imported but never called,
			// which likely indicates the user is trying to use the macro as a value).
			const calledNames = new Set(callsites.map((c) => c.binding.localName));
			for (const binding of allBindings) {
				if (!calledNames.has(binding.localName)) {
					this.warn(
						`[macros] Macro binding '${binding.localName}' from '${binding.moduleSpecifier}' ` +
							`is imported but never called. Macro imports must only be used as direct function calls.`,
					);
				}
			}

			if (callsites.length === 0 && macroImports.length > 0) {
				// No callsites but we have macro imports — just remove the imports
				// and return since nothing needs inlining.
			}

			// Step 5: Execute each macro and collect replacement values.
			// Sort callsites in reverse order so we can replace from end to start
			// without invalidating positions.
			callsites.sort((a, b) => b.start - a.start);

			const replacements: Array<{
				end: number;
				serialized: string;
				start: number;
			}> = [];

			for (const callsite of callsites) {
				const result = await executeMacro(
					callsite.binding.moduleSpecifier,
					callsite.binding.exportedName,
					callsite.staticArgs,
					id,
				);

				let serialized: string;
				try {
					serialized = serializeToSource(result);
				} catch (err) {
					this.error(err instanceof Error ? err.message : String(err));
				}

				replacements.push({
					end: callsite.end,
					serialized,
					start: callsite.start,
				});
			}

			// Step 6: Apply replacements using MagicString for source map support.
			// We use rolldown's built-in MagicString from the transform meta when
			// available, otherwise construct one manually.
			const { RolldownMagicString } = await import('rolldown');
			const ms = new RolldownMagicString(code);

			// Replace macro callsites with inlined values
			for (const rep of replacements) {
				ms.overwrite(rep.start, rep.end, rep.serialized);
			}

			// Remove macro import declarations (sort in reverse to not invalidate positions)
			const sortedImports = [...macroImports].sort((a, b) => b.start - a.start);
			for (const imp of sortedImports) {
				ms.remove(imp.start, imp.end);
			}

			return {
				code: ms,
				map: ms.generateMap({
					hires: 'boundary',
				}),
			};
		},
	};
}
