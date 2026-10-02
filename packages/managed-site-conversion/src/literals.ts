import ts from "typescript";

/** Literal readings of module-level bindings. Nothing here executes code. */

export type ModuleConstants = ReadonlyMap<string, ts.Expression>;

export function collectModuleConstants(source: ts.SourceFile): ModuleConstants {
  const constants = new Map<string, ts.Expression>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      constants.set(declaration.name.text, declaration.initializer);
    }
  }
  return constants;
}

export function stringValueOf(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return null;
}

export function resolvedStringValueOf(
  expression: ts.Expression,
  constants: ModuleConstants,
): string | null {
  const direct = stringValueOf(expression);
  if (direct !== null) return direct;
  if (!ts.isIdentifier(expression)) return null;
  const bound = constants.get(expression.text);
  return bound === undefined ? null : stringValueOf(bound);
}

export type ObjectLiteralRecord = ReadonlyMap<string, string>;

function readObjectLiteral(expression: ts.Expression): ObjectLiteralRecord | null {
  if (!ts.isObjectLiteralExpression(expression)) return null;
  const record = new Map<string, string>();
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = property.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
    const value = stringValueOf(property.initializer);
    if (key === null || value === null) return null;
    record.set(key, value);
  }
  return record;
}

/**
 * An array of flat string-valued object literals — the shape hand-written
 * repeated content almost always takes. Anything else returns null so the
 * caller reports it instead of half-reading it.
 */
export function objectArrayOf(
  expression: ts.Expression,
  constants: ModuleConstants,
): readonly ObjectLiteralRecord[] | null {
  const target = ts.isIdentifier(expression)
    ? (constants.get(expression.text) ?? null)
    : expression;
  if (target === null || !ts.isArrayLiteralExpression(target)) return null;
  const records: ObjectLiteralRecord[] = [];
  for (const element of target.elements) {
    const record = readObjectLiteral(element);
    if (record === null) return null;
    records.push(record);
  }
  return records.length === 0 ? null : records;
}

/**
 * Evaluates a template literal whose only substitutions are `<param>.<prop>`
 * reads of the supplied item. Used to migrate derived alt text verbatim.
 */
export function templateOverItem(
  expression: ts.Expression,
  parameterName: string,
  item: ObjectLiteralRecord,
): string | null {
  if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (!ts.isTemplateExpression(expression)) return null;
  let text = expression.head.text;
  for (const span of expression.templateSpans) {
    const property = itemPropertyRead(span.expression, parameterName);
    const value = property === null ? null : (item.get(property) ?? null);
    if (value === null) return null;
    text += value + span.literal.text;
  }
  return text;
}

/** `c.name` given parameterName `c` yields `name`; anything else yields null. */
export function itemPropertyRead(
  expression: ts.Expression,
  parameterName: string,
): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  if (!ts.isIdentifier(expression.expression)) return null;
  if (expression.expression.text !== parameterName) return null;
  return expression.name.text;
}
