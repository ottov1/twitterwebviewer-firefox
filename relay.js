"use strict";

// Parser for the Relay store embedded in x.com's server-rendered HTML.
// The payload is a JS-literal object graph with memoised sub-values:
//
//   relayRecords:$R[14]={"client:root":$R[15]={...},VXNlcjo3NDUyNzM:$R[38]={...}}
//
// $R[n]=<value> defines slot n while producing <value>; a bare $R[n]
// reuses it. Values are objects, arrays, strings, numbers, !0 / !1
// (true / false), null and void 0. Records reference each other by id
// through __ref / __refs fields; deref() resolves those.

const STORE_MARKER = "relayRecords:";

const UNQUOTED_KEY = /[A-Za-z0-9_$]/;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

// Merges every relayRecords blob on the page into one flat record map.
// The $R memo is page-global, so it is shared across blobs.
function parseRelayPage(html) {
  const records = {};
  const memo = new Map();
  let found = false;

  let at = html.indexOf(STORE_MARKER);
  while (at >= 0) {
    const parser = new RelayParser(html, at + STORE_MARKER.length, memo);
    Object.assign(records, parser.value());
    found = true;
    at = html.indexOf(STORE_MARKER, parser.pos);
  }

  if (!found)
    throw new Error("relay store not found");
  return records;
}

// Resolves a __ref / __refs wrapper against the record map.
// Plain values pass through untouched.
function deref(records, value) {
  if (!value || typeof value !== "object")
    return value;
  if (value.__ref !== undefined)
    return records[value.__ref] ?? null;
  if (value.__refs !== undefined)
    return value.__refs.map((id) => records[id] ?? null);
  return value;
}

function derefList(records, value) {
  const list = deref(records, value);
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

class RelayParser {
  constructor(src, pos, memo) {
    this.src = src;
    this.pos = pos;
    this.memo = memo;
  }

  fail(what) {
    const near = this.src.slice(this.pos, this.pos + 40);
    throw new Error(`relay parse: ${what} near "${near}"`);
  }

  peek() {
    return this.src[this.pos];
  }

  eat(str) {
    if (!this.src.startsWith(str, this.pos))
      this.fail(`expected "${str}"`);
    this.pos += str.length;
  }

  value() {
    const c = this.peek();

    if (c === "$") return this.slot();
    if (c === '"') return this.string();
    if (c === "{") return this.object({});
    if (c === "[") return this.array([]);
    if (c === "-" || c === "." || (c >= "0" && c <= "9")) return this.number();

    if (c === "!") {
      const bit = this.src[this.pos + 1];
      this.pos += 2;
      if (bit === "0") return true;
      if (bit === "1") return false;
      this.fail("bad ! literal");
    }
    if (this.src.startsWith("null", this.pos)) { this.pos += 4; return null; }
    if (this.src.startsWith("void 0", this.pos)) { this.pos += 6; return null; }
    if (this.src.startsWith("undefined", this.pos)) { this.pos += 9; return null; }

    this.fail("unknown value");
  }

  // $R[n] reference, or $R[n]=<value> definition. Containers are
  // memoised before being filled so cyclic references resolve.
  slot() {
    this.eat("$R[");
    let n = 0;
    while (this.peek() >= "0" && this.peek() <= "9")
      n = n * 10 + (this.src.charCodeAt(this.pos++) - 48);
    this.eat("]");

    if (this.peek() !== "=")
      return this.memo.get(n);
    this.pos++;

    const c = this.peek();
    if (c === "{") {
      const obj = {};
      this.memo.set(n, obj);
      return this.object(obj);
    }
    if (c === "[") {
      const arr = [];
      this.memo.set(n, arr);
      return this.array(arr);
    }
    const v = this.value();
    this.memo.set(n, v);
    return v;
  }

  object(into) {
    this.eat("{");
    if (this.peek() === "}") { this.pos++; return into; }

    for (;;) {
      const key = this.peek() === '"' ? this.string() : this.bareKey();
      this.eat(":");
      into[key] = this.value();

      const c = this.src[this.pos++];
      if (c === "}") return into;
      if (c !== ",") this.fail("bad object separator");
    }
  }

  bareKey() {
    const start = this.pos;
    while (UNQUOTED_KEY.test(this.peek()))
      this.pos++;
    if (this.pos === start)
      this.fail("empty key");
    return this.src.slice(start, this.pos);
  }

  array(into) {
    this.eat("[");
    if (this.peek() === "]") { this.pos++; return into; }

    for (;;) {
      into.push(this.value());
      const c = this.src[this.pos++];
      if (c === "]") return into;
      if (c !== ",") this.fail("bad array separator");
    }
  }

  string() {
    this.eat('"');
    let out = "";

    for (;;) {
      const c = this.src[this.pos++];
      if (c === undefined) this.fail("unterminated string");
      if (c === '"') return out;
      if (c !== "\\") { out += c; continue; }

      const e = this.src[this.pos++];
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "v": out += "\v"; break;
        case "0": out += "\0"; break;
        case "x":
          out += String.fromCharCode(parseInt(this.src.substr(this.pos, 2), 16));
          this.pos += 2;
          break;
        case "u":
          if (this.peek() === "{") {
            const end = this.src.indexOf("}", this.pos);
            out += String.fromCodePoint(parseInt(this.src.slice(this.pos + 1, end), 16));
            this.pos = end + 1;
          } else {
            out += String.fromCharCode(parseInt(this.src.substr(this.pos, 4), 16));
            this.pos += 4;
          }
          break;
        default: out += e;
      }
    }
  }

  number() {
    const m = this.src.slice(this.pos, this.pos + 32).match(NUMBER);
    if (!m) this.fail("bad number");
    this.pos += m[0].length;
    return Number(m[0]);
  }
}
