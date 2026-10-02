import ts from "typescript";

import { isComponentName } from "./jsx-facts.js";

/**
 * Which names a piece of syntax binds.
 *
 * Two readers need this and they must not drift apart. The value resolver asks
 * whether a module-level `const` is shadowed at a reference; the prop-role
 * reader asks whether a prop name is rebound between a reference and the
 * component that declares it. Those are the same question with different stop
 * points, so they are one derivation with a parameter — not two lists that
 * agree right up until one of them is extended.
 */

/**
 * What introduces a scope, and what belongs to which — the table this file
 * implements, so the next reader can check it rather than infer it:
 *
 * | binding                        | belongs to                          |
 * | ------------------------------ | ----------------------------------- |
 * | `var`                          | the nearest function, else the module |
 * | function declaration           | the nearest block (a module is strict) |
 * | `let`, `const`, `class`        | the nearest block                   |
 * | a parameter                    | its function                        |
 * | a `catch` parameter            | its catch clause                    |
 * | a `for`/`for-of`/`for-in` head | the loop, condition and body        |
 * | a named function/class expression | itself                           |
 *
 * And the scopes themselves: the source file, a module block, any function-like
 * body, a block, a `catch` clause, a loop, and a `switch`'s CASE BLOCK — one
 * scope shared by every unbraced clause, not one per clause.
 */

/** Every name a binding introduces, including destructured and renamed ones. */
export function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, into);
    }
  }
}




/**
 * The syntax that binds `name` in this scope, or null.
 *
 * `declaresName` is this question with the answer thrown away, and a caller
 * that needs to know WHAT the name is — a local component it can read, or an
 * opaque parameter it cannot — was left approximating. One walk answers both,
 * so the two cannot drift.
 */
/**
 * Whether this syntax can introduce a binding at all.
 *
 * The same list `declarationOfName` walks, named once. A reader that
 * enumerated "block, module block, case clause" separately left out loop
 * initializers, and a component declared in one passed as module scoped.
 */
function isLoopStatement(node: ts.Node): node is ts.ForStatement | ts.ForOfStatement | ts.ForInStatement {
  return ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
}

export function isScopeNode(node: ts.Node): boolean {
  return (
    isFunctionLike(node) ||
    ts.isCatchClause(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    isLoopStatement(node)
  );
}

/** The `var` declaration of this name in a function body, however deeply nested. */
function hoistedVarDeclaration(body: ts.Node, name: string): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    // A nested function has its own `var` scope; its declarations are not ours.
    if (isFunctionLike(node)) return;
    // Every declaration LIST, so a `for (var …)` initializer counts as readily
    // as a statement — a `var` is function-scoped wherever it is written, and
    // looking only at statements left the loop spelling unresolved.
    if (ts.isVariableDeclarationList(node) && isVarStatement(node)) {
      for (const declaration of node.declarations) {
        const names = new Set<string>();
        bindingNames(declaration.name, names);
        if (names.has(name)) {
          found = declaration;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function isVarStatement(list: ts.VariableDeclarationList): boolean {
  return (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
}

/**
 * Whether this declaration's binding belongs to the nearest FUNCTION rather
 * than to the nearest block.
 *
 * Only `var` does. Treating every declaration alike put a `var` written in a
 * block out of scope after that block, which the language does not do — but a
 * FUNCTION declaration is not the same case, however much it looks like one:
 * an ES module is strict, and a function declared inside a block is scoped to
 * that block exactly as a `let` is. Hoisting it made a declaration in a
 * top-level `if` answer for a tag outside it, and the walk then extracted
 * markup nothing renders.
 *
 * A function written directly in a function body or at module top level still
 * reaches that whole scope, because the block it belongs to IS that scope.
 */
export function isFunctionScoped(declaration: ts.Node): boolean {
  if (!ts.isVariableDeclaration(declaration)) return false;
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && isVarStatement(list);
}

/**
 * The scope a declaration's binding lives in: the source file, a function, or
 * a block. `isFunctionScoped` decides which kind of ancestor to stop at.
 */
export function scopeOfDeclaration(declaration: ts.Node): ts.Node | null {
  const stopsAtFunction = isFunctionScoped(declaration);
  let current: ts.Node | undefined = declaration.parent;
  while (current !== undefined) {
    if (ts.isSourceFile(current)) return current;
    if (stopsAtFunction ? isFunctionLike(current) : isScopeNode(current)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * The nearest syntax binding this name between the node and the module.
 *
 * Null means the name is the module's own — an import, or a module-level
 * declaration — because a nearer binding of an imported name is the one the
 * language reads. Every reader that resolves a name written INSIDE a function
 * needs this: a parameter called `UI` renders where the analyzer read `UI.Card`
 * from the import, and a `const notFound` is not the framework's.
 */
export function nearestBinding(node: ts.Node, name: string): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    const declaration = declarationOfName(current, name);
    if (declaration !== null) return declaration;
    current = current.parent;
  }
  return null;
}

export function declarationOfName(node: ts.Node, name: string): ts.Node | null {
  if (isFunctionLike(node)) {
    for (const parameter of node.parameters) {
      const names = new Set<string>();
      bindingNames(parameter.name, names);
      if (names.has(name)) return parameter;
    }
    // A hoisted `var` belongs to this function, but the DECLARATION is where
    // it was written. Returning the function said "something here binds it"
    // and lost the only thing a caller can read.
    if (node.body !== undefined) {
      const hoisted = hoistedVarDeclaration(node.body, name);
      if (hoisted !== null) return hoisted;
    }
  }
  if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    for (const parameter of node.parameters) {
      const names = new Set<string>();
      bindingNames(parameter.name, names);
      if (names.has(name)) return parameter;
    }
  }
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    for (const parameter of node.parameters) {
      const names = new Set<string>();
      bindingNames(parameter.name, names);
      if (names.has(name)) return parameter;
    }
  }
  if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
    const names = new Set<string>();
    bindingNames(node.variableDeclaration.name, names);
    if (names.has(name)) return node.variableDeclaration;
  }
  // A named function or class EXPRESSION binds its own name inside itself.
  if (
    (ts.isFunctionExpression(node) ||
      ts.isClassExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)) &&
    node.name?.text === name
  ) {
    return node;
  }
  if (ts.isBlock(node)) {
    for (const statement of node.statements) {
      const found = declaredByStatement(statement, name);
      if (found !== null) return found;
    }
  }
  // A `switch` has ONE scope shared by every unbraced clause, so the whole
  // case block is searched. Reading a single clause lost a binding that falls
  // through to the clause using it; a BRACED clause is a Block of its own and
  // is found by the branch above.
  if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) {
      for (const statement of clause.statements) {
        const found = declaredByStatement(statement, name);
        if (found !== null) return found;
      }
    }
  }
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const initializer = node.initializer;
    if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
      const found = declaredByList(initializer, name);
      if (found !== null) return found;
    }
  }
  return null;
}

