export type ScadExpr =
  | { kind: 'number'; value: number; text: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'identifier'; name: string }
  | { kind: 'vector'; items: ScadExpr[] }
  | { kind: 'binary'; op: string; left: ScadExpr; right: ScadExpr }
  | { kind: 'unary'; op: string; operand: ScadExpr }
  | { kind: 'call'; name: string; args: ScadArg[] };

export interface ScadArg {
  name?: string;
  value: ScadExpr;
}

export type ScadStmt =
  | { kind: 'assignment'; name: string; value: ScadExpr }
  | { kind: 'call'; name: string; args: ScadArg[]; children: ScadStmt[] }
  | { kind: 'module'; name: string; parameters: string[]; body: ScadStmt[] };

export interface ScadProgram {
  statements: ScadStmt[];
}

export class ScadSyntaxError extends Error {}

interface Token {
  kind: 'number' | 'identifier' | 'string' | 'punct' | 'eof';
  value: string;
  number?: number;
  position: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new ScadSyntaxError('Unterminated block comment.');
      index = end + 2;
      continue;
    }
    if (char === '"') {
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          const next = source[index + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] !== '"') throw new ScadSyntaxError('Unterminated string.');
      index += 1;
      tokens.push({ kind: 'string', value, position: index });
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const rest = source.slice(index);
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      if (!match) throw new ScadSyntaxError(`Invalid number near: ${rest.slice(0, 12)}`);
      tokens.push({
        kind: 'number',
        value: match[0],
        number: Number(match[0]),
        position: index,
      });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
      if (!match) throw new ScadSyntaxError(`Invalid identifier at ${index}.`);
      tokens.push({ kind: 'identifier', value: match[0], position: index });
      index += match[0].length;
      continue;
    }
    if ('(){}[],;=+-*/%<>!?:'.includes(char)) {
      tokens.push({ kind: 'punct', value: char, position: index });
      index += 1;
      continue;
    }
    throw new ScadSyntaxError(`Unexpected character "${char}" at ${index}.`);
  }

  tokens.push({ kind: 'eof', value: '', position: source.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private index = 0;
  readonly warnings: string[] = [];

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse(): ScadProgram {
    return { statements: this.parseStatements(false) };
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private accept(kind: Token['kind'], value?: string): Token | null {
    const token = this.peek();
    if (token.kind !== kind) return null;
    if (value !== undefined && token.value !== value) return null;
    this.index += 1;
    return token;
  }

  private expect(kind: Token['kind'], value?: string): Token {
    const token = this.accept(kind, value);
    if (!token) {
      const found = this.peek();
      throw new ScadSyntaxError(
        `Expected ${value ?? kind}, found "${found.value || 'end of file'}" at ${found.position}.`,
      );
    }
    return token;
  }

  private parseStatements(untilBrace: boolean): ScadStmt[] {
    const statements: ScadStmt[] = [];
    while (this.peek().kind !== 'eof') {
      if (untilBrace && this.peek().value === '}') break;
      statements.push(this.parseStatement());
    }
    return statements;
  }

  private parseStatement(): ScadStmt {
    const token = this.peek();
    if (token.kind === 'identifier' && token.value === 'module') {
      this.next();
      const name = this.expect('identifier').value;
      const parameters: string[] = [];
      if (this.accept('punct', '(')) {
        while (this.peek().value !== ')') {
          parameters.push(this.expect('identifier').value);
          if (!this.accept('punct', ',')) break;
        }
        this.expect('punct', ')');
      }
      this.expect('punct', '{');
      const body = this.parseStatements(true);
      this.expect('punct', '}');
      return { kind: 'module', name, parameters, body };
    }
    if (token.kind === 'identifier' && token.value === 'function') {
      throw new ScadSyntaxError('Function definitions are not supported.');
    }
    if (token.kind === 'identifier' && (token.value === 'include' || token.value === 'use')) {
      throw new ScadSyntaxError('include and use are not supported.');
    }

    const name = this.expect('identifier').value;
    if (this.accept('punct', '=')) {
      const value = this.parseExpression();
      this.expect('punct', ';');
      return { kind: 'assignment', name, value };
    }
    if (!this.accept('punct', '(')) {
      throw new ScadSyntaxError(`Expected "(" after ${name}.`);
    }
    const args = this.parseArguments();
    this.expect('punct', ')');
    let children: ScadStmt[] = [];
    if (this.accept('punct', '{')) {
      children = this.parseStatements(true);
      this.expect('punct', '}');
    } else if (!this.accept('punct', ';')) {
      // SCAD also allows a single child statement without braces.
      children = [this.parseStatement()];
    }
    return { kind: 'call', name, args, children };
  }

  private parseArguments(): ScadArg[] {
    const args: ScadArg[] = [];
    if (this.peek().value === ')') return args;
    while (true) {
      if (this.peek().kind === 'identifier' && this.peek(1).value === '=') {
        const name = this.next().value;
        this.expect('punct', '=');
        args.push({ name, value: this.parseExpression() });
      } else {
        args.push({ value: this.parseExpression() });
      }
      if (!this.accept('punct', ',')) break;
    }
    return args;
  }

  private parseExpression(): ScadExpr {
    return this.parseAdditive();
  }

  private parseAdditive(): ScadExpr {
    let left = this.parseMultiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ScadExpr {
    let left = this.parseUnary();
    while (['*', '/', '%'].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ScadExpr {
    if (this.peek().value === '-' || this.peek().value === '+') {
      const op = this.next().value;
      return { kind: 'unary', op, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ScadExpr {
    const token = this.peek();
    if (token.kind === 'number') {
      this.next();
      return { kind: 'number', value: token.number ?? 0, text: token.value };
    }
    if (token.kind === 'string') {
      this.next();
      return { kind: 'string', value: token.value };
    }
    if (token.value === '[') {
      this.next();
      const items: ScadExpr[] = [];
      if (this.peek().value !== ']') {
        while (true) {
          items.push(this.parseExpression());
          if (!this.accept('punct', ',')) break;
        }
      }
      this.expect('punct', ']');
      return { kind: 'vector', items };
    }
    if (token.value === '(') {
      this.next();
      const expr = this.parseExpression();
      this.expect('punct', ')');
      return expr;
    }
    if (token.kind === 'identifier') {
      this.next();
      if (token.value === 'true' || token.value === 'false') {
        return { kind: 'boolean', value: token.value === 'true' };
      }
      if (this.accept('punct', '(')) {
        const args = this.parseArguments();
        this.expect('punct', ')');
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'identifier', name: token.value };
    }
    throw new ScadSyntaxError(`Unexpected token "${token.value}" at ${token.position}.`);
  }
}

export function parseScad(source: string): ScadProgram {
  return new Parser(source).parse();
}

export function expressionToScad(expr: ScadExpr): string {
  switch (expr.kind) {
    case 'number':
      return expr.text;
    case 'boolean':
      return expr.value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(expr.value);
    case 'identifier':
      return expr.name;
    case 'vector':
      return `[${expr.items.map(expressionToScad).join(', ')}]`;
    case 'binary':
      return `(${expressionToScad(expr.left)} ${expr.op} ${expressionToScad(expr.right)})`;
    case 'unary':
      return `${expr.op}(${expressionToScad(expr.operand)})`;
    case 'call':
      return `${expr.name}(${expr.args
        .map((arg) => (arg.name ? `${arg.name} = ${expressionToScad(arg.value)}` : expressionToScad(arg.value)))
        .join(', ')})`;
  }
}

export function evaluateNumber(
  expr: ScadExpr,
  parameters: Map<string, number>,
): number | null {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'boolean':
      return expr.value ? 1 : 0;
    case 'identifier':
      return parameters.get(expr.name) ?? null;
    case 'unary': {
      const value = evaluateNumber(expr.operand, parameters);
      if (value === null) return null;
      return expr.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateNumber(expr.left, parameters);
      const right = evaluateNumber(expr.right, parameters);
      if (left === null || right === null) return null;
      switch (expr.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? null : left / right;
        case '%':
          return right === 0 ? null : left % right;
        default:
          return null;
      }
    }
    case 'vector':
      return null;
    case 'string':
      return null;
    case 'call':
      return null;
  }
}
