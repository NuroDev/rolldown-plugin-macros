import type {
  CallExpression,
  ImportDeclaration,
  Program,
} from "@oxc-project/types";

import type { MacroBinding, MacroCallsite, MacroImportInfo } from "./types";
import { evaluateStaticExpression } from "./evaluate";

/**
 * Checks whether an ImportDeclaration has `with { type: 'macro' }`.
 */
function isMacroImport(node: ImportDeclaration): boolean {
  return node.attributes.some((attr) => {
    const key = attr.key.type === "Identifier" ? attr.key.name : attr.key.value;
    return key === "type" && attr.value.value === "macro";
  });
}

/**
 * Collect all macro import declarations from the AST.
 */
export function collectMacroImports(ast: Program): Array<MacroImportInfo> {
  const imports: Array<MacroImportInfo> = [];

  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (!isMacroImport(node)) continue;

    const moduleSpecifier = node.source.value;
    const bindings: Array<MacroBinding> = [];

    for (const spec of node.specifiers) {
      switch (spec.type) {
        case "ImportSpecifier": {
          const exportedName =
            spec.imported.type === "Identifier"
              ? spec.imported.name
              : spec.imported.value;
          bindings.push({
            exportedName,
            localName: spec.local.name,
            moduleSpecifier,
          });
          break;
        }
        case "ImportDefaultSpecifier": {
          bindings.push({
            exportedName: "default",
            localName: spec.local.name,
            moduleSpecifier,
          });
          break;
        }
        case "ImportNamespaceSpecifier": {
          // Namespace imports are not supported for macros — the user
          // must use named imports so we can identify individual callsites.
          throw new Error(
            `[macros] Namespace import (import * as ...) is not supported for macro modules. ` +
              `Use named imports instead: import { fn } from '${moduleSpecifier}' with { type: 'macro' }`,
          );
        }
      }
    }

    imports.push({
      bindings,
      end: node.end,
      moduleSpecifier,
      start: node.start,
    });
  }

  return imports;
}

/**
 * Given a set of macro bindings, walk the AST to find all direct callsites.
 * A direct callsite is `macroFn(arg1, arg2, ...)` where `macroFn` is a local
 * binding from a macro import.
 *
 * We walk the full AST body looking for CallExpression nodes whose callee
 * is an Identifier matching one of the macro local names.
 */
export function collectMacroCallsites(
  ast: Program,
  bindings: Array<MacroBinding>,
): Array<MacroCallsite> {
  const bindingMap = new Map<string, MacroBinding>();
  for (const b of bindings) {
    bindingMap.set(b.localName, b);
  }

  const callsites: Array<MacroCallsite> = [];
  walkForCallExpressions(ast, bindingMap, callsites);
  return callsites;
}

/**
 * Simple recursive AST walker that finds CallExpression nodes.
 * We avoid using rolldown's Visitor here because we need to collect results
 * into an array and the visitor pattern is fire-and-forget.
 */
function walkForCallExpressions(
  node: unknown,
  bindingMap: Map<string, MacroBinding>,
  callsites: Array<MacroCallsite>,
): void {
  if (node === null || node === undefined || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) {
      walkForCallExpressions(child, bindingMap, callsites);
    }

    return;
  }

  const record = node as Record<string, unknown>;
  const type = record["type"] as string | undefined;

  if (type === "CallExpression") {
    const callExpr = node as CallExpression;
    const callee = callExpr.callee;

    // Direct call: macroFn(...)
    if (callee.type === "Identifier") {
      const binding = bindingMap.get(callee.name);
      if (binding) {
        const staticArgs = callExpr.arguments.map((arg) => {
          if (arg.type === "SpreadElement") {
            throw new Error(
              `[macros] Spread arguments are not supported in macro calls. ` +
                `Found spread in call to '${binding.localName}'.`,
            );
          }
          return evaluateStaticExpression(arg);
        });

        callsites.push({
          binding,
          end: callExpr.end,
          start: callExpr.start,
          staticArgs,
        });
      }
    }
  }

  // Recurse into child properties
  for (const key of Object.keys(record)) {
    if (key === "parent") continue; // avoid circular refs

    const value = record[key];
    if (value !== null && typeof value === "object") {
      walkForCallExpressions(value, bindingMap, callsites);
    }
  }
}