function declaredByStatement(statement: ts.Statement, name: string): ts.Node | null {
  if (ts.isVariableStatement(statement)) {
    return declaredByList(statement.declarationList, name);
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name?.text === name
  ) {
    return statement;
  }
  return null;
}

function declaredByList(list: ts.VariableDeclarationList, name: string): ts.Node | null {
  for (const declaration of list.declarations) {
    const names = new Set<string>();
    bindingNames(declaration.name, names);
    if (names.has(name)) return declaration;
  }
  return null;
}

/**
 * Every construct with parameters and a body of its own.
 *
 * A constructor, a getter and a setter are function bodies as surely as a
 * method is, and each list that left them out disagreed with a list that did
 * not — a `var` inside a constructor hoisted past it, and a component declared
 * there read as module scoped. There is one of this list now, and every reader
 * asks it.
 */
export type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/**
 * Whether this syntax binds `name`.
 *
 * The same walk as `declarationOfName` with the answer thrown away, so it IS
 * that walk. Two implementations of one scoping rule agree right up until one
 * is extended: this one still read a single `switch` clause after the other
 * learned that a case block is one scope, and it collected hoisted `var`s for
 * four kinds of function body where the other knew seven.
 */
export function declaresName(node: ts.Node, name: string): boolean {
  return declarationOfName(node, name) !== null;
}

/**
 * Whether anything between `node` and `root` binds `name`.
 *
 * A null `root` walks to the top of the file, which is what "shadows the
 * module's binding" means. A node `root` stops there, which is what "rebound
 * between this reference and the component that declares the prop" means.
 */
export function isBoundBetween(node: ts.Node, root: ts.Node | null, name: string): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && current !== root && !ts.isSourceFile(current)) {
    if (declaresName(current, name)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Whether an identifier is a USE of a value, rather than a place a name is
 * written down. A declaration's own name, a property key, a binding element and
 * an import specifier all spell the name without reading the object, and
 * counting them as uses would report every declaration as escaped — including
 * the line that declares it.
 */
export function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  // `obj.name` NAMES a property; `obj[key]` USES the binding `key`. The two
  // look alike and are not: excluding the computed key made a value read as a
  // lookup key invisible, so a prop used that way looked unread.
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent)) return false;
  if (ts.isPropertyDeclaration(parent)) return parent.initializer === node;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return false;
  if (ts.isFunctionExpression(parent) || ts.isClassExpression(parent)) return false;
  // A parameter, a binding element and a class field each have a NAME and a
  // VALUE. Only the name is a mention; `function f(value = copy)` and
  // `class M { field = copy }` hand the object out exactly as any other
  // expression does.
  if (ts.isParameter(parent)) return parent.initializer === node;
  if (ts.isBindingElement(parent)) return parent.initializer === node;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  // A lowercase JSX tag names an ELEMENT — React reads it as a string — so it
  // is not a use of anything called `main`. A capitalised one IS a use of the
  // binding it names.
  if (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === node
  ) {
    return isComponentName(node.text);
  }
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isImportEqualsDeclaration(parent)) return false;
  if (ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) return false;
  if (ts.isEnumMember(parent) || ts.isTypeReferenceNode(parent)) return false;
  if (ts.isQualifiedName(parent)) return false;
  // `typeof copy` names the value's TYPE. No type can write to it.
  if (ts.isTypeQueryNode(parent)) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  // `{ copy }` is deliberately NOT excluded. The identifier is both the key and
  // the value there, and as the value it hands the object out — so treating the
  // shorthand as a name-only mention would miss `const w = { copy };
  // w.copy.title = …` entirely.
  return true;
}
