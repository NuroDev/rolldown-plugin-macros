import type { Expression } from "@oxc-project/types";

/**
 * Statically evaluate an AST expression node to a JS value.
 * Only supports a safe subset: literals, arrays, objects, unary minus/plus,
 * null, undefined. Throws for any unsupported expression.
 */
export function evaluateStaticExpression(node: Expression): unknown {
  switch (node.type) {
    case "ArrayExpression": {
      return node.elements.map((el) => {
        if (el === null) return undefined; // elision: [1,,3]

        if (el.type === "SpreadElement")
          throw new Error(
            "[macros] Spread elements are not supported in macro arguments.",
          );

        return evaluateStaticExpression(el);
      });
    }
    case "Identifier": {
      // Only 'undefined' is allowed as a static value
      if ("name" in node && node.name === "undefined") return undefined;

      throw new Error(
        `[macros] Cannot statically evaluate identifier '${
          "name" in node ? node.name : "(unknown)"
        }'. Macro arguments must be static values (literals, arrays, plain objects).`,
      );
    }
    case "Literal": {
      // StringLiteral, NumericLiteral, BooleanLiteral, NullLiteral, BigIntLiteral, RegExpLiteral
      // all use type: "Literal" in oxc ESTree output.
      return node.value;
    }
    case "ObjectExpression": {
      const result: Record<string, unknown> = {};
      for (const prop of node.properties) {
        if (prop.type === "SpreadElement")
          throw new Error(
            "[macros] Spread properties are not supported in macro arguments.",
          );

        // prop is ObjectProperty (type: "Property")
        if (prop.computed)
          throw new Error(
            "[macros] Computed property keys are not supported in macro arguments.",
          );

        let key: string;
        if (prop.key.type === "Identifier") {
          key = "name" in prop.key ? (prop.key.name as string) : "";
        } else if (prop.key.type === "Literal") {
          key = String(prop.key.value);
        } else {
          throw new Error(
            "[macros] Only identifier or literal property keys are supported in macro arguments.",
          );
        }

        result[key] = evaluateStaticExpression(prop.value);
      }

      return result;
    }
    case "ParenthesizedExpression": {
      return evaluateStaticExpression(
        (node as unknown as { expression: Expression }).expression,
      );
    }
    case "TemplateLiteral": {
      // Only support template literals with no expressions (i.e., just a string)
      if (node.expressions.length > 0)
        throw new Error(
          "[macros] Template literals with expressions are not supported in macro arguments. Use plain strings instead.",
        );

      return node.quasis[0]?.value.cooked ?? "";
    }
    case "UnaryExpression": {
      if (node.operator === "-") {
        const operand = evaluateStaticExpression(node.argument);
        if (typeof operand !== "number")
          throw new Error(
            "[macros] Unary minus is only supported on numeric literals.",
          );

        return -operand;
      }

      if (node.operator === "+") {
        const operand = evaluateStaticExpression(node.argument);
        if (typeof operand !== "number") {
          throw new Error(
            "[macros] Unary plus is only supported on numeric literals.",
          );
        }

        return +operand;
      }

      if (node.operator === "!")
        return !evaluateStaticExpression(node.argument);

      throw new Error(
        `[macros] Unsupported unary operator '${node.operator}' in macro arguments.`,
      );
    }
    default: {
      throw new Error(
        `[macros] Cannot statically evaluate expression of type '${node.type}'. ` +
          "Macro arguments must be static values (literals, arrays, plain objects).",
      );
    }
  }
}

/**
 * Serialize a value to a JavaScript source code literal.
 * Only supports JSON-serializable values.
 */
export function serializeToSource(value: unknown): string {
  if (value === undefined) return "undefined";

  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);

  if (typeof value === "number") {
    if (Object.is(value, -0)) return "-0";

    if (!Number.isFinite(value)) {
      if (Number.isNaN(value)) return "NaN";

      return value > 0 ? "Infinity" : "-Infinity";
    }

    return String(value);
  }

  if (typeof value === "boolean") return String(value);

  if (typeof value === "bigint") return `${value}n`;

  if (Array.isArray(value)) {
    const elements = value.map((el) => serializeToSource(el));
    return `[${elements.join(", ")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).map(
      ([k, v]) => `${JSON.stringify(k)}: ${serializeToSource(v)}`,
    );
    return `{${entries.join(", ")}}`;
  }

  throw new Error(
    `[macros] Cannot serialize value of type '${typeof value}' to source code. ` +
      "Macro return values must be JSON-serializable (or undefined).",
  );
}
