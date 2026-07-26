#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/date.js
var DATE_TIME_RE, TomlDate;
var init_date = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
  TomlDate = class TomlDate extends Date {
    #hasDate = false;
    #hasTime = false;
    #offset = null;
    constructor(date) {
      let hasDate = true;
      let hasTime = true;
      let offset = "Z";
      if (typeof date === "string") {
        let match = date.match(DATE_TIME_RE);
        if (match) {
          if (!match[1]) {
            hasDate = false;
            date = `0000-01-01T${date}`;
          }
          hasTime = !!match[2];
          hasTime && date[10] === " " && (date = date.replace(" ", "T"));
          if (match[2] && +match[2] > 23) {
            date = "";
          } else {
            offset = match[3] || null;
            date = date.toUpperCase();
            if (!offset && hasTime)
              date += "Z";
          }
        } else {
          date = "";
        }
      }
      super(date);
      if (!isNaN(this.getTime())) {
        this.#hasDate = hasDate;
        this.#hasTime = hasTime;
        this.#offset = offset;
      }
    }
    isDateTime() {
      return this.#hasDate && this.#hasTime;
    }
    isLocal() {
      return !this.#hasDate || !this.#hasTime || !this.#offset;
    }
    isDate() {
      return this.#hasDate && !this.#hasTime;
    }
    isTime() {
      return this.#hasTime && !this.#hasDate;
    }
    isValid() {
      return this.#hasDate || this.#hasTime;
    }
    toISOString() {
      let iso = super.toISOString();
      if (this.isDate())
        return iso.slice(0, 10);
      if (this.isTime())
        return iso.slice(11, 23);
      if (this.#offset === null)
        return iso.slice(0, -1);
      if (this.#offset === "Z")
        return iso;
      let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
      offset = this.#offset[0] === "-" ? offset : -offset;
      let offsetDate = new Date(this.getTime() - offset * 60000);
      return offsetDate.toISOString().slice(0, -1) + this.#offset;
    }
    static wrapAsOffsetDateTime(jsDate, offset = "Z") {
      let date = new TomlDate(jsDate);
      date.#offset = offset;
      return date;
    }
    static wrapAsLocalDateTime(jsDate) {
      let date = new TomlDate(jsDate);
      date.#offset = null;
      return date;
    }
    static wrapAsLocalDate(jsDate) {
      let date = new TomlDate(jsDate);
      date.#hasTime = false;
      date.#offset = null;
      return date;
    }
    static wrapAsLocalTime(jsDate) {
      let date = new TomlDate(jsDate);
      date.#hasDate = false;
      date.#offset = null;
      return date;
    }
  };
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1;i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += `
`;
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += `^
`;
    }
  }
  return codeblock;
}
var TomlError;
var init_error = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  TomlError = class TomlError extends Error {
    line;
    column;
    codeblock;
    constructor(message, options) {
      const [line, column] = getLineColFromPtr(options.toml, options.ptr);
      const codeblock = makeCodeBlock(options.toml, line, column);
      super(`Invalid TOML document: ${message}

${codeblock}`, options);
      this.line = line;
      this.column = column;
      this.codeblock = codeblock;
    }
  };
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/primitive.js
function parseString(str, ptr) {
  let c = str[ptr++];
  let first = c;
  let isLiteral = c === "'";
  let isMultiline = c === str[ptr] && c === str[ptr + 1];
  if (isMultiline) {
    if (str[ptr += 2] === `
`)
      ptr++;
    else if (str[ptr] === "\r" && str[ptr + 1] === `
`)
      ptr += 2;
  }
  let parsed = "";
  let sliceStart = ptr;
  let state = 0;
  for (let i = ptr;i < str.length; i++) {
    c = str[i];
    if (isMultiline && (c === `
` || c === "\r" && str[i + 1] === `
`)) {
      state = state && 3;
    } else if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: i
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || str[i + 1] === first && str[i + 2] === first)) {
      if (isMultiline) {
        if (str[i + 3] === first)
          i++;
        if (str[i + 3] === first)
          i++;
      }
      return [
        state ? parsed : parsed + str.slice(sliceStart, i),
        i + (isMultiline ? 3 : 1)
      ];
    } else if (!state) {
      if (!isLiteral && c === "\\") {
        parsed += str.slice(sliceStart, sliceStart = i);
        state = 1;
      }
    } else if (state === 1) {
      if (c === "x" || c === "u" || c === "U") {
        let value = 0;
        let len = c === "x" ? 2 : c === "u" ? 4 : 8;
        for (let j = 0;j < len; j++, i++) {
          let hex = str.charCodeAt(i + 1);
          let digit = hex >= 48 && hex <= 57 ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 65 + 10 : hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1;
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: str, ptr: i + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: str, ptr: i });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = i + 1;
        state = 0;
      } else if (c === " " || c === "\t") {
        state = 2;
      } else {
        if (c === "b")
          parsed += "\b";
        else if (c === "t")
          parsed += "\t";
        else if (c === "n")
          parsed += `
`;
        else if (c === "f")
          parsed += "\f";
        else if (c === "r")
          parsed += "\r";
        else if (c === "e")
          parsed += "\x1B";
        else if (c === '"')
          parsed += '"';
        else if (c === "\\")
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: str, ptr: i });
        sliceStart = i + 1;
        state = 0;
      }
    } else if (c !== " " && c !== "\t") {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: str,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === "\\" ? 1 : 0;
      sliceStart = i;
    }
  }
  throw new TomlError("unfinished string", { toml: str, ptr });
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}
var INT_REGEX, FLOAT_REGEX, LEADING_ZERO;
var init_primitive = __esm(() => {
  init_date();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
  FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
  LEADING_ZERO = /^[+-]?0[0-9_]/;
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf(`
`, start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === `
`)
      return i;
    if (c === "\r" && str[i + 1] === `
`)
      return i + 1;
    if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while (true) {
    while ((c = str[ptr]) === " " || c === "\t" || !banNewLines && (c === `
` || c === "\r" && str[ptr + 1] === `
`))
      ptr++;
    if (banComments || c !== "#")
      break;
    ptr = skipComment(str, ptr);
  }
  return ptr;
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === `
` || c === "\r" && str[i + 1] === `
`)) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}
var init_util = __esm(() => {
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/extract.js
function sliceAndTrimEndOf(str, startPtr, endPtr) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] === ",")
        endPtr2++;
      else if (str[endPtr2] !== end) {
        throw new TomlError("expected comma or end of structure", {
          toml: str,
          ptr: endPtr2
        });
      }
    }
    return [value, endPtr2];
  }
  if (c === '"' || c === "'") {
    let [parsed, endPtr2] = parseString(str, ptr);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] && str[endPtr2] !== "," && str[endPtr2] !== end && str[endPtr2] !== `
` && str[endPtr2] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr2
        });
      }
      if (str[endPtr2] === ",")
        endPtr2++;
    }
    return [parsed, endPtr2];
  }
  let endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - (str[endPtr - 1] === "," ? 1 : 0));
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    if (str[endPtr] === ",")
      endPtr++;
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}
var init_extract = __esm(() => {
  init_primitive();
  init_struct();
  init_util();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/struct.js
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "\t") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let [part, eos] = parseString(str, ptr);
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(part);
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = new Set;
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "\t" && c !== `
` && c !== "\r") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0;i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
    }
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "\t" && c !== `
` && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
var KEY_PART_RE;
var init_struct = __esm(() => {
  init_primitive();
  init_extract();
  init_util();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
  KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0;i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1000, integersAsBigInt } = {}) {
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0);ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(k[0], res, meta, isTableArray ? 2 : 1);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(k[0], tbl, m, 0);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], undefined, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== `
` && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}
var init_parse = __esm(() => {
  init_struct();
  init_extract();
  init_util();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/stringify.js
var init_stringify = __esm(() => {
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// ../../node_modules/.bun/smol-toml@1.7.0/node_modules/smol-toml/dist/index.js
var init_dist = __esm(() => {
  init_parse();
  init_stringify();
  init_date();
  init_error();
  /*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   */
});

// src/color.ts
function colorLevel(stream = process.stdout) {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "")
    return 0;
  if (env.FORCE_COLOR === "0" || env.CLICOLOR === "0")
    return 0;
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" || env.CLICOLOR_FORCE !== undefined && env.CLICOLOR_FORCE !== "0";
  if (!forced) {
    if (env.TERM === "dumb")
      return 0;
    if (!stream.isTTY)
      return 0;
  }
  const term = env.TERM ?? "";
  const colorterm = env.COLORTERM ?? "";
  if (/truecolor|24bit/i.test(colorterm))
    return 3;
  if (/-256(color)?$/i.test(term) || term === "xterm-kitty" || colorterm !== "")
    return 2;
  return 1;
}
function code(role, level) {
  switch (role) {
    case "label":
    case "quiet":
      return "2";
    case "ok":
      return "32";
    case "bad":
      return "31";
    case "repo":
      if (level === 3)
        return `38;2;${REPO.r};${REPO.g};${REPO.b}`;
      if (level === 2)
        return `38;5;${REPO_256}`;
      return "35";
    case "brand":
    case "attn": {
      const bold = role === "attn" ? "1;" : "";
      if (level === 3)
        return `${bold}38;2;${BRAND.r};${BRAND.g};${BRAND.b}`;
      if (level === 2)
        return `${bold}38;5;${BRAND_256}`;
      return `${bold}33`;
    }
  }
}
function paint(role, text, level = colorLevel()) {
  if (level === 0 || text === "")
    return text;
  const sgr = code(role, level);
  return sgr ? `\x1B[${sgr}m${text}\x1B[0m` : text;
}
function stripColor(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
var BRAND, BRAND_256 = 214, REPO, REPO_256 = 99;
var init_color = __esm(() => {
  BRAND = { r: 255, g: 198, b: 30 };
  REPO = { r: 139, g: 92, b: 246 };
});

// src/redaction.ts
function hasNoRedactPragma(text) {
  return text.split(/\r\n|\r|\n/, PRAGMA_SCAN_LINES).some((line) => NO_REDACT_PRAGMA_REGEX.test(line));
}
function redactText(input, mode = DEFAULT_REDACTION_MODE) {
  if (mode === "none")
    return input;
  let output = input.replace(PEM_PRIVATE_KEY_REGEX, "<PRIVATEKEY>").replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(URL_CREDENTIALS_REGEX, (_match, prefix) => `${prefix}:<SECRET>@`).replace(QUOTED_SECRET_REGEX, (match, ...args) => {
    const { keyQuote = "", key, separator, valueQuote } = args.at(-1);
    if (!isSensitiveKey(key))
      return match;
    return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}`;
  }).replace(BARE_ASSIGNMENT_SECRET_REGEX, (match, key, separator) => isSensitiveKey(key) ? `${key}${separator}${placeholderForKey(key)}` : match);
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  if (mode === "secrets")
    return output;
  return output.replace(EMAIL_REGEX, "<EMAIL>").replace(PHONE_REGEX, "<PHONENUMBER>").replace(SSN_REGEX, "<SSN>").replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) => isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate);
}
function countRedactionPlaceholders(text) {
  return text.match(PLACEHOLDER_REGEX)?.length ?? 0;
}
function placeholderForKey(key) {
  if (/api[_-]?key/i.test(key))
    return "<API_KEY>";
  if (/password|passwd|pwd|passphrase|secret|private/i.test(key))
    return "<SECRET>";
  return "<TOKEN>";
}
function isSensitiveKey(key) {
  const normalized = key.replace(/-/g, "_");
  const lower = normalized.toLowerCase();
  const compact = lower.replace(/_/g, "");
  if (COMPACT_SENSITIVE_KEYS.has(compact))
    return true;
  const parts = normalized.toUpperCase().split("_").filter(Boolean);
  const last = parts.at(-1);
  if (["PASSWORD", "PASSWD", "PWD", "PASSPHRASE", "TOKEN", "SECRET"].includes(last ?? "")) {
    return true;
  }
  if (parts.includes("API") && parts.includes("KEY"))
    return true;
  if (parts.includes("ACCESS") && parts.includes("TOKEN"))
    return true;
  if (parts.includes("REFRESH") && parts.includes("TOKEN"))
    return true;
  if (parts.includes("SECRET") && (parts.includes("KEY") || parts.includes("ACCESS")))
    return true;
  if (parts.includes("PRIVATE") && parts.includes("KEY"))
    return true;
  return false;
}
function isLikelyCreditCard(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19)
    return false;
  if (!/[ -]/.test(value) && digits.length !== 15 && digits.length !== 16)
    return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1;index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9)
        digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}
var DEFAULT_REDACTION_MODE = "secrets+pii", REDACTION_MODES, NO_REDACT_PRAGMA = "sidecar:no-redact", PRAGMA_SCAN_LINES = 30, NO_REDACT_PRAGMA_REGEX, KEY_NAME_PATTERN, QUOTED_SECRET_REGEX, BARE_ASSIGNMENT_SECRET_REGEX, AUTHORIZATION_HEADER_REGEX, PEM_PRIVATE_KEY_REGEX, URL_CREDENTIALS_REGEX, BARE_BEARER_TOKEN_REGEX, TOKEN_PATTERNS, EMAIL_REGEX, PHONE_REGEX, SSN_REGEX, CREDIT_CARD_CANDIDATE_REGEX, PLACEHOLDER_REGEX, COMPACT_SENSITIVE_KEYS;
var init_redaction = __esm(() => {
  REDACTION_MODES = ["none", "secrets", "secrets+pii"];
  NO_REDACT_PRAGMA_REGEX = new RegExp(String.raw`^\s*[^\w\s]{0,4}\s*${NO_REDACT_PRAGMA}\b`);
  KEY_NAME_PATTERN = String.raw`[A-Za-z0-9_][A-Za-z0-9_-]*`;
  QUOTED_SECRET_REGEX = new RegExp(String.raw`(?:(?<keyQuote>["'])|\b)(?<key>${KEY_NAME_PATTERN})\k<keyQuote>` + String.raw`(?<separator>\s*[:=]\s*)(?<valueQuote>["'])(?:\\[^\r\n]|(?!\k<valueQuote>)[^\\\r\n])+\k<valueQuote>`, "g");
  BARE_ASSIGNMENT_SECRET_REGEX = new RegExp(String.raw`\b(${KEY_NAME_PATTERN})(\s*[:=]\s*)([^\s"',;` + "`" + String.raw`]+)`, "g");
  AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)([^\s"',;`]+)/gi;
  PEM_PRIVATE_KEY_REGEX = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;
  URL_CREDENTIALS_REGEX = /(\/\/[^\s/:@"'`]+):([^\s/@"'`]+)@/g;
  BARE_BEARER_TOKEN_REGEX = /\b(Bearer\s+)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g;
  TOKEN_PATTERNS = [
    [/\bAKIA[0-9A-Z]{16}\b/g, "<API_KEY>"],
    [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<TOKEN>"],
    [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<TOKEN>"]
  ];
  EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g;
  SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
  PLACEHOLDER_REGEX = /<(?:API_KEY|TOKEN|SECRET|PRIVATEKEY|EMAIL|PHONENUMBER|SSN|CREDITCARD)>/g;
  COMPACT_SENSITIVE_KEYS = new Set([
    "apikey",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "authtoken",
    "githubtoken",
    "bearertoken",
    "clientsecret",
    "credential",
    "credentials",
    "secretkey",
    "privatekey",
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "token",
    "secret"
  ]);
});

// src/daemon.ts
var exports_daemon = {};
__export(exports_daemon, {
  selectWatchTargets: () => selectWatchTargets,
  runDaemonLoop: () => runDaemonLoop,
  compileGitignoreMatcher: () => compileGitignoreMatcher,
  checkAndInstallUpdate: () => checkAndInstallUpdate,
  WATCH_LIMIT: () => WATCH_LIMIT
});
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
async function runDaemonLoop(options) {
  const state = {
    options,
    syncing: new Set,
    lastSyncEndAt: new Map,
    pendingTimers: new Map,
    trailingPending: new Set,
    failures: new Map,
    skipUntilCycle: new Map,
    misses: new Map,
    watchers: new Map,
    cycleCount: 0,
    lastWatchCount: -1,
    refreshing: false,
    staleNotified: false
  };
  console.log(`sidecar daemon polling every ${options.intervalSeconds}s`);
  logSidecarEvent("daemon-start", {
    intervalSeconds: options.intervalSeconds,
    debounceSeconds: options.debounceSeconds,
    once: options.once,
    pid: process.pid
  });
  if (options.once) {
    await runCycle(state);
    return 0;
  }
  await acquireDaemonPid();
  installShutdownHandlers();
  await watchRegistry(state);
  const bootVersion = packageVersion();
  while (true) {
    maybeAdoptNewerInstall(state, bootVersion);
    await runCycle(state);
    ensureDaemonServiceFile();
    await refreshWatchers(state);
    await maybeAutoUpdate();
    await delay(options.intervalSeconds * 1000);
  }
}
function maybeAdoptNewerInstall(state, bootVersion) {
  const diskVersion = packageVersion();
  if (diskVersion !== bootVersion) {
    logSidecarEvent("daemon-stale", { running: bootVersion, installed: diskVersion, reason: "in-place-update" });
    restartAfterUpdate();
    return;
  }
  const onPath = findGlobalSidecarExecutable();
  if (!onPath)
    return;
  if (realpathOr(onPath) === realpathOr(currentCliPath()))
    return;
  const pathVersion = globalSidecarVersion(onPath);
  if (!pathVersion || pathVersion === diskVersion)
    return;
  if (process.stdout.isTTY) {
    if (!state.staleNotified) {
      state.staleNotified = true;
      console.log(`sidecar v${pathVersion} is installed at ${onPath}; run \`sidecar daemon restart\` to switch to it`);
    }
    return;
  }
  logSidecarEvent("daemon-stale", {
    running: diskVersion,
    installed: pathVersion,
    executable: onPath,
    reason: "new-install"
  });
  const child = spawn(onPath, ["daemon", "restart"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1" }
  });
  child.unref();
}
async function runCycle(state) {
  const settings = readSettings();
  if (!settings.daemonEnabled) {
    logSidecarEvent("daemon-skip", { reason: "daemon-disabled" });
    return;
  }
  state.cycleCount += 1;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  for (const instance of readInstances()) {
    if (!fs.existsSync(instance.configPath)) {
      const misses = (state.misses.get(instance.root) ?? 0) + 1;
      state.misses.set(instance.root, misses);
      if (misses >= PRUNE_AFTER_MISSES) {
        pruneInstance(instance.root);
        state.misses.delete(instance.root);
      } else {
        logSidecarEvent("daemon-skip", { root: instance.root, reason: "config-missing", misses });
      }
      skipped += 1;
      continue;
    }
    state.misses.delete(instance.root);
    if (state.cycleCount < (state.skipUntilCycle.get(instance.root) ?? 0)) {
      skipped += 1;
      continue;
    }
    if (await syncInstance(state, instance.root, "cycle")) {
      synced += 1;
    } else {
      failed += 1;
    }
  }
  logSidecarEvent("daemon-cycle", { synced, failed, skipped });
}
function pruneInstance(root) {
  writeInstances(readInstances().filter((instance) => instance.root !== root));
  logSidecarEvent("daemon-prune", { root, reason: "config-missing" });
}
async function syncInstance(state, root, trigger) {
  if (state.syncing.has(root))
    return false;
  state.syncing.add(root);
  let succeeded = false;
  try {
    const localCli = localSidecarCliPath(root);
    const cli = localCli ?? currentCliPath();
    logSidecarEvent("daemon-sync-start", { root, trigger, local: Boolean(localCli) });
    const result = await runChild(process.execPath, [cli, "sync"], {
      cwd: root,
      env: { ...process.env, [SKIP_LOCAL_EXEC_ENV]: "1", [GLOBAL_EXEC_ENV]: "1", [SOFT_SYNC_ENV]: "1" },
      timeoutMs: SYNC_TIMEOUT_MS
    });
    if (result.status === 0) {
      state.failures.delete(root);
      state.skipUntilCycle.delete(root);
      logSidecarEvent("daemon-sync", { root, trigger, local: Boolean(localCli) });
      succeeded = true;
    } else {
      const failures = (state.failures.get(root) ?? 0) + 1;
      state.failures.set(root, failures);
      state.skipUntilCycle.set(root, state.cycleCount + Math.min(2 ** (failures - 1), MAX_BACKOFF_CYCLES));
      logSidecarEvent("failure", {
        command: "daemon",
        root,
        trigger,
        message: result.timedOut ? "sync timed out" : result.output.trim().slice(-500) || `sync exited ${result.status}`
      });
    }
  } finally {
    state.syncing.delete(root);
    state.lastSyncEndAt.set(root, Date.now());
  }
  if (succeeded)
    await followUpTrailingSync(state, root);
  else
    state.trailingPending.delete(root);
  return succeeded;
}
async function followUpTrailingSync(state, root) {
  if (!state.trailingPending.delete(root))
    return;
  if (await checkoutIsDirty(root)) {
    syncInstance(state, root, "watch-followup");
  }
}
async function checkoutIsDirty(root) {
  const sidecarPath = readInstances().find((instance) => instance.root === root)?.sidecarPath;
  if (!sidecarPath || !fs.existsSync(sidecarPath))
    return false;
  const result = await runChild("git", ["-C", sidecarPath, "status", "--porcelain"], { timeoutMs: 30000 });
  return result.status === 0 && Boolean(result.stdout.trim());
}
function localSidecarCliPath(root) {
  if (!projectDependsOnSidecar(root))
    return;
  const candidate = path.join(root, "node_modules", "@projectors", "sidecar", "dist", "cli.js");
  if (!isFile(candidate))
    return;
  try {
    if (fs.realpathSync(candidate) === fs.realpathSync(currentCliPath()))
      return;
  } catch {}
  return candidate;
}
function currentCliPath() {
  return process.argv[1] || fileURLToPath(import.meta.url);
}
function selectWatchTargets(instances, limit = WATCH_LIMIT) {
  return [...instances].filter((instance) => fs.existsSync(instance.configPath) && fs.existsSync(instance.sidecarPath)).sort((left, right) => instanceRecency(right) - instanceRecency(left)).slice(0, limit);
}
function instanceRecency(instance) {
  const time = Date.parse(instance.lastSyncAt ?? instance.updatedAt ?? instance.registeredAt);
  return Number.isFinite(time) ? time : 0;
}
async function loadChokidar() {
  if (chokidarModule !== undefined)
    return chokidarModule;
  try {
    chokidarModule = await import("chokidar");
  } catch (error) {
    chokidarModule = null;
    logSidecarEvent("daemon-watch-unavailable", {
      message: error instanceof Error ? error.message : String(error)
    });
    console.log("file watching unavailable; relying on interval sync");
  }
  return chokidarModule;
}
async function refreshWatchers(state) {
  if (state.refreshing)
    return;
  state.refreshing = true;
  try {
    const chokidar = await loadChokidar();
    if (!chokidar)
      return;
    const targets = new Map(selectWatchTargets(readInstances()).map((instance) => [instance.root, instance.sidecarPath]));
    for (const [root, watcher] of [...state.watchers]) {
      if (targets.has(root))
        continue;
      state.watchers.delete(root);
      await watcher.close().catch(() => {
        return;
      });
    }
    for (const [root, sidecarPath] of targets) {
      if (state.watchers.has(root))
        continue;
      try {
        const watcher = chokidar.watch(sidecarPath, {
          ignored: watchIgnoreMatcher(sidecarPath),
          ignoreInitial: true,
          persistent: true
        });
        watcher.on("all", () => scheduleWatchSync(state, root));
        watcher.on("error", (error) => {
          logSidecarEvent("failure", {
            command: "daemon",
            root,
            message: `watcher error: ${error instanceof Error ? error.message : String(error)}`
          });
        });
        state.watchers.set(root, watcher);
      } catch (error) {
        logSidecarEvent("failure", {
          command: "daemon",
          root,
          message: `could not watch ${sidecarPath}: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }
    if (state.watchers.size !== state.lastWatchCount) {
      state.lastWatchCount = state.watchers.size;
      logSidecarEvent("daemon-watch", { watching: state.watchers.size });
    }
  } finally {
    state.refreshing = false;
  }
}
function scheduleWatchSync(state, root) {
  if (state.syncing.has(root)) {
    state.trailingPending.add(root);
    return;
  }
  if (Date.now() - (state.lastSyncEndAt.get(root) ?? 0) < SYNC_ECHO_GRACE_MS)
    return;
  if (state.pendingTimers.has(root)) {
    state.trailingPending.add(root);
    return;
  }
  logSidecarEvent("daemon-watch-debounce", { root, windowSeconds: state.options.debounceSeconds });
  const timer = setTimeout(() => {
    state.pendingTimers.delete(root);
    if (state.trailingPending.delete(root)) {
      if (state.syncing.has(root)) {
        state.trailingPending.add(root);
      } else {
        syncInstance(state, root, "watch-trailing");
      }
    }
  }, state.options.debounceSeconds * 1000);
  state.pendingTimers.set(root, timer);
  syncInstance(state, root, "watch");
}
async function watchRegistry(state) {
  const chokidar = await loadChokidar();
  if (!chokidar)
    return;
  try {
    const watcher = chokidar.watch(sidecarStateDir(), { ignoreInitial: true, depth: 0 });
    watcher.on("all", (...args) => {
      const filePath = typeof args[1] === "string" ? args[1] : "";
      if (path.basename(filePath) !== "instances.json")
        return;
      if (state.registryTimer)
        return;
      state.registryTimer = setTimeout(() => {
        state.registryTimer = undefined;
        refreshWatchers(state);
      }, 5000);
    });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not watch registry: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}
function compileGitignoreMatcher(lines) {
  const rules = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("!"))
      continue;
    let pattern = line.replace(/\/+$/, "");
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    pattern = pattern.replace(/^\/+/, "");
    const body = pattern.split("/").map((segment) => segment === "**" ? "\x00" : segment.split("*").map((piece) => piece.split("?").map(escapeRegex).join("[^/]")).join("[^/]*")).join("/").replaceAll("\x00/", "(?:.*/)?").replaceAll("/\x00", "(?:/.*)?").replaceAll("\x00", ".*");
    rules.push(new RegExp(`${anchored ? "^" : "(^|.*/)"}${body}(/.*)?$`));
  }
  return (relativePath) => {
    const normalized = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized)
      return false;
    return rules.some((rule) => rule.test(normalized));
  };
}
function watchIgnoreMatcher(sidecarPath) {
  let gitignore;
  try {
    const ignoreFile = path.join(sidecarPath, ".gitignore");
    if (fs.existsSync(ignoreFile)) {
      gitignore = compileGitignoreMatcher(fs.readFileSync(ignoreFile, "utf8").split(`
`));
    }
  } catch {}
  const root = path.resolve(sidecarPath);
  return (candidate) => {
    const relative = path.relative(root, candidate);
    if (!relative)
      return false;
    const normalized = relative.split(path.sep).join("/");
    if (normalized.startsWith(".."))
      return true;
    if (normalized === ".git" || normalized.startsWith(".git/"))
      return true;
    return gitignore ? gitignore(normalized) : false;
  };
}
async function checkAndInstallUpdate() {
  const current = packageVersion();
  const npm = findExecutableOnPath(process.platform === "win32" ? "npm.cmd" : "npm");
  if (!npm)
    return { status: "skipped", current, message: "npm not found on PATH" };
  const view = await runChild(npm, ["view", PACKAGE_NAME, "version"], { timeoutMs: 60000 });
  const latest = view.stdout.trim();
  if (view.status !== 0 || !/^\d+\.\d+\.\d+$/.test(latest)) {
    return {
      status: "failed",
      current,
      message: `version check failed: ${(latest || view.output.trim()).slice(-200)}`
    };
  }
  if (compareVersions(latest, current) <= 0) {
    return { status: "current", current, latest };
  }
  const source = readSettings().installSource;
  const usesBun = source ? source === "bun" : isInsidePath(realpathOr(currentCliPath()), realpathOr(bunGlobalRoot()));
  const bun = usesBun ? findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun") : undefined;
  const installer = bun ?? npm;
  const args = bun ? ["add", "-g", `${PACKAGE_NAME}@${latest}`] : ["install", "-g", `${PACKAGE_NAME}@${latest}`];
  const install = await runChild(installer, args, { timeoutMs: 300000 });
  if (install.status !== 0) {
    return {
      status: "failed",
      current,
      latest,
      message: `install of ${latest} failed: ${install.output.trim().slice(-500)}`
    };
  }
  return { status: "updated", current, latest };
}
async function maybeAutoUpdate() {
  if (process.env[SKIP_UPDATE_ENV] === "1")
    return;
  const settings = readSettings();
  if (!settings.autoUpdate)
    return;
  const last = settings.lastUpdateCheckAt ? Date.parse(settings.lastUpdateCheckAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_INTERVAL_MS)
    return;
  writeSettings({ ...settings, lastUpdateCheckAt: new Date().toISOString() });
  const result = await checkAndInstallUpdate();
  if (result.status === "updated") {
    logSidecarEvent("daemon-update", { from: result.current, to: result.latest });
    ensureDaemonServiceFile();
    restartAfterUpdate();
    return;
  }
  if (result.status === "current") {
    logSidecarEvent("daemon-update-check", { current: result.current, latest: result.latest });
    return;
  }
  logSidecarEvent("daemon-update-skip", { reason: result.status, message: result.message });
}
function restartAfterUpdate() {
  if (process.stdout.isTTY) {
    console.log("sidecar updated; restart this daemon to pick up the new version");
    return;
  }
  removeOwnPidFile();
  if (process.platform === "win32")
    startDetachedDaemon();
  process.exit(0);
}
async function acquireDaemonPid() {
  const pidPath = daemonPidPath();
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  while (true) {
    try {
      fs.writeFileSync(pidPath, `${process.pid}
`, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
    }
    const holder = readPid(pidPath);
    if (holder === process.pid)
      return;
    if (holder && pidIsSidecarDaemon(holder)) {
      logSidecarEvent("daemon-wait", { holder });
      await delay(30000);
      continue;
    }
    logSidecarEvent("daemon-pid-heal", { holder: holder ?? null });
    fs.rmSync(pidPath, { force: true });
  }
}
function installShutdownHandlers() {
  const shutdown = () => {
    removeOwnPidFile();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", removeOwnPidFile);
}
function removeOwnPidFile() {
  try {
    if (readPid(daemonPidPath()) === process.pid)
      fs.rmSync(daemonPidPath(), { force: true });
  } catch {}
}
function readPid(pidPath) {
  try {
    const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return;
  }
}
function runChild(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let output = "";
    let stdout = "";
    let timedOut = false;
    const append = (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-8192);
    };
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-8192);
      append(chunk);
    });
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: 1, output: output || String(error), stdout, timedOut });
    });
    child.on("close", (code2) => {
      clearTimeout(timer);
      resolve({ status: code2 ?? 1, output, stdout, timedOut });
    });
  });
}
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function realpathOr(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
function isInsidePath(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC", GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC", SKIP_UPDATE_ENV = "SIDECAR_SKIP_UPDATE", WATCH_LIMIT = 100, SYNC_TIMEOUT_MS, UPDATE_CHECK_INTERVAL_MS, PRUNE_AFTER_MISSES = 3, SYNC_ECHO_GRACE_MS = 5000, MAX_BACKOFF_CYCLES = 6, chokidarModule;
var init_daemon = __esm(() => {
  init_cli();
  SYNC_TIMEOUT_MS = 10 * 60 * 1000;
  UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
});

// src/cli.ts
import crypto from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { spawn as spawn2, spawnSync } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
async function main(argv = process.argv.slice(2)) {
  try {
    const status = await run(argv);
    const command = argv[0];
    if (command && command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (command !== "redact" && command !== "deinit" && shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (error instanceof SidecarError) {
      console.error(`${paint("bad", "sidecar:", colorLevel(process.stderr))} ${error.message}`);
      return 1;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.error("sidecar: stopped");
      return 130;
    }
    throw error;
  }
}
function run(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    printUsage("stderr");
    return 1;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    printUsage("stdout");
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(packageVersion());
    return 0;
  }
  switch (command) {
    case "init":
      return cmdInit(rest);
    case "clone":
      return cmdClone(rest);
    case "deinit":
      return cmdDeinit(rest);
    case "status":
      return cmdStatus(rest);
    case "instances":
      return cmdInstances(rest);
    case "tail":
      return cmdTail(rest);
    case "daemon":
      return cmdDaemon(rest);
    case "register-install":
      return cmdRegisterInstall(rest);
    case "set-install-source":
      return cmdSetInstallSource(rest);
    case "update":
      return cmdUpdate(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "sync":
      return cmdSync(rest);
    case "merge":
      return cmdMerge(rest);
    case "redact":
      return cmdRedact(rest);
    case "redactions":
      return cmdRedactions(rest);
    default: {
      const suggestion = closestCommand(command);
      throw new SidecarError(`unknown command ${JSON.stringify(command)}${suggestion ? `; did you mean ${JSON.stringify(suggestion)}?` : ""}`);
    }
  }
}
function closestCommand(input) {
  let best;
  for (const command of KNOWN_COMMANDS) {
    const distance = editDistance(input.toLowerCase(), command);
    if (!best || distance < best.distance)
      best = { command, distance };
  }
  return best && best.distance <= 2 ? best.command : undefined;
}
function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1;i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1;j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
function printUsage(target) {
  const write = target === "stdout" ? console.log : console.error;
  const level = colorLevel(target === "stdout" ? process.stdout : process.stderr);
  const header = (text) => paint("label", text, level);
  write(`usage: sidecar <command> [options]

${header("common:")}
  init [remote] [--path sidecar|.] [--branch main] [--inbox template] [--redaction none|secrets|secrets+pii]
                           --path . makes this repo itself the sidecar (standalone)
  status [--json]
  redactions               preview what redaction rewrites before content is pushed

${header("sync & daemon:")}
  sync [--no-snapshot] [--soft] [-m message]
  daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]
  instances [--json]
  tail [-f|--follow] [-n|--lines count]
  update

${header("advanced (mostly run for you by init, git, and the daemon):")}
  clone [--if-missing]
  deinit
  snapshot [--push] [-m message]
  merge [--fork-files] [--no-push]
  redact                   git clean filter: stdin -> redacted stdout
  register-install
  set-install-source npm|bun|curl [--if-unset]`);
}
function cmdDeinit(args) {
  if (args.length)
    throw new SidecarError("usage: sidecar deinit");
  const root = gitToplevelOptional(process.cwd());
  if (!root) {
    console.error("sidecar: warning: not inside a Git repository; nothing to remove");
    return 0;
  }
  const configPath = path2.join(root, ".sidecar");
  const leftovers = [];
  let config;
  if (fs2.existsSync(configPath)) {
    try {
      config = readConfig(configPath);
    } catch {
      leftovers.push(`could not read ${configPath}, so its checkout and ignore entries were left in place`);
    }
  } else {
    leftovers.push("no .sidecar config found; a leftover checkout or ignore entries may remain");
  }
  if (config && isStandalone(config)) {
    const leftover = releaseStandaloneCheckout(root, config);
    if (leftover)
      leftovers.push(leftover);
  } else if (!config) {
    removeRedactionFilter(root);
  }
  fs2.rmSync(configPath, { force: true });
  if (config && !isStandalone(config)) {
    const checkoutPath = path2.resolve(root, config.path);
    if (checkoutPath !== path2.resolve(root) && checkoutPath !== path2.parse(checkoutPath).root) {
      fs2.rmSync(checkoutPath, { recursive: true, force: true });
    }
    const ignoreEntry = ignoreEntryForSidecarPath(root, config.path);
    if (ignoreEntry) {
      removeIgnoreEntry(path2.join(root, ".gitignore"), ignoreEntry);
      removeIgnoreEntry(path2.join(gitCommonDir(root), "info", "exclude"), ignoreEntry);
      removeZedInclusion(root, ignoreEntry);
    }
  }
  removeLegacyGitHooks(root);
  unregisterInstance(root);
  console.log(`removed sidecar from ${paint("repo", root)}`);
  if (leftovers.length) {
    for (const leftover of leftovers) {
      console.error(`sidecar: warning: ${leftover}`);
    }
    console.error("sidecar: deinit could not fully complete; to finish removal, ask your agent to scrub any remaining traces of sidecar");
  }
  return 0;
}
function releaseStandaloneCheckout(root, config) {
  removeRedactionFilter(root);
  const current = git(root, ["branch", "--show-current"], { check: false }).stdout.trim();
  if (current === config.branch)
    return;
  if (config.redaction !== "none") {
    return `the repo is still on ${current || "a detached HEAD"}: switching to ${config.branch} would replace local files with their redacted pushed contents`;
  }
  if (git(root, ["switch", config.branch], { check: false }).status === 0) {
    console.log(`switched back to ${config.branch}`);
    return;
  }
  return `could not switch to ${config.branch}; the repo is still on ${current || "a detached HEAD"}`;
}
function cmdInit(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main"]),
    value: new Set(["--path", "--branch", "--inbox", "--redaction"])
  });
  if (parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init [remote] [--path sidecar] [--branch main] [--inbox template] [--redaction mode]");
  }
  const remote = parsed.positional[0];
  let existingRoot = remote ? undefined : findConfigRootOptional(process.cwd());
  const root = existingRoot ?? gitToplevel(process.cwd());
  const configPath = path2.join(root, ".sidecar");
  if (remote && fs2.existsSync(configPath)) {
    const existing = readConfig(configPath);
    const unchanged = existing.remote === remote && existing.path === getValue(parsed, "--path", existing.path) && existing.branch === getValue(parsed, "--branch", existing.branch) && existing.inbox === getValue(parsed, "--inbox", existing.inbox) && existing.redaction === getValue(parsed, "--redaction", existing.redaction);
    if (unchanged || !promptOverwriteConfig(configPath, existing.remote, remote)) {
      existingRoot = root;
    }
  }
  const config = existingRoot ? readConfig(configPath) : buildInitConfig(root, remote, parsed);
  if (!existingRoot) {
    validateRemote(config.remote);
    validateBranch(config.branch);
    validateInboxTemplate(config.inbox);
    writeConfig(configPath, config);
  }
  console.log(`${existingRoot ? "using" : "wrote"} ${paint("brand", configPath)}`);
  if (isStandalone(config)) {
    console.log(`standalone: ${paint("repo", root)} is the sidecar`);
  } else {
    printCheckoutVisibility(root, config);
  }
  if (removeLegacyGitHooks(root)) {
    console.log("removed legacy sidecar git hooks; syncing is manual or via the global daemon");
  }
  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  registerCurrentInstance(root, config, { event: "init" });
  const globalSidecar = ensureGlobalSidecar();
  if (globalSidecar) {
    registerInstallWithGlobalSidecar(globalSidecar, root);
    ensureDaemonSetup(globalSidecar);
  }
  return 0;
}
function buildInitConfig(root, remote, parsed) {
  const rawPath = parsed.values.has("--path") ? getValue(parsed, "--path", DEFAULT_PATH) : promptSidecarPath(root);
  const sidecarPath = pathIsRepoRoot(root, rawPath) ? "." : rawPath;
  const standalone = isStandalonePath(sidecarPath);
  return {
    remote: remote ?? (standalone ? standaloneRemote(root) : promptRemote(root)),
    version: 1,
    path: sidecarPath,
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX),
    redaction: parsed.values.has("--redaction") ? redactionModeConfigValue(getValue(parsed, "--redaction", DEFAULT_REDACTION_MODE), "--redaction") : promptRedactionMode(standalone ? "none" : DEFAULT_REDACTION_MODE)
  };
}
function printCheckoutVisibility(root, config) {
  const ignoreEntry = ensureSidecarIgnored(root, config.path);
  if (!ignoreEntry) {
    console.log(`sidecar path outside repo; not updating .gitignore`);
    return;
  }
  const name = ignoreEntry.replace(/\/+$/, "");
  console.log(`ignored ${name}/ via .gitignore`);
  if (hasZedInclusion(root, ignoreEntry)) {
    console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
  } else if (promptYesNo(`include ${name}/ in Zed file search via .zed/settings.json?`)) {
    if (ensureZedInclusion(root, ignoreEntry)) {
      console.log(`included ${name}/ in Zed file search via .zed/settings.json`);
    } else {
      console.log(`could not parse .zed/settings.json; add "${name}/**" to file_scan_inclusions manually`);
    }
  }
}
function ensureDaemonSetup(globalSidecar) {
  if (process.env[SKIP_SERVICE_ENV] === "1")
    return;
  if (!readSettings().daemonEnabled)
    return;
  const service = daemonServiceStatus();
  if (!service.available || service.installed && service.running)
    return;
  const result = spawnSync(globalSidecar, ["daemon", "enable"], {
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV2]: "1",
      [GLOBAL_EXEC_ENV2]: "1"
    }
  });
  if (result.status !== 0) {
    console.log(`could not enable the sync daemon: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}; run \`sidecar daemon enable\` manually`);
    return;
  }
  console.log("enabled the sidecar daemon for background sync");
}
function ensureGlobalSidecar() {
  const installHint = `install with \`npm install -g ${PACKAGE_SPEC}\``;
  const globalSidecar = findGlobalSidecarExecutable();
  if (!globalSidecar) {
    if (!process.stdin.isTTY) {
      console.log(`no global sidecar found; ${installHint} to enable daemon auto sync`);
      return;
    }
    if (promptYesNo("no global sidecar found; install it now for daemon auto sync?")) {
      installGlobalSidecar();
      return findGlobalSidecarExecutable();
    }
    return;
  }
  const globalVersion = globalSidecarVersion(globalSidecar);
  const currentVersion = packageVersion();
  if (globalVersion && compareVersions(globalVersion, currentVersion) >= 0)
    return globalSidecar;
  const state = globalVersion ? `v${globalVersion}` : "an unknown version";
  if (!process.stdin.isTTY) {
    console.log(`global sidecar is ${state} (current v${currentVersion}); ${installHint.replace("install with", "update with")}`);
    return globalSidecar;
  }
  if (promptYesNo(`global sidecar is ${state} (current v${currentVersion}); update it now?`)) {
    installGlobalSidecar();
    return findGlobalSidecarExecutable() ?? globalSidecar;
  }
  return globalSidecar;
}
function registerInstallWithGlobalSidecar(executable, root) {
  const result = spawnSync(executable, ["register-install"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      [SKIP_LOCAL_EXEC_ENV2]: "1",
      [GLOBAL_EXEC_ENV2]: "1"
    }
  });
  if (result.status !== 0) {
    throw new SidecarError(`global sidecar registration failed: ${result.stderr.trim() || result.stdout.trim() || "unknown error"}`);
  }
}
function findGlobalSidecarExecutable() {
  const names = process.platform === "win32" ? ["sidecar.cmd", "sidecar.ps1", "sidecar"] : ["sidecar"];
  for (const entry of (process.env.PATH || "").split(path2.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path2.join(entry, name);
      if (!isFilePath(candidate))
        continue;
      if (isProjectLocalPath(realpathOr2(candidate)))
        continue;
      return candidate;
    }
  }
  return;
}
function globalSidecarVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV2]: "1" }
  });
  if (result.status !== 0)
    return;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+$/.test(version) ? version : undefined;
}
function installGlobalSidecar() {
  const bun = findExecutableOnPath(process.platform === "win32" ? "bun.exe" : "bun");
  const command = bun ? [bun, "add", "-g", PACKAGE_SPEC] : ["npm", "install", "-g", PACKAGE_SPEC];
  console.log(`running ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.status !== 0) {
    throw new SidecarError(`global sidecar install failed; run \`${command.join(" ")}\` manually`);
  }
  writeSettings({ ...readSettings(), installSource: bun ? "bun" : "npm" });
}
function findExecutableOnPath(name) {
  for (const entry of (process.env.PATH || "").split(path2.delimiter).filter(Boolean)) {
    const candidate = path2.join(entry, name);
    if (isFilePath(candidate))
      return candidate;
  }
  return;
}
function isFilePath(filePath) {
  try {
    return fs2.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function compareVersions(a, b) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0;index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff)
      return diff < 0 ? -1 : 1;
  }
  return 0;
}
function cmdClone(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main", "--if-missing"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar clone [--if-missing] [--no-bootstrap-main]");
  const [root, config] = loadProject();
  removeLegacyGitHooks(root);
  if (parsed.flags.has("--if-missing")) {
    const sidecarPath = resolveSidecarPath(root, config);
    if (fs2.existsSync(sidecarPath) && hasGitMetadata(sidecarPath))
      return 0;
  }
  cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  registerCurrentInstance(root, config, { event: "clone" });
  return 0;
}
function labelLine(width, label, value, role, indent = "") {
  const padded = `${label}:`.padEnd(width);
  console.log(`${indent}${paint("label", padded)} ${role ? paint(role, value) : value}`);
}
function statusLine(label, value, role) {
  labelLine(STATUS_LABEL_WIDTH, label, value, role);
}
function formatTimestampPair(iso) {
  const relative = formatRelativeTime(iso);
  const absolute = formatLocalTimestamp(iso);
  if (!relative || !absolute)
    return iso;
  return `${relative} ${paint("quiet", `(${absolute})`)}`;
}
function cmdStatus(args) {
  const parsed = parseOptions(args, { boolean: new Set(["--json"]), value: new Set });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar status [--json]");
  if (parsed.flags.has("--json"))
    return cmdStatusJson();
  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  if (isStandalone(config)) {
    statusLine("standalone", root, "repo");
  } else {
    statusLine("main repo", root, "repo");
    statusLine("sidecar path", sidecarPath, "brand");
  }
  statusLine("remote", config.remote, "brand");
  statusLine("main branch", config.branch);
  statusLine("inbox branch", inbox);
  if (!checkoutPresent) {
    statusLine("checkout", "missing", "bad");
    printDaemonLine();
    printLastSyncLine(root);
    return 0;
  }
  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  statusLine("checkout", "present");
  if (!branch)
    statusLine("branch", "(detached)", "attn");
  else if (branch === inbox)
    statusLine("branch", branch);
  else
    statusLine("branch", `${branch} — not the inbox branch; sync will switch back`, "attn");
  statusLine("dirty", dirty ? "yes" : "no", dirty ? "attn" : "quiet");
  printDaemonLine();
  printLastSyncLine(root);
  const pending = pendingStatusInboxBranches(sidecarPath, config);
  if (pending.length) {
    statusLine("pending inbox", String(pending.length), "attn");
    for (const branchName of pending)
      console.log(`  ${paint("brand", branchName)}`);
  } else {
    statusLine("pending inbox", "none", "quiet");
  }
  return 0;
}
function cmdStatusJson() {
  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  const branch = checkoutPresent ? git(sidecarPath, ["branch", "--show-current"]).stdout.trim() : undefined;
  const payload = {
    root,
    sidecarPath,
    standalone: isStandalone(config),
    remote: config.remote,
    branch: config.branch,
    inbox,
    checkout: checkoutPresent ? "present" : "missing",
    currentBranch: branch || undefined,
    dirty: checkoutPresent ? Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim()) : undefined,
    daemon: daemonHealth().text,
    lastSyncAt: readInstances().find((instance) => instance.root === root)?.lastSyncAt,
    pendingInbox: checkoutPresent ? pendingStatusInboxBranches(sidecarPath, config) : undefined
  };
  console.log(JSON.stringify(payload, null, 2));
  return 0;
}
function pendingStatusInboxBranches(sidecarPath, config) {
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch) ? `origin/${config.branch}` : branchExists(sidecarPath, config.branch) ? config.branch : "HEAD";
  return pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base));
}
function daemonHealth() {
  if (!shouldUseGlobalRegistry())
    return { text: "no global install", role: "quiet" };
  const service = daemonServiceStatus();
  if (!service.available)
    return { text: service.message ?? "unavailable", role: "quiet" };
  if (service.running)
    return { text: "running", role: "ok" };
  if (!readSettings().daemonEnabled)
    return { text: "disabled", role: "attn" };
  if (!service.installed)
    return { text: "not installed — run `sidecar daemon enable`", role: "bad" };
  return { text: "stopped", role: "bad" };
}
function printDaemonLine() {
  const health = daemonHealth();
  statusLine("daemon", health.text, health.role);
}
function printLastSyncLine(root) {
  const lastSyncAt = readInstances().find((instance) => instance.root === root)?.lastSyncAt;
  if (!lastSyncAt) {
    statusLine("last sync", "never", "quiet");
    return;
  }
  statusLine("last sync", formatTimestampPair(lastSyncAt));
}
function formatRelativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then))
    return;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45)
    return "just now";
  const scales = [
    [60, "minute", 60],
    [3600, "hour", 24],
    [86400, "day", 14],
    [604800, "week", 9],
    [2592000, "month", 18],
    [31536000, "year", Number.POSITIVE_INFINITY]
  ];
  for (const [size, unit, limit] of scales) {
    const count = Math.max(1, Math.floor(seconds / size));
    if (count < limit)
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "a very long time ago";
}
function formatLocalTimestamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()))
    return;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function cmdInstances(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--json"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar instances [--json]");
  const statuses = listInstanceStatuses();
  if (parsed.flags.has("--json")) {
    console.log(`${JSON.stringify(statuses, null, 2)}`);
    return 0;
  }
  console.log(`${paint("label", "registry:")} ${paint("quiet", instancesPath())}`);
  console.log(`${paint("label", "log:     ")} ${paint("quiet", sidecarLogPath())}`);
  if (!statuses.length) {
    console.log("instances: none");
    return 0;
  }
  const width = "checkout:".length;
  const line = (label, value, role) => labelLine(width, label, value, role, "  ");
  for (const status of statuses) {
    console.log("");
    console.log(paint("repo", status.root));
    line("sidecar", status.sidecarPath, "brand");
    line("remote", status.remote, "brand");
    line("branch", status.currentBranch || "(unknown)");
    line("config", status.config, status.config === "ok" ? undefined : "bad");
    line("checkout", status.checkout, status.checkout === "present" ? undefined : "bad");
    line("dirty", status.dirty, status.dirty === "yes" ? "attn" : "quiet");
    line("updated", formatTimestampPair(status.updatedAt));
    if (status.lastSyncAt)
      line("synced", formatTimestampPair(status.lastSyncAt));
  }
  return 0;
}
function cmdTail(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set(["-n", "--lines"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar tail [-f|--follow] [-n|--lines count]");
  const rawLines = getValue(parsed, "--lines", getValue(parsed, "-n", "50"));
  const lines = Number.parseInt(rawLines, 10);
  if (!Number.isFinite(lines) || lines < 1 || String(lines) !== rawLines) {
    throw new SidecarError("--lines requires a positive integer");
  }
  const filePath = sidecarLogPath();
  if (!fs2.existsSync(filePath)) {
    if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
      followLog(filePath, 0);
      return 0;
    }
    return 0;
  }
  const stat = fs2.statSync(filePath);
  if (stat.size > 0) {
    process.stdout.write(lastLines(fs2.readFileSync(filePath, "utf8"), lines));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}
function lastLines(content, count) {
  const trimmed = content.endsWith(`
`) ? content.slice(0, -1) : content;
  if (!trimmed)
    return "";
  return `${trimmed.split(`
`).slice(-count).join(`
`)}
`;
}
function cmdDaemon(args) {
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("daemon commands must run from a globally installed sidecar, not a project-local dependency");
  }
  const [action, ...rest] = args;
  if (action === "status") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon status");
    return cmdDaemonStatus();
  }
  if (action === "enable") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon enable");
    return cmdDaemonEnable();
  }
  if (action === "disable") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon disable");
    return cmdDaemonDisable();
  }
  if (action === "restart") {
    if (rest.length)
      throw new SidecarError("usage: sidecar daemon restart");
    return cmdDaemonRestart();
  }
  if (action === "autoupdate") {
    return cmdDaemonAutoUpdate(rest);
  }
  if (action === "run") {
    return cmdDaemonRun(rest);
  }
  if (!action || action.startsWith("-")) {
    return cmdDaemonRun(args);
  }
  throw new SidecarError("usage: sidecar daemon status|enable|disable|restart|autoupdate on|off|run [--once] [--interval seconds]");
}
function cmdDaemonAutoUpdate(args) {
  const [value, ...rest] = args;
  if (rest.length || value !== "on" && value !== "off") {
    throw new SidecarError("usage: sidecar daemon autoupdate on|off");
  }
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), autoUpdate: value === "on" });
  console.log(`autoupdate: ${value}`);
  return 0;
}
function daemonLine(label, value, role) {
  labelLine(DAEMON_LABEL_WIDTH, label, value, role);
}
function printDaemonBlock(service, enabled) {
  daemonLine("daemon", enabled ? "enabled" : "disabled", enabled ? "ok" : "attn");
  printServiceLines(service, enabled);
  daemonLine("settings", settingsPath(), "quiet");
}
function printServiceLines(service, enabled) {
  const role = service.running ? "ok" : !service.available ? "quiet" : enabled && service.installed ? "bad" : "quiet";
  daemonLine("service", daemonServiceLabel(service), role);
  if (service.path)
    daemonLine("agent", service.path, "quiet");
  if (service.message)
    daemonLine("detail", service.message);
}
function cmdDaemonStatus() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  const settings = readSettings();
  const service = daemonServiceStatus();
  daemonLine("daemon", settings.daemonEnabled ? "enabled" : "disabled", settings.daemonEnabled ? "ok" : "attn");
  daemonLine("update", settings.autoUpdate ? "auto" : "manual");
  printServiceLines(service, settings.daemonEnabled);
  daemonLine("settings", settingsPath(), "quiet");
  daemonLine("log", sidecarLogPath(), "quiet");
  return 0;
}
function cmdDaemonEnable() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  printDaemonBlock(service, true);
  return 0;
}
function cmdDaemonDisable() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  printDaemonBlock(service, false);
  return 0;
}
function cmdDaemonRestart() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  printDaemonBlock(service, true);
  return 0;
}
async function cmdDaemonRun(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval", "--debounce"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  const intervalSeconds = Number(getValue(parsed, "--interval", "600"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }
  const debounceSeconds = Number(getValue(parsed, "--debounce", "60"));
  if (!Number.isFinite(debounceSeconds) || debounceSeconds < 0) {
    throw new SidecarError("--debounce must be >= 0");
  }
  const { runDaemonLoop: runDaemonLoop2 } = await Promise.resolve().then(() => (init_daemon(), exports_daemon));
  return runDaemonLoop2({
    once: parsed.flags.has("--once"),
    intervalSeconds,
    debounceSeconds
  });
}
async function cmdUpdate(args) {
  if (args.length)
    throw new SidecarError("usage: sidecar update");
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("update must run from a globally installed sidecar; update local installs with your package manager");
  }
  console.log(`checking npm for ${PACKAGE_NAME} updates...`);
  const { checkAndInstallUpdate: checkAndInstallUpdate2 } = await Promise.resolve().then(() => (init_daemon(), exports_daemon));
  const result = await checkAndInstallUpdate2();
  logSidecarEvent("manual-update", { ...result });
  if (result.status === "current") {
    console.log(`sidecar v${result.current} is up to date`);
    return 0;
  }
  if (result.status !== "updated") {
    throw new SidecarError(result.message ?? `update ${result.status}`);
  }
  console.log(`updated sidecar v${result.current} -> v${result.latest}`);
  const service = installDaemonService();
  printServiceLines(service, readSettings().daemonEnabled);
  return 0;
}
function cmdSetInstallSource(args) {
  const parsed = parseOptions(args, { boolean: new Set(["--if-unset"]), value: new Set });
  const [source, ...extra] = parsed.positional;
  if (!source || extra.length || !INSTALL_SOURCES.has(source)) {
    throw new SidecarError("usage: sidecar set-install-source npm|bun|curl [--if-unset]");
  }
  if (isProjectLocalPath(currentExecutablePath())) {
    throw new SidecarError("set-install-source must run from a globally installed sidecar");
  }
  const settings = readSettings();
  if (parsed.flags.has("--if-unset") && settings.installSource) {
    console.log(`install source: ${settings.installSource} (kept)`);
    return 0;
  }
  writeSettings({ ...settings, installSource: source });
  console.log(`install source: ${source}`);
  return 0;
}
function cmdRegisterInstall(args) {
  if (args.length)
    throw new SidecarError("usage: sidecar register-install");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("install registration requires a global sidecar executable");
  }
  const [root, config] = loadProject();
  registerCurrentInstance(root, config, { event: "install-register" });
  return 0;
}
function cmdSnapshot(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--push"]),
    value: new Set(["-m", "--message"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar snapshot [--push] [-m message]");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  withSyncLock(root, "throw", () => {
    const inbox = expandInbox(config, sidecarPath);
    ensureCommitIdentity(sidecarPath);
    ensureInboxBranch(sidecarPath, config, inbox);
    const committed = snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined, config.redaction);
    if (committed && parsed.flags.has("--push")) {
      syncBranchBeforePush(sidecarPath, inbox);
      pushBranch(sidecarPath, inbox);
    }
  });
  return 0;
}
function cmdSync(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot", "--soft"]),
    value: new Set(["-m", "--message"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar sync [--no-snapshot] [--soft] [-m message]");
  const [root, config] = loadProject();
  removeLegacyGitHooks(root);
  const soft = parsed.flags.has("--soft") || process.env[SOFT_SYNC_ENV] === "1";
  const synced = withSyncLock(root, soft ? "skip" : "throw", () => {
    syncProject(root, config, {
      snapshot: !parsed.flags.has("--no-snapshot"),
      message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined
    });
  });
  if (synced)
    registerCurrentInstance(root, config, { event: "sync", lastSyncAt: nowIso() });
  return 0;
}
function syncProject(root, config, options) {
  const sidecarPath = ensureSidecarCheckout(root, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, true, false);
  ensureInboxBranch(sidecarPath, config, inbox);
  if (options.snapshot) {
    snapshot(sidecarPath, root, inbox, options.message, config.redaction);
  } else {
    ensureRedactionFilter(sidecarPath, config.redaction);
  }
  syncBranchBeforePush(sidecarPath, inbox);
  pushBranch(sidecarPath, inbox);
  mergeInboxBranches(sidecarPath, config, { forkFiles: true, push: true });
  refreshInboxFromMain(sidecarPath, config, inbox);
}
function cmdMerge(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--fork-files", "--llm", "--delete-merged-inbox", "--no-push"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar merge [--fork-files] [--no-push]");
  if (parsed.flags.has("--llm")) {
    throw new SidecarError("--llm is reserved for a configured resolver; use --fork-files for now");
  }
  if (parsed.flags.has("--delete-merged-inbox")) {
    throw new SidecarError("--delete-merged-inbox is no longer supported; merged inbox branches are kept and skipped by ancestry");
  }
  if (!parsed.flags.has("--fork-files")) {
    console.log("sidecar: conflicts will stop the merge; pass --fork-files to preserve all versions");
  }
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  ensureRedactionFilter(sidecarPath, config.redaction);
  mergeInboxBranches(sidecarPath, config, {
    forkFiles: parsed.flags.has("--fork-files"),
    push: !parsed.flags.has("--no-push")
  });
  return 0;
}
function mergeInboxBranches(sidecarPath, config, options) {
  ensureClean(sidecarPath);
  ensureCommitIdentity(sidecarPath);
  fetch(sidecarPath, false);
  if (mainMatchesRemote(sidecarPath, config) && !hasPendingInboxWork(sidecarPath, config)) {
    console.log("no inbox branches to merge");
    return 0;
  }
  if (!hasAnyCommit(sidecarPath)) {
    return mergeInboxBranchesAt(sidecarPath, config, options);
  }
  if (git(sidecarPath, ["branch", "--show-current"]).stdout.trim() === config.branch) {
    ensureInboxBranch(sidecarPath, config, expandInbox(config, sidecarPath));
  }
  const scratch = path2.join(os.tmpdir(), `sidecar-merge-${crypto.createHash("sha1").update(sidecarPath).digest("hex").slice(0, 12)}`);
  const worktree = path2.join(scratch, "checkout");
  git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
  fs2.rmSync(scratch, { recursive: true, force: true });
  git(sidecarPath, ["worktree", "prune", "--expire", "now"], { check: false });
  try {
    git(sidecarPath, ["worktree", "add", "--detach", worktree]);
    return mergeInboxBranchesAt(worktree, config, options);
  } finally {
    git(sidecarPath, ["worktree", "remove", "--force", worktree], { check: false });
    fs2.rmSync(scratch, { recursive: true, force: true });
  }
}
function mainMatchesRemote(repo, config) {
  if (!branchExists(repo, config.branch) || !remoteRefExists(repo, config.branch))
    return false;
  const local = git(repo, ["rev-parse", `refs/heads/${config.branch}`]).stdout.trim();
  const remote = git(repo, ["rev-parse", `refs/remotes/origin/${config.branch}`]).stdout.trim();
  return local === remote;
}
function hasPendingInboxWork(repo, config) {
  const remoteMain = `origin/${config.branch}`;
  return pendingInboxBranches(repo, config).some((branch) => !isAncestor(repo, branch, remoteMain));
}
function mergeInboxBranchesAt(sidecarPath, config, options) {
  const maxAttempts = 3;
  for (let attempt = 1;; attempt += 1) {
    if (attempt > 1)
      fetch(sidecarPath, false);
    ensureMainBranch(sidecarPath, config);
    const inboxBranches = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"));
    if (!inboxBranches.length && attempt === 1) {
      console.log("no inbox branches to merge");
      return 0;
    }
    const merged = [];
    for (const remoteBranch of inboxBranches) {
      console.log(`merging ${paint("brand", remoteBranch)}`);
      const result = git(sidecarPath, ["merge", "--no-ff", "-m", `Merge ${remoteBranch}`, remoteBranch], { check: false });
      if (result.status === 0) {
        merged.push(remoteBranch);
        continue;
      }
      if (!hasUnmergedPaths(sidecarPath)) {
        throw new SidecarError(result.stderr.trim() || `merge failed for ${remoteBranch}`);
      }
      if (!options.forkFiles) {
        git(sidecarPath, ["merge", "--abort"], { check: false });
        throw new SidecarError(`merge conflict in ${remoteBranch}; rerun with --fork-files`);
      }
      forkConflicts(sidecarPath, remoteBranch);
      git(sidecarPath, ["commit", "-m", `Merge ${remoteBranch} with forked conflict files`]);
      merged.push(remoteBranch);
    }
    if (options.push) {
      const push = git(sidecarPath, ["push", "-u", "origin", `HEAD:refs/heads/${config.branch}`], { check: false });
      if (push.status !== 0) {
        if (attempt >= maxAttempts) {
          throw new SidecarError(push.stderr.trim() || `could not push ${config.branch}`);
        }
        console.log(`push of ${config.branch} was rejected; refetching and retrying`);
        continue;
      }
      console.log(`pushed ${config.branch}`);
    }
    console.log(`merged ${merged.length} inbox branch(es)`);
    return merged.length;
  }
}
function cmdRedactions(args) {
  const parsed = parseOptions(args, { boolean: new Set, value: new Set });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar redactions");
  const [root, config] = loadProject();
  const sidecarPath = requireSidecarCheckout(root, config);
  if (config.redaction === "none") {
    console.log('redaction is disabled (redaction = "none" in .sidecar)');
    return 0;
  }
  const files = [
    ...new Set(git(sidecarPath, ["-c", "core.quotePath=false", "ls-files", "--cached", "--others", "--exclude-standard"]).stdout.split(`
`).filter(Boolean))
  ];
  let shown = 0;
  let items = 0;
  for (const relPath of files) {
    const delta = fileRedactionDelta(path2.join(sidecarPath, relPath), config.redaction);
    if (!delta)
      continue;
    if (shown)
      console.log("");
    console.log(`${relPath}:`);
    printRedactionDiff(delta.text, delta.redacted);
    shown += 1;
    items += delta.items;
  }
  if (!shown) {
    console.log(`no redactions pending (mode: ${config.redaction})`);
    return 0;
  }
  console.log(`
${items} redaction(s) in ${shown} file(s) will be pushed this way (mode: ${config.redaction}).`);
  console.log(`local files are untouched; add "${NO_REDACT_PRAGMA}" to a file's first lines to push it verbatim`);
  return 0;
}
function printRedactionDiff(original, redacted) {
  const scratch = fs2.mkdtempSync(path2.join(os.tmpdir(), "sidecar-redactions-"));
  try {
    const localPath = path2.join(scratch, "local");
    const pushedPath = path2.join(scratch, "pushed");
    fs2.writeFileSync(localPath, original, "utf8");
    fs2.writeFileSync(pushedPath, redacted, "utf8");
    const color = colorLevel() > 0 ? ["--color"] : [];
    const diff = gitRaw(["diff", "--no-index", ...color, "--", localPath, pushedPath], { check: false });
    const lines = diff.stdout.split(`
`);
    const firstHunk = lines.findIndex((line) => stripColor(line).startsWith("@@"));
    const body = firstHunk === -1 ? "" : lines.slice(firstHunk).join(`
`).trimEnd();
    if (body)
      console.log(body);
  } finally {
    fs2.rmSync(scratch, { recursive: true, force: true });
  }
}
function cmdRedact(args) {
  const parsed = parseOptions(args, { boolean: new Set, value: new Set(["--mode"]) });
  const mode = redactionModeConfigValue(getValue(parsed, "--mode", DEFAULT_REDACTION_MODE), "--mode");
  const output = redactBuffer(fs2.readFileSync(0), mode);
  let offset = 0;
  while (offset < output.length) {
    offset += fs2.writeSync(1, output, offset, output.length - offset);
  }
  return 0;
}
function cloneOrUpdate(root, config, bootstrapMain) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (fs2.existsSync(sidecarPath) && !hasGitMetadata(sidecarPath)) {
    if (fs2.readdirSync(sidecarPath).length) {
      throw new SidecarError(`${sidecarPath} exists and is not an empty Git repo`);
    }
    fs2.rmdirSync(sidecarPath);
  }
  if (!fs2.existsSync(sidecarPath)) {
    gitRaw(["clone", "--", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      if (!isStandalone(config)) {
        throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
      }
      console.log(`using origin ${paint("brand", existing.stdout.trim())} ${paint("quiet", `(.sidecar says ${config.remote})`)}`);
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }
  ensureCommitIdentity(sidecarPath);
  ensureRedactionFilter(sidecarPath, config.redaction);
  if (bootstrapMain)
    bootstrapMainBranch(sidecarPath, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${paint("brand", sidecarPath)}`);
}
function bootstrapMainBranch(repo, config) {
  if (remoteRefExists(repo, config.branch))
    return;
  if (hasAnyCommit(repo)) {
    const current = git(repo, ["branch", "--show-current"]).stdout.trim();
    if (current !== config.branch) {
      if (branchExists(repo, config.branch)) {
        git(repo, ["switch", config.branch]);
      } else {
        git(repo, ["switch", "-c", config.branch]);
      }
    }
    pushBranch(repo, config.branch);
    return;
  }
  git(repo, ["switch", "--orphan", config.branch]);
  if (isStandalone(config)) {
    git(repo, ["commit", "--allow-empty", "-m", "Initialize sidecar"]);
    pushBranch(repo, config.branch);
    return;
  }
  fs2.writeFileSync(path2.join(repo, "README.md"), `# Sidecar

Scratch space for a code repository: plans, notes, and agent context.
This is a plain git repo you own — read it, edit it, clone it anywhere.
Kept in sync by [sidecar](https://github.com/anteprojector/sidecar).
`, "utf8");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "Initialize sidecar"]);
  pushBranch(repo, config.branch);
}
function ensureMainBranch(repo, config) {
  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", config.branch]);
  } else if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", config.branch, "--track", `origin/${config.branch}`]);
  } else if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", config.branch]);
  } else {
    bootstrapMainBranch(repo, config);
    return;
  }
  if (!remoteRefExists(repo, config.branch))
    return;
  const remoteBranch = `origin/${config.branch}`;
  if (isAncestor(repo, remoteBranch, "HEAD"))
    return;
  if (isAncestor(repo, "HEAD", remoteBranch)) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }
  const tip = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const discarded = `refs/sidecar-discarded/${config.branch}/${utcTimestamp()}-${tip}`;
  git(repo, ["update-ref", discarded, "HEAD"], { check: false });
  console.log(`${config.branch} diverged from ${remoteBranch}; old tip kept at ${paint("brand", discarded)}`);
  git(repo, ["reset", "--hard", remoteBranch]);
}
function ensureInboxBranch(repo, config, inbox) {
  const current = git(repo, ["branch", "--show-current"]).stdout.trim();
  if (current === inbox)
    return;
  if (branchExists(repo, inbox)) {
    git(repo, ["switch", inbox]);
    return;
  }
  if (remoteRefExists(repo, inbox)) {
    git(repo, ["switch", "-c", inbox, "--track", `origin/${inbox}`]);
    return;
  }
  if (isStandalone(config) && hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
    return;
  }
  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, `origin/${config.branch}`]);
    return;
  }
  if (branchExists(repo, config.branch)) {
    git(repo, ["switch", "-c", inbox, config.branch]);
    return;
  }
  if (hasAnyCommit(repo)) {
    git(repo, ["switch", "-c", inbox]);
    return;
  }
  bootstrapMainBranch(repo, config);
  git(repo, ["switch", "-c", inbox, config.branch]);
}
function snapshot(repo, mainRoot, inbox, message = "sidecar snapshot", redactionMode = DEFAULT_REDACTION_MODE) {
  if (ensureRedactionFilter(repo, redactionMode) && hasAnyCommit(repo)) {
    git(repo, ["add", "--renormalize", "."]);
  }
  git(repo, ["add", "-A"]);
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    console.log("no sidecar changes to snapshot");
    return false;
  }
  const staged = git(repo, ["-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--diff-filter=d"]).stdout.split(`
`).filter(Boolean);
  const source = `${currentUser()}@${currentHost()}`;
  const body = [message, "", `source: ${source}`];
  if (path2.resolve(repo) !== path2.resolve(mainRoot)) {
    const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
    body.push(`main-head: ${mainHead.status === 0 ? mainHead.stdout.trim() : "unborn"}`);
  }
  body.push(`inbox: ${inbox}`);
  git(repo, ["commit", "-m", body.join(`
`)]);
  console.log(`committed sidecar snapshot to ${paint("brand", inbox)}`);
  reportRedactions(repo, staged, redactionMode);
  return true;
}
function reportRedactions(repo, staged, mode) {
  if (mode === "none")
    return;
  let files = 0;
  let items = 0;
  for (const relPath of staged) {
    const delta = fileRedactionDelta(path2.join(repo, relPath), mode);
    if (!delta)
      continue;
    files += 1;
    items += delta.items;
  }
  if (!files)
    return;
  console.log(`redacted ${items} item(s) in ${files} file(s); review with \`sidecar redactions\`, or add "${NO_REDACT_PRAGMA}" to a file's first lines to opt it out`);
  logSidecarEvent("redaction", { files, items });
}
function fileRedactionDelta(filePath, mode) {
  let data;
  try {
    data = fs2.readFileSync(filePath);
  } catch {
    return;
  }
  const text = decodeUtf8Text(data);
  if (text === undefined || hasNoRedactPragma(text))
    return;
  const redacted = redactText(text, mode);
  if (redacted === text)
    return;
  const items = Math.max(1, countRedactionPlaceholders(redacted) - countRedactionPlaceholders(text));
  return { text, redacted, items };
}
function ensureRedactionFilter(repo, mode = DEFAULT_REDACTION_MODE) {
  const command = mode === "none" ? "cat" : `${filterCommandQuote(process.execPath)} ${filterCommandQuote(redactCliPath())} redact --mode=${mode}`;
  const wanted = [
    [`filter.${REDACTION_FILTER_NAME}.clean`, command],
    [`filter.${REDACTION_FILTER_NAME}.smudge`, "cat"],
    [`filter.${REDACTION_FILTER_NAME}.required`, "true"]
  ];
  const attributesPath = path2.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;
  const configured = git(repo, ["config", "--get-regexp", `^filter\\.${REDACTION_FILTER_NAME}\\.`], {
    check: false
  });
  const current = new Map(configured.stdout.split(`
`).filter(Boolean).map((entry) => {
    const space = entry.indexOf(" ");
    return [entry.slice(0, space), entry.slice(space + 1)];
  }));
  const configOk = wanted.every(([key, value]) => current.get(key) === value);
  let attributes = "";
  try {
    attributes = fs2.readFileSync(attributesPath, "utf8");
  } catch {}
  const attributesOk = attributes.split(/\r?\n/).includes(line);
  if (configOk && attributesOk)
    return false;
  for (const [key, value] of wanted) {
    git(repo, ["config", key, value]);
  }
  if (!attributesOk) {
    fs2.mkdirSync(path2.dirname(attributesPath), { recursive: true });
    fs2.appendFileSync(attributesPath, attributes && !attributes.endsWith(`
`) ? `
${line}
` : `${line}
`, "utf8");
  }
  return true;
}
function removeRedactionFilter(repo) {
  git(repo, ["config", "--remove-section", `filter.${REDACTION_FILTER_NAME}`], { check: false });
  const attributesPath = path2.join(gitCommonDir(repo), "info", "attributes");
  const line = `* filter=${REDACTION_FILTER_NAME}`;
  let contents;
  try {
    contents = fs2.readFileSync(attributesPath, "utf8");
  } catch {
    return;
  }
  const lines = contents.split(/\r?\n/);
  const kept = lines.filter((entry) => entry !== line);
  if (kept.length === lines.length)
    return;
  if (kept.every((entry) => !entry.trim())) {
    fs2.rmSync(attributesPath, { force: true });
  } else {
    fs2.writeFileSync(attributesPath, `${kept.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function redactCliPath() {
  const self = fileURLToPath2(import.meta.url);
  return self.endsWith(".ts") ? path2.join(path2.dirname(self), "..", "dist", "cli.js") : self;
}
function filterCommandQuote(value) {
  return `"${value.replace(/([\\"$`])/g, "\\$1")}"`;
}
function redactBuffer(data, mode) {
  const text = decodeUtf8Text(data);
  if (text === undefined || hasNoRedactPragma(text))
    return data;
  const redacted = redactText(text, mode);
  return redacted === text ? data : Buffer.from(redacted, "utf8");
}
function decodeUtf8Text(data) {
  if (data.includes(0))
    return;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return;
  }
}
function syncBranchBeforePush(repo, branch) {
  fetch(repo, true, false);
  if (!remoteRefExists(repo, branch))
    return;
  const remoteBranch = `origin/${branch}`;
  if (isAncestor(repo, remoteBranch, "HEAD"))
    return;
  if (isDirty(repo)) {
    throw new SidecarError(`${remoteBranch} has commits not in local ${branch}, and the sidecar checkout has uncommitted changes`);
  }
  if (isAncestor(repo, "HEAD", remoteBranch)) {
    git(repo, ["merge", "--ff-only", remoteBranch]);
    return;
  }
  const result = git(repo, ["rebase", remoteBranch], { check: false });
  if (result.status !== 0) {
    git(repo, ["rebase", "--abort"], { check: false });
    throw new SidecarError(result.stderr.trim() || `could not rebase ${branch} onto ${remoteBranch}`);
  }
}
function refreshInboxFromMain(repo, config, inbox) {
  if (!branchExists(repo, inbox) || !branchExists(repo, config.branch))
    return;
  ensureClean(repo);
  git(repo, ["switch", inbox]);
  const result = git(repo, ["merge", "--ff-only", config.branch], { check: false });
  if (result.status !== 0) {
    throw new SidecarError(result.stderr.trim() || `could not fast-forward ${inbox} to ${config.branch}`);
  }
}
function pushBranch(repo, branch) {
  git(repo, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  console.log(`pushed ${paint("brand", branch)}`);
}
function forkConflicts(repo, remoteBranch) {
  const conflicts = unmergedPaths(repo);
  if (!Object.keys(conflicts).length) {
    throw new SidecarError("merge reported conflicts, but no unmerged paths were found");
  }
  const timestamp = utcTimestamp();
  const branch = remoteBranchName(remoteBranch) || remoteBranch;
  const branchLabel = slug(branch);
  const manifestLabel = fileLabel(branch);
  const manifest = {
    timestamp,
    resolved_by: "fork-files",
    source_branch: branch,
    paths: []
  };
  for (const [conflictPath, stages] of Object.entries(conflicts).sort(([left], [right]) => left.localeCompare(right))) {
    const versions = [];
    for (const [stage, label] of [
      [2, "main"],
      [3, branchLabel]
    ]) {
      const blob = showStage(repo, stage, conflictPath);
      if (!blob)
        continue;
      const oid = stages[stage] ?? "";
      const outPath = forkPath(conflictPath, label, oid);
      const fullOut = path2.join(repo, outPath);
      fs2.mkdirSync(path2.dirname(fullOut), { recursive: true });
      fs2.writeFileSync(fullOut, blob);
      versions.push({
        stage,
        label,
        oid,
        path: outPath,
        sha256: crypto.createHash("sha256").update(blob).digest("hex")
      });
    }
    git(repo, ["rm", "-f", "--ignore-unmatch", "--", conflictPath], { check: false });
    const original = path2.join(repo, conflictPath);
    if (fs2.existsSync(original) && fs2.statSync(original).isFile())
      fs2.unlinkSync(original);
    manifest.paths.push({ path: conflictPath, versions });
  }
  const manifestDir = path2.join(repo, ".sidecar-conflicts");
  fs2.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path2.join(manifestDir, `${timestamp}-${manifestLabel}.json`);
  fs2.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  git(repo, ["add", "-A"]);
  if (hasUnmergedPaths(repo)) {
    throw new SidecarError("fork-files did not clear all unmerged paths");
  }
}
function forkPath(conflictPath, label, oid) {
  const parsed = path2.parse(conflictPath);
  const shortOid = oid ? oid.slice(0, 7) : "missing";
  const safeLabel = fileLabel(label);
  const forkName = parsed.ext ? `${parsed.name}.conflict.${safeLabel}.${shortOid}${parsed.ext}` : `${parsed.name}.conflict.${safeLabel}.${shortOid}`;
  return path2.join(parsed.dir, forkName);
}
function fileLabel(value) {
  return slug(value).replaceAll("/", "-");
}
function unmergedPaths(repo) {
  const result = gitBytes(repo, ["ls-files", "-u", "-z"]);
  const paths = {};
  for (const record of result.stdout.toString("binary").split("\x00")) {
    if (!record)
      continue;
    const separator = record.indexOf("\t");
    const meta = record.slice(0, separator);
    const rawPath = record.slice(separator + 1);
    const parts = meta.split(/\s+/);
    const oid = parts[1] ?? "";
    const stage = Number(parts[2]);
    paths[rawPath] ??= {};
    paths[rawPath][stage] = oid;
  }
  return paths;
}
function hasUnmergedPaths(repo) {
  return Object.keys(unmergedPaths(repo)).length > 0;
}
function showStage(repo, stage, conflictPath) {
  const result = gitBytes(repo, ["show", `:${stage}:${conflictPath}`], { check: false });
  return result.status === 0 ? result.stdout : undefined;
}
function pendingInboxBranches(repo, config) {
  const match = inboxBranchMatcher(config);
  const refs = git(repo, ["branch", "-r", "--format=%(refname:short)"]).stdout.split(/\r?\n/);
  return refs.map((ref) => ref.trim()).filter((ref) => ref !== "origin/HEAD" && match(ref)).sort();
}
function remoteBranchName(remoteBranch) {
  return remoteBranch.startsWith("origin/") ? remoteBranch.slice("origin/".length) : remoteBranch;
}
function expandInbox(config, repo) {
  validateInboxTemplate(config.inbox);
  const values = {
    user: slug(currentUser()),
    host: slug(currentHost()),
    random: repo ? checkoutRandom(repo) : "pending"
  };
  const inbox = config.inbox.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined)
      throw new SidecarError(`unknown inbox template variable {${key}}`);
    return value;
  }).replace(/^\/+|\/+$/g, "");
  validateBranch(inbox);
  return inbox;
}
function checkoutRandom(repo) {
  const gitDirectory = gitDir(repo);
  const idPath = path2.join(gitDirectory, "sidecar-id");
  if (fs2.existsSync(idPath)) {
    const existing = slug(fs2.readFileSync(idPath, "utf8"));
    if (existing)
      return existing;
  }
  const id = crypto.randomBytes(6).toString("hex");
  fs2.writeFileSync(idPath, `${id}
`, { encoding: "utf8", mode: 384 });
  return id;
}
function validateBranch(branch) {
  const result = gitRaw(["check-ref-format", "--branch", branch], { check: false });
  if (result.status !== 0)
    throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
}
function validateRemote(remote) {
  const allowedScheme = /^(https?|ssh|git|file):\/\//i;
  const scpLike = /^[A-Za-z0-9._~-]+@[A-Za-z0-9._-]+:/;
  const ok = remote.length > 0 && !remote.startsWith("-") && (allowedScheme.test(remote) || scpLike.test(remote) || path2.isAbsolute(remote));
  if (!ok) {
    throw new SidecarError(`unsupported sidecar remote ${JSON.stringify(remote)}; use an https://, ssh://, git://, or file:// URL, user@host:path, or an absolute path`);
  }
}
function validateInboxTemplate(template) {
  const prefix = inboxBranchPrefix(template);
  if (template.includes("{") && !prefix.endsWith("/")) {
    throw new SidecarError("inbox template must place variables under a static branch namespace, like sidecar-inbox/{user}/{random}");
  }
}
function slug(value) {
  const slugged = value.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").replace(/^[./]+|[./]+$/g, "");
  return slugged || "unknown";
}
function sidecarStateDir() {
  if (process.env[STATE_DIR_ENV])
    return path2.resolve(process.env[STATE_DIR_ENV]);
  if (process.platform === "darwin")
    return path2.join(os.homedir(), "Library", "Application Support", "sidecar");
  if (process.platform === "win32") {
    return path2.join(process.env.APPDATA || path2.join(os.homedir(), "AppData", "Roaming"), "sidecar");
  }
  return path2.join(process.env.XDG_STATE_HOME || path2.join(os.homedir(), ".local", "state"), "sidecar");
}
function instancesPath() {
  return path2.join(sidecarStateDir(), "instances.json");
}
function sidecarLogPath() {
  return path2.join(sidecarStateDir(), "sidecar.log");
}
function settingsPath() {
  return path2.join(sidecarStateDir(), "settings.json");
}
function daemonLaunchAgentPath() {
  if (process.platform !== "darwin")
    return;
  return path2.join(os.homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}
function readSettings() {
  const filePath = settingsPath();
  if (!fs2.existsSync(filePath))
    return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs2.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object")
      return { ...DEFAULT_SETTINGS };
    const record = raw;
    return {
      daemonEnabled: typeof record.daemonEnabled === "boolean" ? record.daemonEnabled : true,
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
      lastUpdateCheckAt: typeof record.lastUpdateCheckAt === "string" ? record.lastUpdateCheckAt : undefined,
      installSource: INSTALL_SOURCES.has(record.installSource) ? record.installSource : undefined
    };
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    });
    return { ...DEFAULT_SETTINGS };
  }
}
function writeSettings(settings) {
  ensureStateDir();
  const record = {
    daemonEnabled: settings.daemonEnabled,
    autoUpdate: settings.autoUpdate
  };
  if (settings.lastUpdateCheckAt)
    record.lastUpdateCheckAt = settings.lastUpdateCheckAt;
  if (settings.installSource)
    record.installSource = settings.installSource;
  fs2.writeFileSync(settingsPath(), `${JSON.stringify(record, null, 2)}
`, "utf8");
}
function readInstances() {
  const filePath = instancesPath();
  if (!fs2.existsSync(filePath))
    return [];
  try {
    const raw = JSON.parse(fs2.readFileSync(filePath, "utf8"));
    if (!Array.isArray(raw))
      return [];
    return raw.filter(isSidecarInstance);
  } catch (error) {
    logSidecarEvent("failure", {
      command: "instances",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    });
    return [];
  }
}
function writeInstances(instances) {
  ensureStateDir();
  fs2.writeFileSync(instancesPath(), `${JSON.stringify(instances, null, 2)}
`, "utf8");
}
function unregisterInstance(root) {
  const instances = readInstances();
  const remaining = instances.filter((instance) => realpathOr2(instance.root) !== realpathOr2(root));
  if (remaining.length !== instances.length)
    writeInstances(remaining);
}
function registerCurrentInstance(root, config, options) {
  if (!shouldUseGlobalRegistry())
    return;
  const sidecarPath = resolveSidecarPath(root, config);
  const existing = readInstances();
  const previous = existing.find((instance2) => instance2.root === root);
  const timestamp = nowIso();
  const instance = {
    root,
    configPath: path2.join(root, ".sidecar"),
    sidecarPath,
    remote: config.remote,
    branch: config.branch,
    inbox: hasGitMetadata(sidecarPath) ? expandInbox(config, sidecarPath) : expandInbox(config),
    registeredAt: previous?.registeredAt ?? timestamp,
    updatedAt: timestamp,
    lastSyncAt: options.lastSyncAt ?? previous?.lastSyncAt
  };
  const next = [instance, ...existing.filter((entry) => entry.root !== root)].sort((left, right) => left.root.localeCompare(right.root));
  writeInstances(next);
  logSidecarEvent(options.event, {
    root: instance.root,
    sidecarPath: instance.sidecarPath,
    remote: instance.remote,
    inbox: instance.inbox
  });
}
function listInstanceStatuses() {
  return readInstances().map((instance) => instanceStatus(instance));
}
function daemonServicePath() {
  if (process.platform === "darwin")
    return daemonLaunchAgentPath();
  if (process.platform === "linux") {
    const configDir = process.env.XDG_CONFIG_HOME || path2.join(os.homedir(), ".config");
    return path2.join(configDir, "systemd", "user", `${DAEMON_LABEL}.service`);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path2.join(os.homedir(), "AppData", "Roaming");
    return path2.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "sidecar-daemon.vbs");
  }
  return;
}
function daemonPidPath() {
  return path2.join(sidecarStateDir(), "daemon.pid");
}
function readDaemonPid() {
  try {
    const pid = Number(fs2.readFileSync(daemonPidPath(), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return;
  }
}
function pidIsSidecarDaemon(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== "EPERM")
      return false;
  }
  if (process.platform === "win32")
    return true;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0)
    return false;
  const command = (result.stdout ?? "").trim();
  return command.includes("daemon") && /sidecar|cli\.js/.test(command);
}
function isDaemonRunning() {
  const pid = readDaemonPid();
  return pid !== undefined && pidIsSidecarDaemon(pid);
}
function daemonServiceFileContents(invocation) {
  if (process.platform === "darwin")
    return daemonPlist(invocation);
  if (process.platform === "linux")
    return daemonSystemdUnit(invocation);
  return daemonWindowsStartupScript(invocation);
}
function daemonServiceStatus() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  const message = process.platform === "linux" && !findExecutableOnPath("systemctl") ? "systemd unavailable; run `sidecar daemon run` manually" : undefined;
  return {
    available: true,
    installed: fs2.existsSync(servicePath),
    running: isDaemonRunning(),
    path: servicePath,
    message
  };
}
function installDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: servicePath, message: "root install skipped" };
  }
  fs2.mkdirSync(sidecarStateDir(), { recursive: true });
  fs2.mkdirSync(path2.dirname(servicePath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs2.writeFileSync(servicePath, daemonServiceFileContents(invocation), "utf8");
  if (process.platform === "darwin") {
    const domain = launchctlDomain();
    spawnSync("launchctl", ["bootout", domain, servicePath], { stdio: "ignore" });
    const bootstrap = spawnSync("launchctl", ["bootstrap", domain, servicePath], { encoding: "utf8" });
    if (bootstrap.status !== 0) {
      return {
        available: true,
        installed: true,
        running: false,
        path: servicePath,
        message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed"
      };
    }
    spawnSync("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    spawnSync("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
    return daemonServiceStatus();
  }
  if (process.platform === "linux") {
    if (!findExecutableOnPath("systemctl")) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: "systemd unavailable; run `sidecar daemon run` manually"
      };
    }
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const enable = spawnSync("systemctl", ["--user", "enable", "--now", `${DAEMON_LABEL}.service`], {
      encoding: "utf8"
    });
    spawnSync("systemctl", ["--user", "restart", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
    if (enable.status !== 0) {
      return {
        available: true,
        installed: true,
        running: isDaemonRunning(),
        path: servicePath,
        message: enable.stderr.trim() || enable.stdout.trim() || "systemctl enable failed"
      };
    }
    return daemonServiceStatus();
  }
  stopDaemonProcess();
  startDetachedDaemon(invocation);
  return daemonServiceStatus();
}
function stopDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const servicePath = daemonServicePath();
  if (!servicePath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (process.platform === "darwin") {
    spawnSync("launchctl", ["bootout", launchctlDomain(), servicePath], { stdio: "ignore" });
  } else if (process.platform === "linux" && findExecutableOnPath("systemctl")) {
    spawnSync("systemctl", ["--user", "disable", "--now", `${DAEMON_LABEL}.service`], { stdio: "ignore" });
  } else if (process.platform === "win32" && fs2.existsSync(servicePath)) {
    fs2.rmSync(servicePath, { force: true });
  }
  stopDaemonProcess();
  return { available: true, installed: fs2.existsSync(servicePath), running: false, path: servicePath };
}
function stopDaemonProcess() {
  const pid = readDaemonPid();
  if (!pid || pid === process.pid)
    return;
  if (!pidIsSidecarDaemon(pid)) {
    fs2.rmSync(daemonPidPath(), { force: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}
function startDetachedDaemon(invocation = currentExecutableInvocation()) {
  const child = spawn2(invocation[0], invocation.slice(1), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, [SKIP_LOCAL_EXEC_ENV2]: "1", [GLOBAL_EXEC_ENV2]: "1" }
  });
  child.unref();
}
function ensureDaemonServiceFile() {
  if (process.env[SKIP_SERVICE_ENV] === "1")
    return;
  const servicePath = daemonServicePath();
  if (!servicePath || fs2.existsSync(servicePath))
    return;
  try {
    fs2.mkdirSync(path2.dirname(servicePath), { recursive: true });
    fs2.writeFileSync(servicePath, daemonServiceFileContents(currentExecutableInvocation()), "utf8");
    logSidecarEvent("daemon-service-heal", { path: servicePath });
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not restore service file: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}
function daemonServiceLabel(service) {
  if (!service.available)
    return "unavailable";
  if (!service.installed)
    return "uninstalled";
  return service.running ? "running" : "stopped";
}
function launchctlDomain() {
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  return `gui/${uid}`;
}
function currentExecutableInvocation() {
  return [process.execPath, currentExecutablePath(), "daemon", "run"];
}
function currentExecutablePath() {
  return realpathOr2(process.argv[1] || fileURLToPath2(import.meta.url));
}
function currentExecutableStamp(programArguments) {
  const executable = programArguments[1];
  if (!executable)
    return "unknown";
  try {
    const stat = fs2.statSync(executable);
    return `${executable}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return executable;
  }
}
function daemonPlist(programArguments) {
  return plist({
    Label: DAEMON_LABEL,
    ProgramArguments: programArguments,
    RunAtLoad: true,
    KeepAlive: true,
    StandardOutPath: path2.join(sidecarStateDir(), "daemon.out.log"),
    StandardErrorPath: path2.join(sidecarStateDir(), "daemon.err.log"),
    EnvironmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      SIDECAR_DAEMON_EXECUTABLE: currentExecutableStamp(programArguments)
    }
  });
}
function daemonSystemdUnit(programArguments) {
  const execStart = programArguments.map((part) => `"${part.replaceAll('"', "\\\"")}"`).join(" ");
  return [
    "[Unit]",
    "Description=sidecar background sync daemon",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=always",
    "RestartSec=10",
    `Environment="PATH=${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}"`,
    `Environment="SIDECAR_DAEMON_EXECUTABLE=${currentExecutableStamp(programArguments)}"`,
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join(`
`);
}
function daemonWindowsStartupScript(programArguments) {
  const command = programArguments.map((part) => `""${part}""`).join(" ");
  return `CreateObject("WScript.Shell").Run "${command}", 0, False\r
`;
}
function plist(value) {
  const body = Object.entries(value).map(([key, item]) => `  <key>${escapeXml(key)}</key>
${plistValue(item, 2)}`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}
function plistValue(value, indent) {
  const pad = " ".repeat(indent);
  if (typeof value === "string")
    return `${pad}<string>${escapeXml(value)}</string>
`;
  if (typeof value === "boolean")
    return `${pad}<${value ? "true" : "false"}/>
`;
  if (Array.isArray(value)) {
    return `${pad}<array>
${value.map((item) => plistValue(item, indent + 2)).join("")}${pad}</array>
`;
  }
  if (value && typeof value === "object") {
    return `${pad}<dict>
${Object.entries(value).map(([key, item]) => `${" ".repeat(indent + 2)}<key>${escapeXml(key)}</key>
${plistValue(item, indent + 2)}`).join("")}${pad}</dict>
`;
  }
  return `${pad}<string></string>
`;
}
function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function redactLogValue(value) {
  if (typeof value === "string")
    return redactText(value);
  if (Array.isArray(value))
    return value.map(redactLogValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactLogValue(entry)]));
  }
  return value;
}
function logSidecarEvent(event, fields = {}) {
  try {
    ensureStateDir();
    const logPath = sidecarLogPath();
    try {
      if (fs2.statSync(logPath).size > LOG_ROTATE_BYTES) {
        fs2.renameSync(logPath, `${logPath}.1`);
      }
    } catch {}
    const record = {
      timestamp: nowIso(),
      event,
      ...redactLogValue(fields)
    };
    fs2.appendFileSync(logPath, `${JSON.stringify(record)}
`, "utf8");
  } catch {}
}
function followLog(filePath, startOffset) {
  let offset = startOffset;
  while (true) {
    sleep(1000);
    let stat;
    try {
      stat = fs2.statSync(filePath);
    } catch {
      offset = 0;
      continue;
    }
    if (stat.size < offset)
      offset = 0;
    if (stat.size <= offset)
      continue;
    const fd = fs2.openSync(filePath, "r");
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs2.readSync(fd, buffer, 0, length, offset);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
        offset += bytesRead;
      }
    } finally {
      fs2.closeSync(fd);
    }
  }
}
function ensureStateDir() {
  fs2.mkdirSync(sidecarStateDir(), { recursive: true });
}
function isSidecarInstance(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return typeof record.root === "string" && typeof record.configPath === "string" && typeof record.sidecarPath === "string" && typeof record.remote === "string" && typeof record.branch === "string" && typeof record.inbox === "string" && typeof record.registeredAt === "string" && typeof record.updatedAt === "string";
}
function instanceStatus(instance) {
  let config = "ok";
  if (!fs2.existsSync(instance.configPath)) {
    config = "missing";
  } else {
    try {
      readConfig(instance.configPath);
    } catch {
      config = "invalid";
    }
  }
  const checkout = hasGitMetadata(instance.sidecarPath) ? "present" : "missing";
  let dirty = "unknown";
  let currentBranch = "";
  if (checkout === "present") {
    const branch = git(instance.sidecarPath, ["branch", "--show-current"], { check: false });
    if (branch.status === 0)
      currentBranch = branch.stdout.trim();
    const status = git(instance.sidecarPath, ["status", "--porcelain"], { check: false });
    if (status.status === 0)
      dirty = status.stdout.trim() ? "yes" : "no";
  }
  return {
    ...instance,
    config,
    checkout,
    dirty,
    currentBranch
  };
}
function shouldUseGlobalRegistry() {
  return process.env[GLOBAL_EXEC_ENV2] === "1" || !findDependencyRoot(process.cwd());
}
function isProjectLocalPath(executable) {
  const depRoot = findDependencyRoot(path2.dirname(executable));
  if (!depRoot)
    return false;
  if (realpathOr2(depRoot) === realpathOr2(bunGlobalRoot()))
    return false;
  return isInsidePath2(executable, path2.join(depRoot, "node_modules"));
}
function bunGlobalRoot() {
  return path2.join(process.env.BUN_INSTALL || path2.join(os.homedir(), ".bun"), "install", "global");
}
function realpathOr2(filePath) {
  try {
    return fs2.realpathSync(filePath);
  } catch {
    return path2.resolve(filePath);
  }
}
function isInsidePath2(child, parent) {
  const relative = path2.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path2.isAbsolute(relative);
}
function packageVersion() {
  let current = path2.dirname(fileURLToPath2(import.meta.url));
  while (true) {
    const manifestPath = path2.join(current, "package.json");
    if (fs2.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
        if (manifest.name === PACKAGE_NAME && manifest.version)
          return manifest.version;
      } catch {}
    }
    const parent = path2.dirname(current);
    if (parent === current)
      return "0.0.0";
    current = parent;
  }
}
function findDependencyRoot(start) {
  let current = path2.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current))
      return current;
    const parent = path2.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function projectDependsOnSidecar(projectRoot) {
  const manifestPath = path2.join(projectRoot, "package.json");
  if (!fs2.existsSync(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME] || manifest.devDependencies?.[PACKAGE_NAME] || manifest.optionalDependencies?.[PACKAGE_NAME] || manifest.peerDependencies?.[PACKAGE_NAME]);
  } catch {
    return false;
  }
}
function promptSidecarPath(root) {
  if (!process.stdin.isTTY)
    return DEFAULT_PATH;
  console.log(`sidecar keeps its files in a directory inside this repo — "." makes this repo itself the sidecar.`);
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const answer = promptLine(`sidecar path ${paint("quiet", `[${DEFAULT_PATH}]`)}: `) || DEFAULT_PATH;
    if (!isStandalonePath(answer))
      return answer;
    console.log(`standalone mode makes ${paint("repo", root)} itself the sidecar:`);
    console.log("  sidecar owns this repo's branches, commits every change, and syncs it to its own remote.");
    console.log("  your own commits still work; leave branch management to sidecar.");
    if (promptYesNoDefaultNo("use standalone mode?"))
      return ".";
  }
  console.log(`keeping the default (${DEFAULT_PATH})`);
  return DEFAULT_PATH;
}
function standaloneRemote(root) {
  const origin = git(root, ["remote", "get-url", "origin"], { check: false });
  const remote = origin.status === 0 ? origin.stdout.trim() : "";
  if (!remote) {
    throw new SidecarError("standalone mode syncs this repo to its own origin, but it has none; add one with `git remote add origin <url>`, or name a remote with `sidecar init <remote> --path .`");
  }
  validateRemote(remote);
  console.log(`standalone remote: ${paint("brand", remote)} ${paint("quiet", "(this repo's origin)")}`);
  return remote;
}
function promptRemote(root) {
  if (!process.stdin.isTTY) {
    throw new SidecarError("remote URL is required when no .sidecar config exists");
  }
  console.log("sidecar stores its files in a separate git repo that you own — any empty repo works.");
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const remote = promptLine(`sidecar remote URL ${paint("quiet", "(leave blank to create one with gh)")}: `);
    if (!remote)
      return createRemoteWithGh(root);
    try {
      validateRemote(remote);
      return remote;
    } catch (error) {
      console.log(error instanceof SidecarError ? `sidecar: ${error.message}` : String(error));
    }
  }
  throw new SidecarError("no valid remote URL provided");
}
function promptRedactionMode(defaultMode) {
  if (!process.stdin.isTTY)
    return defaultMode;
  console.log("redaction rewrites sensitive values out of pushed content; your local files are never touched.");
  const describe = (mode, text) => `  ${mode.padEnd(11)}  ${text}${mode === defaultMode ? ` ${paint("quiet", "(recommended)")}` : ""}`;
  console.log(describe("secrets+pii", "redact API keys, tokens, emails, and other PII"));
  console.log(describe("secrets", "redact API keys and tokens only"));
  console.log(describe("none", "push content verbatim"));
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const answer = promptLine(`redaction mode ${paint("quiet", `[${defaultMode}]`)}: `).toLowerCase();
    if (!answer)
      return defaultMode;
    if (REDACTION_MODES.includes(answer))
      return answer;
    console.log(`invalid redaction mode; expected one of ${REDACTION_MODES.join(", ")}`);
  }
  console.log(`keeping the default (${defaultMode})`);
  return defaultMode;
}
function createRemoteWithGh(root) {
  const gh = findExecutableOnPath(process.platform === "win32" ? "gh.exe" : "gh");
  if (!gh) {
    throw new SidecarError("gh not found on PATH; install the GitHub CLI (https://cli.github.com) or rerun with `sidecar init <remote>`");
  }
  const origin = git(root, ["remote", "get-url", "origin"], { check: false }).stdout.trim() || undefined;
  const parsedOrigin = origin ? parseGitHubRemote(origin) : undefined;
  const owner = parsedOrigin?.owner ?? ghLogin(gh);
  const baseName = parsedOrigin?.repo ?? path2.basename(root);
  const suggested = owner ? `${owner}/${baseName}-sidecar` : `${baseName}-sidecar`;
  const answer = promptLine(`repository to create ${paint("quiet", `[${suggested}]`)}: `) || suggested;
  const fullName = answer.includes("/") ? answer : owner ? `${owner}/${answer}` : undefined;
  if (!fullName) {
    throw new SidecarError("could not determine the repository owner; enter it as owner/name");
  }
  console.log(`running gh repo create ${fullName} --private`);
  const create = spawnSync(gh, ["repo", "create", fullName, "--private"], { stdio: "inherit" });
  if (create.status !== 0) {
    throw new SidecarError("gh repo create failed; create the repo yourself and rerun `sidecar init <remote>`");
  }
  const ssh = origin ? origin.startsWith("git@") || origin.startsWith("ssh://") : ghGitProtocol(gh) === "ssh";
  return ssh ? `git@github.com:${fullName}.git` : `https://github.com/${fullName}.git`;
}
function parseGitHubRemote(url) {
  const match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(url) ?? /^(?:https|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  if (!match)
    return;
  return { owner: match[1], repo: match[2] };
}
function ghLogin(gh) {
  const result = spawnSync(gh, ["api", "user", "-q", ".login"], { encoding: "utf8" });
  if (result.status !== 0)
    return;
  const login = result.stdout.trim();
  return login || undefined;
}
function ghGitProtocol(gh) {
  const result = spawnSync(gh, ["config", "get", "git_protocol"], { encoding: "utf8" });
  if (result.status !== 0)
    return "https";
  return result.stdout.trim() || "https";
}
function promptOverwriteConfig(configPath, existingRemote, newRemote) {
  if (!process.stdin.isTTY) {
    throw new SidecarError(`${configPath} already exists (remote ${existingRemote}); delete it to reinitialize with ${newRemote}`);
  }
  console.log(`${configPath} already exists (remote ${existingRemote})`);
  const answer = promptLine(`overwrite it with the new settings? ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}
function promptYesNo(question) {
  if (!process.stdin.isTTY)
    return false;
  const answer = promptLine(`${question} ${paint("quiet", "[Y/n]")} `).toLowerCase();
  return answer === "" || answer === "y" || answer === "yes";
}
function promptYesNoDefaultNo(question) {
  if (!process.stdin.isTTY)
    return false;
  const answer = promptLine(`${question} ${paint("quiet", "[y/N]")} `).toLowerCase();
  return answer === "y" || answer === "yes";
}
function promptLine(prompt) {
  fs2.writeSync(1, prompt);
  const fd = fs2.openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(1);
    while (true) {
      const bytesRead = fs2.readSync(fd, buffer, 0, 1, null);
      if (bytesRead === 0)
        break;
      const char = buffer.toString("utf8", 0, bytesRead);
      if (char === `
` || char === "\r")
        break;
      chunks.push(char);
    }
    return chunks.join("").trim();
  } finally {
    fs2.closeSync(fd);
  }
}
function loadProject() {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path2.join(root, ".sidecar"))];
}
function findConfigRoot(start) {
  const root = findConfigRootOptional(start);
  if (root)
    return root;
  throw new SidecarError("could not find .sidecar");
}
function findConfigRootOptional(start) {
  let current = path2.resolve(start);
  while (true) {
    if (fs2.existsSync(path2.join(current, ".sidecar")))
      return current;
    const parent = path2.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function gitToplevel(cwd) {
  const root = gitToplevelOptional(cwd);
  if (!root)
    throw new SidecarError("not inside a Git repository");
  return root;
}
function gitToplevelOptional(cwd) {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0)
    return;
  return result.stdout.trim();
}
function gitCommonDir(root) {
  const result = gitRaw(["-C", root, "rev-parse", "--git-common-dir"], { check: false });
  if (result.status !== 0)
    throw new SidecarError("not inside a Git repository");
  return path2.resolve(root, result.stdout.trim());
}
function requireSidecarCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    throw new SidecarError(`missing sidecar checkout at ${sidecarPath}; run \`sidecar clone\``);
  }
  return sidecarPath;
}
function ensureSidecarCheckout(root, config) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (!hasGitMetadata(sidecarPath)) {
    cloneOrUpdate(root, config, true);
  }
  return requireSidecarCheckout(root, config);
}
function writeConfig(configPath, config) {
  const text = [
    `version = ${config.version}`,
    `remote = ${JSON.stringify(config.remote)}`,
    `path = ${JSON.stringify(config.path)}`,
    `branch = ${JSON.stringify(config.branch)}`,
    `inbox = ${JSON.stringify(config.inbox)}`,
    `redaction = ${JSON.stringify(config.redaction ?? DEFAULT_REDACTION_MODE)}`,
    ""
  ].join(`
`);
  fs2.writeFileSync(configPath, text, "utf8");
}
function readConfig(configPath) {
  let values;
  try {
    const parsed = parse(fs2.readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SidecarError(`${configPath} must contain a TOML table`);
    }
    values = parsed;
  } catch (error) {
    if (error instanceof SidecarError)
      throw error;
    throw new SidecarError(`${configPath} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const remote = optionalStringConfigValue(configPath, values, "remote");
  if (!remote)
    throw new SidecarError(`${configPath} is missing remote`);
  const config = {
    remote,
    version: numberConfigValue(configPath, values, "version", 1),
    path: stringConfigValue(configPath, values, "path", DEFAULT_PATH),
    branch: stringConfigValue(configPath, values, "branch", DEFAULT_BRANCH),
    inbox: stringConfigValue(configPath, values, "inbox", DEFAULT_INBOX),
    redaction: redactionModeConfigValue(stringConfigValue(configPath, values, "redaction", DEFAULT_REDACTION_MODE), configPath)
  };
  validateRemote(config.remote);
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  return config;
}
function redactionModeConfigValue(value, source) {
  if (REDACTION_MODES.includes(value))
    return value;
  throw new SidecarError(`${source}: invalid redaction mode ${JSON.stringify(value)}; expected one of ${REDACTION_MODES.join(", ")}`);
}
function removeLegacyGitHooks(root) {
  let removed = false;
  try {
    const commonDir = gitCommonDir(root);
    const hooksDir = path2.join(commonDir, "hooks");
    for (const name of LEGACY_HOOK_NAMES) {
      const hookPath = path2.join(hooksDir, name);
      if (!fs2.existsSync(hookPath))
        continue;
      const lines = fs2.readFileSync(hookPath, "utf8").split(`
`);
      const kept = lines.filter((line) => !line.includes(LEGACY_HOOK_MARKER));
      if (kept.length === lines.length)
        continue;
      if (kept.every((line) => !line.trim() || line.trim() === "#!/bin/sh")) {
        fs2.rmSync(hookPath);
      } else {
        fs2.writeFileSync(hookPath, `${kept.join(`
`).replace(/\n*$/, `
`)}`, "utf8");
      }
      removed = true;
    }
    const helperPath = path2.join(hooksDir, LEGACY_HOOK_HELPER);
    if (fs2.existsSync(helperPath)) {
      fs2.rmSync(helperPath);
      removed = true;
    }
    fs2.rmSync(path2.join(commonDir, LEGACY_SYNC_STAMP_FILE), { force: true });
  } catch {}
  if (removed)
    logSidecarEvent("legacy-hooks-removed", { root });
  return removed;
}
function acquireSyncLock(root) {
  const lockDir = path2.join(gitCommonDir(root), "sidecar-sync-lock");
  for (let attempt = 0;attempt < 2; attempt++) {
    try {
      fs2.mkdirSync(lockDir);
      fs2.writeFileSync(path2.join(lockDir, "pid"), String(process.pid), "utf8");
      return () => fs2.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (!syncLockIsStale(lockDir))
        return;
      fs2.rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return;
}
function acquireSyncLockOrThrow(root) {
  const release = acquireSyncLock(root);
  if (release)
    return release;
  throw new SidecarError("another sidecar sync is already running; try again once it finishes");
}
function withSyncLock(root, onBusy, fn) {
  const releaseLock = onBusy === "skip" ? acquireSyncLock(root) : acquireSyncLockOrThrow(root);
  if (!releaseLock) {
    console.log("another sidecar sync is already running; skipping this soft sync");
    return false;
  }
  try {
    fn();
    return true;
  } finally {
    releaseLock();
  }
}
function syncLockIsStale(lockDir) {
  let pid;
  try {
    pid = Number(fs2.readFileSync(path2.join(lockDir, "pid"), "utf8").trim());
  } catch {
    try {
      return Date.now() - fs2.statSync(lockDir).mtimeMs > 600000;
    } catch {
      return true;
    }
  }
  if (!Number.isInteger(pid) || pid <= 0)
    return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code !== "EPERM";
  }
}
function ensureSidecarIgnored(root, sidecarPath) {
  const entry = ignoreEntryForSidecarPath(root, sidecarPath);
  if (!entry)
    return;
  ensureIgnoreEntry(path2.join(root, ".gitignore"), entry);
  removeIgnoreEntry(path2.join(gitCommonDir(root), "info", "exclude"), entry);
  return entry;
}
function ensureIgnoreEntry(ignorePath, sidecarPath) {
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs2.existsSync(ignorePath) ? fs2.readFileSync(ignorePath, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry)) {
    lines.push(entry);
    fs2.writeFileSync(ignorePath, `${lines.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function removeIgnoreEntry(ignorePath, sidecarPath) {
  if (!fs2.existsSync(ignorePath))
    return;
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs2.readFileSync(ignorePath, "utf8").split(/\r?\n/);
  const kept = lines.filter((line) => line !== entry);
  if (kept.length === lines.length)
    return;
  if (kept.every((line) => !line.trim())) {
    fs2.rmSync(ignorePath);
  } else {
    fs2.writeFileSync(ignorePath, `${kept.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function hasZedInclusion(root, sidecarPath) {
  const settingsPath2 = path2.join(root, ".zed", "settings.json");
  if (!fs2.existsSync(settingsPath2))
    return false;
  try {
    const parsed = JSON.parse(fs2.readFileSync(settingsPath2, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return false;
    const inclusions = parsed.file_scan_inclusions;
    return Array.isArray(inclusions) && inclusions.includes(zedInclusionGlob(sidecarPath));
  } catch {
    return false;
  }
}
function zedInclusionGlob(sidecarPath) {
  return `${sidecarPath.replace(/^\/+|\/+$/g, "")}/**`;
}
function ensureZedInclusion(root, sidecarPath) {
  const glob = zedInclusionGlob(sidecarPath);
  const settingsPath2 = path2.join(root, ".zed", "settings.json");
  let settings = {};
  if (fs2.existsSync(settingsPath2)) {
    try {
      const parsed = JSON.parse(fs2.readFileSync(settingsPath2, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return false;
      settings = parsed;
    } catch {
      return false;
    }
  }
  const inclusions = Array.isArray(settings.file_scan_inclusions) ? settings.file_scan_inclusions : [".env*"];
  if (!inclusions.includes(glob)) {
    inclusions.push(glob);
    settings.file_scan_inclusions = inclusions;
    fs2.mkdirSync(path2.dirname(settingsPath2), { recursive: true });
    fs2.writeFileSync(settingsPath2, `${JSON.stringify(settings, null, 2)}
`, "utf8");
  }
  return true;
}
function removeZedInclusion(root, sidecarPath) {
  const settingsPath2 = path2.join(root, ".zed", "settings.json");
  if (!fs2.existsSync(settingsPath2))
    return;
  try {
    const settings = JSON.parse(fs2.readFileSync(settingsPath2, "utf8"));
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      return;
    const inclusions = settings.file_scan_inclusions;
    if (!Array.isArray(inclusions))
      return;
    const glob = zedInclusionGlob(sidecarPath);
    const remaining = inclusions.filter((entry) => entry !== glob);
    if (remaining.length === inclusions.length)
      return;
    if (remaining.length) {
      settings.file_scan_inclusions = remaining;
    } else {
      delete settings.file_scan_inclusions;
    }
    fs2.writeFileSync(settingsPath2, `${JSON.stringify(settings, null, 2)}
`, "utf8");
  } catch {
    console.error(`sidecar: warning: could not safely remove the Zed inclusion from ${settingsPath2}`);
  }
}
function ignoreEntryForSidecarPath(root, sidecarPath) {
  const resolvedRoot = path2.resolve(root);
  const resolvedSidecarPath = path2.resolve(root, sidecarPath);
  const relative = path2.relative(resolvedRoot, resolvedSidecarPath);
  if (!relative || relative.startsWith("..") || path2.isAbsolute(relative))
    return;
  return relative;
}
function ensureClean(repo) {
  if (isDirty(repo))
    throw new SidecarError("sidecar checkout has uncommitted changes");
}
function ensureCommitIdentity(repo) {
  if (git(repo, ["config", "user.name"], { check: false }).status !== 0) {
    git(repo, ["config", "user.name", currentUser()]);
  }
  if (git(repo, ["config", "user.email"], { check: false }).status !== 0) {
    git(repo, ["config", "user.email", `${slug(currentUser())}@${slug(currentHost())}.local`]);
  }
}
function currentUser() {
  return process.env.USER || os.userInfo().username || "unknown";
}
function currentHost() {
  return os.hostname().split(".", 1)[0] || "unknown";
}
function fetch(repo, quiet, check = true) {
  const args = ["fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"];
  if (quiet)
    args.splice(1, 0, "--quiet");
  git(repo, args, { check });
}
function hasAnyCommit(repo) {
  return git(repo, ["rev-parse", "--verify", "HEAD"], { check: false }).status === 0;
}
function branchExists(repo, branch) {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { check: false }).status === 0;
}
function remoteRefExists(repo, branch) {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], {
    check: false
  }).status === 0;
}
function isAncestor(repo, maybeAncestor, descendant) {
  return git(repo, ["merge-base", "--is-ancestor", maybeAncestor, descendant], { check: false }).status === 0;
}
function git(repo, args, options = {}) {
  return gitRaw(["-C", repo, ...args], options);
}
function gitBytes(repo, args, options = {}) {
  const check = options.check ?? true;
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "buffer",
    maxBuffer: 104857600
  });
  const status = result.status ?? 1;
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  if (check && status !== 0) {
    throw new SidecarError(stderr.toString("utf8").trim() || stdout.toString("utf8").trim());
  }
  return { status, stdout, stderr };
}
function gitRaw(args, options = {}) {
  const check = options.check ?? true;
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 104857600
  });
  const status = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (check && status !== 0) {
    throw new SidecarError(stderr.trim() || stdout.trim());
  }
  return { status, stdout, stderr };
}
function parseOptions(args, spec) {
  const flags = new Set;
  const values = new Map;
  const positional = [];
  for (let index = 0;index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const [name, inlineValue] = equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)];
    if (spec.value.has(name)) {
      const value = inlineValue ?? args[++index];
      if (value === undefined)
        throw new SidecarError(`${name} requires a value`);
      values.set(name, value);
      continue;
    }
    if (inlineValue !== undefined)
      throw new SidecarError(`${name} does not take a value`);
    if (spec.boolean.has(name)) {
      flags.add(name);
      continue;
    }
    throw new SidecarError(`unknown option ${name}`);
  }
  return { flags, values, positional };
}
function getValue(parsed, name, fallback) {
  return parsed.values.get(name) ?? fallback;
}
function resolveSidecarPath(root, config) {
  return path2.resolve(root, config.path);
}
function isStandalone(config) {
  return isStandalonePath(config.path);
}
function isStandalonePath(sidecarPath) {
  return path2.normalize(sidecarPath).replace(/[/\\]+$/, "") === ".";
}
function pathIsRepoRoot(root, candidate) {
  const resolved = path2.resolve(root, candidate);
  if (resolved === path2.resolve(root))
    return true;
  try {
    return fs2.realpathSync(resolved) === fs2.realpathSync(root);
  } catch {
    return false;
  }
}
function hasGitMetadata(repo) {
  return fs2.existsSync(path2.join(repo, ".git"));
}
function isDirty(repo) {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
}
function gitDir(repo) {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path2.isAbsolute(result) ? result : path2.resolve(repo, result);
}
function stringConfigValue(configPath, values, key, fallback) {
  const value = values[key] ?? fallback;
  if (typeof value !== "string")
    throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}
function optionalStringConfigValue(configPath, values, key) {
  const value = values[key];
  if (value === undefined)
    return;
  if (typeof value !== "string")
    throw new SidecarError(`${configPath} ${key} must be a string`);
  return value;
}
function numberConfigValue(configPath, values, key, fallback) {
  const value = values[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SidecarError(`${configPath} ${key} must be an integer`);
  }
  return value;
}
function inboxBranchMatcher(config) {
  const prefix = `origin/${inboxBranchPrefix(config.inbox)}`;
  if (prefix.endsWith("/"))
    return (remoteBranch) => remoteBranch.startsWith(prefix);
  return (remoteBranch) => remoteBranch === prefix;
}
function inboxBranchPrefix(template) {
  const variableIndex = template.indexOf("{");
  if (variableIndex === -1)
    return template.replace(/^\/+|\/+$/g, "");
  const staticPrefix = template.slice(0, variableIndex).replace(/^\/+/, "");
  const slashIndex = staticPrefix.lastIndexOf("/");
  return slashIndex === -1 ? staticPrefix : staticPrefix.slice(0, slashIndex + 1);
}
function utcTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function nowIso() {
  return new Date().toISOString();
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
var DEFAULT_PATH = "sidecar", DEFAULT_BRANCH = "main", DEFAULT_INBOX = "sidecar-inbox/{user}/{random}", PACKAGE_NAME = "@projectors/sidecar", PACKAGE_SPEC = "@projectors/sidecar", GLOBAL_EXEC_ENV2 = "SIDECAR_GLOBAL_EXEC", SKIP_LOCAL_EXEC_ENV2 = "SIDECAR_SKIP_LOCAL_EXEC", STATE_DIR_ENV = "SIDECAR_STATE_DIR", SOFT_SYNC_ENV = "SIDECAR_SYNC_SOFT", SKIP_SERVICE_ENV = "SIDECAR_SKIP_SERVICE", DAEMON_LABEL = "com.anteprojector.sidecar", SidecarError, INSTALL_SOURCES, KNOWN_COMMANDS, STATUS_LABEL_WIDTH, DAEMON_LABEL_WIDTH, REDACTION_FILTER_NAME = "sidecar-redact", DEFAULT_SETTINGS, LOG_ROTATE_BYTES = 5242880, LEGACY_HOOK_NAMES, LEGACY_HOOK_HELPER = "sidecar-sync-hook", LEGACY_HOOK_MARKER = "sidecar-sync", LEGACY_SYNC_STAMP_FILE = "sidecar-last-sync";
var init_cli = __esm(() => {
  init_dist();
  init_color();
  init_redaction();
  SidecarError = class SidecarError extends Error {
    constructor(message) {
      super(message);
      this.name = "SidecarError";
    }
  };
  INSTALL_SOURCES = new Set(["npm", "bun", "curl"]);
  KNOWN_COMMANDS = [
    "init",
    "clone",
    "deinit",
    "status",
    "instances",
    "tail",
    "daemon",
    "register-install",
    "set-install-source",
    "update",
    "snapshot",
    "sync",
    "merge",
    "redact",
    "redactions",
    "version",
    "help"
  ];
  STATUS_LABEL_WIDTH = "pending inbox:".length;
  DAEMON_LABEL_WIDTH = "settings:".length;
  DEFAULT_SETTINGS = { daemonEnabled: true, autoUpdate: true };
  LEGACY_HOOK_NAMES = ["post-commit", "pre-push"];
});

// src/bin.ts
init_cli();
import fs3 from "node:fs";
import path3 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var SKIP_LOCAL_EXEC_ENV3 = "SIDECAR_SKIP_LOCAL_EXEC";
var GLOBAL_EXEC_ENV3 = "SIDECAR_GLOBAL_EXEC";
var PACKAGE_NAME2 = "@projectors/sidecar";
var GLOBAL_ONLY_COMMANDS = new Set(["daemon", "deinit", "register-install", "set-install-source", "update"]);
if (!process.env[SKIP_LOCAL_EXEC_ENV3]) {
  const localExecutable = findLocalExecutable(process.cwd(), fileURLToPath3(import.meta.url));
  if (localExecutable) {
    if (GLOBAL_ONLY_COMMANDS.has(process.argv[2])) {
      process.env[GLOBAL_EXEC_ENV3] = "1";
    } else {
      const result = spawnSync2(process.execPath, [localExecutable, ...process.argv.slice(2)], {
        stdio: "inherit",
        env: {
          ...process.env,
          [SKIP_LOCAL_EXEC_ENV3]: "1",
          [GLOBAL_EXEC_ENV3]: "1"
        }
      });
      if (result.signal) {
        process.kill(process.pid, result.signal);
      }
      process.exit(result.status ?? 1);
    }
  }
}
process.exit(await main());
function findLocalExecutable(start, self) {
  let current = path3.resolve(start);
  while (true) {
    if (projectDependsOnSidecar2(current)) {
      const candidate = path3.join(current, "node_modules", "@projectors", "sidecar", "dist", "cli.js");
      if (isFile2(candidate) && !sameFile(candidate, self)) {
        return candidate;
      }
    }
    const parent = path3.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function projectDependsOnSidecar2(projectRoot) {
  const manifestPath = path3.join(projectRoot, "package.json");
  if (!isFile2(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs3.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME2] || manifest.devDependencies?.[PACKAGE_NAME2] || manifest.optionalDependencies?.[PACKAGE_NAME2] || manifest.peerDependencies?.[PACKAGE_NAME2]);
  } catch {
    return false;
  }
}
function isFile2(filePath) {
  try {
    return fs3.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function sameFile(first, second) {
  try {
    return fs3.realpathSync(first) === fs3.realpathSync(second);
  } catch {
    return false;
  }
}
