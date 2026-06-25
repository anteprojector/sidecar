#!/usr/bin/env node

// src/bin.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/cli.ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

// node_modules/smol-toml/dist/date.js
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
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;

class TomlDate extends Date {
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
}

// node_modules/smol-toml/dist/error.js
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

class TomlError extends Error {
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
}

// node_modules/smol-toml/dist/primitive.js
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
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
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

// node_modules/smol-toml/dist/util.js
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

// node_modules/smol-toml/dist/extract.js
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

// node_modules/smol-toml/dist/struct.js
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
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
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

// node_modules/smol-toml/dist/parse.js
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

// node_modules/smol-toml/dist/stringify.js
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

// node_modules/smol-toml/dist/index.js
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

// src/redaction.ts
var KEY_NAME_PATTERN = String.raw`[A-Za-z_][A-Za-z0-9_-]*`;
var QUOTED_KEY_SECRET_REGEX = new RegExp(String.raw`(["'])(${KEY_NAME_PATTERN})\1(\s*:\s*)(["'])([^"'\r\n]+)(\4)`, "g");
var ASSIGNMENT_SECRET_REGEX = new RegExp(String.raw`\b(${KEY_NAME_PATTERN})(\s*[:=]\s*)(["']?)([^\s"',;` + "`" + String.raw`]+)(\3)`, "g");
var AUTHORIZATION_HEADER_REGEX = /\b(authorization\s*:\s*bearer\s+)([^\s"',;`]+)/gi;
var BARE_BEARER_TOKEN_REGEX = /\b(Bearer\s+)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9._~+/-]{20,})\b/g;
var TOKEN_PATTERNS = [
  [/\bAKIA[0-9A-Z]{16}\b/g, "<API_KEY>"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<API_KEY>"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<TOKEN>"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "<TOKEN>"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<TOKEN>"]
];
var EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
var PHONE_REGEX = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
var SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
var CREDIT_CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;
function redactText(input) {
  let output = input.replace(AUTHORIZATION_HEADER_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(BARE_BEARER_TOKEN_REGEX, (_match, prefix) => `${prefix}<TOKEN>`).replace(QUOTED_KEY_SECRET_REGEX, (match, keyQuote, key, separator, valueQuote, _value) => isSensitiveKey(key) ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${placeholderForKey(key)}${valueQuote}` : match).replace(ASSIGNMENT_SECRET_REGEX, (match, key, separator, quote) => isSensitiveKey(key) ? `${key}${separator}${quote}${placeholderForKey(key)}${quote}` : match);
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(EMAIL_REGEX, "<EMAIL>").replace(PHONE_REGEX, "<PHONENUMBER>").replace(SSN_REGEX, "<SSN>").replace(CREDIT_CARD_CANDIDATE_REGEX, (candidate) => isLikelyCreditCard(candidate) ? "<CREDITCARD>" : candidate);
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
  const compactSensitive = new Set([
    "apikey",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "authtoken",
    "githubtoken",
    "bearertoken",
    "clientsecret",
    "secretkey",
    "privatekey",
    "password",
    "passwd",
    "pwd",
    "passphrase",
    "token",
    "secret"
  ]);
  if (compactSensitive.has(compact))
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

// src/cli.ts
var DEFAULT_PATH = "sidecar";
var DEFAULT_BRANCH = "main";
var DEFAULT_INBOX = "sidecar-inbox/{user}/{random}";
var PACKAGE_NAME = "@anteprojector/sidecar";
var GLOBAL_EXEC_ENV = "SIDECAR_GLOBAL_EXEC";
var STATE_DIR_ENV = "SIDECAR_STATE_DIR";
var SKIP_SERVICE_ENV = "SIDECAR_SKIP_SERVICE";
var DAEMON_LABEL = "com.anteprojector.sidecar";

class SidecarError extends Error {
  constructor(message) {
    super(message);
    this.name = "SidecarError";
  }
}
function main(argv = process.argv.slice(2)) {
  try {
    const status = run(argv);
    const command = argv[0];
    if (command && shouldUseGlobalRegistry()) {
      logSidecarEvent("command", { command, status });
    }
    return status;
  } catch (error) {
    const command = argv[0] || "unknown";
    if (shouldUseGlobalRegistry()) {
      logSidecarEvent("failure", {
        command,
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (error instanceof SidecarError) {
      console.error(`sidecar: ${error.message}`);
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
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return command ? 0 : 1;
  }
  switch (command) {
    case "init":
      return cmdInit(rest);
    case "clone":
      return cmdClone(rest);
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
    case "snapshot":
      return cmdSnapshot(rest);
    case "sync":
      return cmdSync(rest);
    case "merge":
      return cmdMerge(rest);
    default:
      throw new SidecarError(`unknown command ${JSON.stringify(command)}`);
  }
}
function printUsage() {
  console.error(`usage: sidecar <command> [options]

commands:
  init <remote> [--path sidecar] [--branch main] [--inbox template]
  clone
  status
  instances
  daemon status|enable|disable|restart|run [--once] [--interval seconds]
  tail [-f|--follow]
  snapshot [--push] [-m message]
  sync [--no-snapshot] [-m message]
  merge [--fork-files] [--no-push]`);
}
function cmdInit(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-clone", "--no-bootstrap-main"]),
    value: new Set(["--path", "--branch", "--inbox"])
  });
  const remote = parsed.positional[0];
  if (!remote || parsed.positional.length > 1) {
    throw new SidecarError("usage: sidecar init <remote> [--path sidecar] [--branch main] [--inbox template]");
  }
  const root = gitToplevel(process.cwd());
  const config = {
    remote,
    version: 1,
    path: getValue(parsed, "--path", DEFAULT_PATH),
    branch: getValue(parsed, "--branch", DEFAULT_BRANCH),
    inbox: getValue(parsed, "--inbox", DEFAULT_INBOX)
  };
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  writeConfig(path.join(root, ".sidecar"), config);
  const gitignoreEntry = gitignoreEntryForSidecarPath(root, config.path);
  if (gitignoreEntry) {
    ensureGitignoreEntry(path.join(root, ".gitignore"), gitignoreEntry);
  }
  console.log(`wrote ${path.join(root, ".sidecar")}`);
  if (gitignoreEntry) {
    console.log(`ignored ${gitignoreEntry.replace(/\/+$/, "")}/`);
  } else {
    console.log(`sidecar path outside repo; not updating ${path.join(root, ".gitignore")}`);
  }
  if (!parsed.flags.has("--no-clone")) {
    cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  }
  registerCurrentInstance(root, config, { event: "init" });
  return 0;
}
function cmdClone(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-bootstrap-main"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar clone [--no-bootstrap-main]");
  const [root, config] = loadProject();
  cloneOrUpdate(root, config, !parsed.flags.has("--no-bootstrap-main"));
  registerCurrentInstance(root, config, { event: "clone" });
  return 0;
}
function cmdStatus(args) {
  const parsed = parseOptions(args, { boolean: new Set, value: new Set });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar status");
  const [root, config] = loadProject();
  const sidecarPath = resolveSidecarPath(root, config);
  const checkoutPresent = hasGitMetadata(sidecarPath);
  const inbox = expandInbox(config, checkoutPresent ? sidecarPath : undefined);
  console.log(`main repo:    ${root}`);
  console.log(`sidecar path: ${sidecarPath}`);
  console.log(`remote:       ${config.remote}`);
  console.log(`main branch:  ${config.branch}`);
  console.log(`inbox branch: ${inbox}`);
  if (!checkoutPresent) {
    console.log("checkout:     missing");
    return 0;
  }
  const branch = git(sidecarPath, ["branch", "--show-current"]).stdout.trim();
  const dirty = Boolean(git(sidecarPath, ["status", "--porcelain"]).stdout.trim());
  console.log("checkout:     present");
  console.log(`branch:       ${branch || "(detached)"}`);
  console.log(`dirty:        ${dirty ? "yes" : "no"}`);
  fetch(sidecarPath, true, false);
  const base = remoteRefExists(sidecarPath, config.branch) ? `origin/${config.branch}` : branchExists(sidecarPath, config.branch) ? config.branch : "HEAD";
  const pending = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, base));
  if (pending.length) {
    console.log("pending inbox:");
    for (const branchName of pending)
      console.log(`  ${branchName}`);
  } else {
    console.log("pending inbox: none");
  }
  return 0;
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
  console.log(`registry: ${instancesPath()}`);
  console.log(`log:      ${sidecarLogPath()}`);
  if (!statuses.length) {
    console.log("instances: none");
    return 0;
  }
  for (const status of statuses) {
    console.log("");
    console.log(status.root);
    console.log(`  sidecar: ${status.sidecarPath}`);
    console.log(`  remote:  ${status.remote}`);
    console.log(`  branch:  ${status.currentBranch || "(unknown)"}`);
    console.log(`  config:  ${status.config}`);
    console.log(`  checkout:${status.checkout === "present" ? " present" : " missing"}`);
    console.log(`  dirty:   ${status.dirty}`);
    console.log(`  updated: ${status.updatedAt}`);
    if (status.lastSyncAt)
      console.log(`  synced:  ${status.lastSyncAt}`);
  }
  return 0;
}
function cmdTail(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["-f", "--follow"]),
    value: new Set
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar tail [-f|--follow]");
  const filePath = sidecarLogPath();
  if (!fs.existsSync(filePath)) {
    if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
      followLog(filePath, 0);
      return 0;
    }
    return 0;
  }
  const stat = fs.statSync(filePath);
  if (stat.size > 0) {
    process.stdout.write(fs.readFileSync(filePath, "utf8"));
  }
  if (parsed.flags.has("-f") || parsed.flags.has("--follow")) {
    followLog(filePath, stat.size);
  }
  return 0;
}
function cmdDaemon(args) {
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
  if (action === "run") {
    return cmdDaemonRun(rest);
  }
  if (!action || action.startsWith("-")) {
    return cmdDaemonRun(args);
  }
  throw new SidecarError("usage: sidecar daemon status|enable|disable|restart|run [--once] [--interval seconds]");
}
function cmdDaemonStatus() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  const settings = readSettings();
  const service = daemonServiceStatus();
  console.log(`daemon:   ${settings.daemonEnabled ? "enabled" : "disabled"}`);
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path)
    console.log(`agent:    ${service.path}`);
  if (service.message)
    console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  console.log(`log:      ${sidecarLogPath()}`);
  return 0;
}
function cmdDaemonEnable() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-enable", { service });
  console.log("daemon:   enabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path)
    console.log(`agent:    ${service.path}`);
  if (service.message)
    console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}
function cmdDaemonDisable() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: false });
  const service = stopDaemonService();
  logSidecarEvent("daemon-disable", { service });
  console.log("daemon:   disabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path)
    console.log(`agent:    ${service.path}`);
  if (service.message)
    console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}
function cmdDaemonRestart() {
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  writeSettings({ ...readSettings(), daemonEnabled: true });
  const service = installDaemonService();
  logSidecarEvent("daemon-restart", { service });
  console.log("daemon:   enabled");
  console.log(`service:  ${daemonServiceLabel(service)}`);
  if (service.path)
    console.log(`agent:    ${service.path}`);
  if (service.message)
    console.log(`detail:   ${service.message}`);
  console.log(`settings: ${settingsPath()}`);
  return 0;
}
function cmdDaemonRun(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--once"]),
    value: new Set(["--interval"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar daemon run [--once] [--interval seconds]");
  if (!shouldUseGlobalRegistry()) {
    throw new SidecarError("daemon is only available from a globally installed sidecar");
  }
  const intervalSeconds = Number(getValue(parsed, "--interval", "300"));
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new SidecarError("--interval must be > 0");
  }
  logSidecarEvent("daemon-start", { intervalSeconds, once: parsed.flags.has("--once") });
  console.log(`sidecar daemon polling every ${intervalSeconds}s`);
  while (true) {
    runDaemonCycle();
    if (parsed.flags.has("--once"))
      return 0;
    sleep(intervalSeconds * 1000);
  }
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
  const inbox = expandInbox(config, sidecarPath);
  ensureCommitIdentity(sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  const committed = snapshot(sidecarPath, root, inbox, getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined);
  if (committed && parsed.flags.has("--push")) {
    syncBranchBeforePush(sidecarPath, inbox);
    pushBranch(sidecarPath, inbox);
  }
  return 0;
}
function cmdSync(args) {
  const parsed = parseOptions(args, {
    boolean: new Set(["--no-snapshot"]),
    value: new Set(["-m", "--message"])
  });
  if (parsed.positional.length)
    throw new SidecarError("usage: sidecar sync [--no-snapshot] [-m message]");
  const [root, config] = loadProject();
  syncProject(root, config, {
    snapshot: !parsed.flags.has("--no-snapshot"),
    message: getValue(parsed, "--message", getValue(parsed, "-m", "")) || undefined
  });
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
    snapshot(sidecarPath, root, inbox, options.message);
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
  ensureMainBranch(sidecarPath, config);
  const inboxBranches = pendingInboxBranches(sidecarPath, config).filter((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, "HEAD"));
  if (!inboxBranches.length) {
    console.log("no inbox branches to merge");
    return 0;
  }
  const merged = [];
  for (const remoteBranch of inboxBranches) {
    console.log(`merging ${remoteBranch}`);
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
    pushBranch(sidecarPath, config.branch);
  }
  console.log(`merged ${merged.length} inbox branch(es)`);
  return merged.length;
}
function cloneOrUpdate(root, config, bootstrapMain) {
  const sidecarPath = resolveSidecarPath(root, config);
  if (fs.existsSync(sidecarPath) && !hasGitMetadata(sidecarPath)) {
    if (fs.readdirSync(sidecarPath).length) {
      throw new SidecarError(`${sidecarPath} exists and is not an empty Git repo`);
    }
    fs.rmdirSync(sidecarPath);
  }
  if (!fs.existsSync(sidecarPath)) {
    gitRaw(["clone", config.remote, sidecarPath]);
  } else if (hasGitMetadata(sidecarPath)) {
    const existing = git(sidecarPath, ["remote", "get-url", "origin"], { check: false });
    if (existing.status !== 0) {
      git(sidecarPath, ["remote", "add", "origin", config.remote]);
    } else if (existing.stdout.trim() !== config.remote) {
      throw new SidecarError(`sidecar origin is ${existing.stdout.trim()}; expected ${config.remote}`);
    }
    fetch(sidecarPath, true);
  } else {
    throw new SidecarError(`${sidecarPath} is not usable as a sidecar checkout`);
  }
  ensureCommitIdentity(sidecarPath);
  if (bootstrapMain)
    bootstrapMainBranch(sidecarPath, config);
  const inbox = expandInbox(config, sidecarPath);
  ensureInboxBranch(sidecarPath, config, inbox);
  console.log(`sidecar checkout ready at ${sidecarPath}`);
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
  fs.writeFileSync(path.join(repo, "README.md"), `# Sidecar

Canonical sidecar state for this repository.
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
  if (remoteRefExists(repo, config.branch)) {
    git(repo, ["merge", "--ff-only", `origin/${config.branch}`]);
  }
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
function snapshot(repo, mainRoot, inbox, message = "sidecar snapshot") {
  scrubSidecarTree(repo);
  git(repo, ["add", "-A"]);
  if (git(repo, ["diff", "--cached", "--quiet"], { check: false }).status === 0) {
    console.log("no sidecar changes to snapshot");
    return false;
  }
  const mainHead = git(mainRoot, ["rev-parse", "--short", "HEAD"], { check: false });
  const mainHeadText = mainHead.status === 0 ? mainHead.stdout.trim() : "unborn";
  const source = `${currentUser()}@${currentHost()}`;
  const body = [
    message,
    "",
    `source: ${source}`,
    `main-head: ${mainHeadText}`,
    `inbox: ${inbox}`
  ];
  git(repo, ["commit", "-m", body.join(`
`)]);
  console.log(`committed sidecar snapshot to ${inbox}`);
  return true;
}
function scrubSidecarTree(root) {
  let changed = 0;
  for (const filePath of walkFiles(root)) {
    const relative = path.relative(root, filePath).split(path.sep);
    if (relative.includes(".git"))
      continue;
    let data;
    try {
      data = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (data.includes(0))
      continue;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      continue;
    }
    const redacted = redactText(text);
    if (redacted !== text) {
      fs.writeFileSync(filePath, redacted, "utf8");
      changed += 1;
    }
  }
  if (changed) {
    console.log(`redacted sensitive text in ${changed} sidecar file(s)`);
  }
  return changed;
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
  console.log(`pushed ${branch}`);
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
      const fullOut = path.join(repo, outPath);
      fs.mkdirSync(path.dirname(fullOut), { recursive: true });
      fs.writeFileSync(fullOut, blob);
      versions.push({
        stage,
        label,
        oid,
        path: outPath,
        sha256: crypto.createHash("sha256").update(blob).digest("hex")
      });
    }
    git(repo, ["rm", "-f", "--ignore-unmatch", "--", conflictPath], { check: false });
    const original = path.join(repo, conflictPath);
    if (fs.existsSync(original) && fs.statSync(original).isFile())
      fs.unlinkSync(original);
    manifest.paths.push({ path: conflictPath, versions });
  }
  const manifestDir = path.join(repo, ".sidecar-conflicts");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${timestamp}-${manifestLabel}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  git(repo, ["add", "-A"]);
  if (hasUnmergedPaths(repo)) {
    throw new SidecarError("fork-files did not clear all unmerged paths");
  }
}
function forkPath(conflictPath, label, oid) {
  const parsed = path.parse(conflictPath);
  const shortOid = oid ? oid.slice(0, 7) : "missing";
  const safeLabel = fileLabel(label);
  const forkName = parsed.ext ? `${parsed.name}.conflict.${safeLabel}.${shortOid}${parsed.ext}` : `${parsed.name}.conflict.${safeLabel}.${shortOid}`;
  return path.join(parsed.dir, forkName);
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
  const idPath = path.join(gitDirectory, "sidecar-id");
  if (fs.existsSync(idPath)) {
    const existing = slug(fs.readFileSync(idPath, "utf8"));
    if (existing)
      return existing;
  }
  const id = crypto.randomBytes(6).toString("hex");
  fs.writeFileSync(idPath, `${id}
`, { encoding: "utf8", mode: 384 });
  return id;
}
function validateBranch(branch) {
  const result = gitRaw(["check-ref-format", "--branch", branch], { check: false });
  if (result.status !== 0)
    throw new SidecarError(`invalid branch name ${JSON.stringify(branch)}`);
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
    return path.resolve(process.env[STATE_DIR_ENV]);
  if (process.platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support", "sidecar");
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "sidecar");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "sidecar");
}
function instancesPath() {
  return path.join(sidecarStateDir(), "instances.json");
}
function sidecarLogPath() {
  return path.join(sidecarStateDir(), "sidecar.log");
}
function settingsPath() {
  return path.join(sidecarStateDir(), "settings.json");
}
function daemonLaunchAgentPath() {
  if (process.platform !== "darwin")
    return;
  return path.join(os.homedir(), "Library", "LaunchAgents", `${DAEMON_LABEL}.plist`);
}
function readSettings() {
  const filePath = settingsPath();
  if (!fs.existsSync(filePath))
    return { daemonEnabled: true };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object")
      return { daemonEnabled: true };
    const record = raw;
    return {
      daemonEnabled: typeof record.daemonEnabled === "boolean" ? record.daemonEnabled : true
    };
  } catch (error) {
    logSidecarEvent("failure", {
      command: "daemon",
      message: `could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    });
    return { daemonEnabled: true };
  }
}
function writeSettings(settings) {
  ensureStateDir();
  fs.writeFileSync(settingsPath(), `${JSON.stringify({ daemonEnabled: settings.daemonEnabled }, null, 2)}
`, "utf8");
}
function readInstances() {
  const filePath = instancesPath();
  if (!fs.existsSync(filePath))
    return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  fs.writeFileSync(instancesPath(), `${JSON.stringify(instances, null, 2)}
`, "utf8");
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
    configPath: path.join(root, ".sidecar"),
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
function runDaemonCycle() {
  const settings = readSettings();
  if (!settings.daemonEnabled) {
    logSidecarEvent("daemon-skip", { reason: "daemon-disabled" });
    return 0;
  }
  let synced = 0;
  let cloned = 0;
  for (const instance of readInstances()) {
    const status = instanceStatus(instance);
    if (status.config !== "ok") {
      logSidecarEvent("daemon-skip", {
        root: instance.root,
        reason: `config-${status.config}`
      });
      continue;
    }
    let config;
    try {
      config = readConfig(instance.configPath);
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (status.checkout !== "present") {
      try {
        logSidecarEvent("daemon-clone-start", { root: instance.root, sidecarPath: instance.sidecarPath });
        cloneOrUpdate(instance.root, config, true);
        registerCurrentInstance(instance.root, config, { event: "daemon-clone" });
        cloned += 1;
      } catch (error) {
        logSidecarEvent("failure", {
          command: "daemon",
          root: instance.root,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }
    let remoteChanged = false;
    try {
      remoteChanged = hasRemoteReconcileWork(instance.sidecarPath, config);
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (status.dirty !== "yes" && !remoteChanged)
      continue;
    try {
      logSidecarEvent("daemon-sync-start", {
        root: instance.root,
        sidecarPath: instance.sidecarPath,
        dirty: status.dirty === "yes",
        remoteChanged
      });
      syncProject(instance.root, config, { snapshot: true, message: "sidecar auto sync" });
      registerCurrentInstance(instance.root, config, { event: "daemon-sync", lastSyncAt: nowIso() });
      synced += 1;
    } catch (error) {
      logSidecarEvent("failure", {
        command: "daemon",
        root: instance.root,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  logSidecarEvent("daemon-cycle", { synced, cloned });
  return synced;
}
function hasRemoteReconcileWork(sidecarPath, config) {
  fetch(sidecarPath, true);
  const inbox = expandInbox(config, sidecarPath);
  if (remoteRefExists(sidecarPath, inbox)) {
    if (!branchExists(sidecarPath, inbox))
      return true;
    if (!isAncestor(sidecarPath, `origin/${inbox}`, inbox))
      return true;
  }
  if (remoteRefExists(sidecarPath, config.branch)) {
    if (!branchExists(sidecarPath, config.branch))
      return true;
    if (!isAncestor(sidecarPath, `origin/${config.branch}`, config.branch))
      return true;
  }
  const mergeBase = branchExists(sidecarPath, config.branch) ? config.branch : remoteRefExists(sidecarPath, config.branch) ? `origin/${config.branch}` : "HEAD";
  return pendingInboxBranches(sidecarPath, config).some((remoteBranch) => !isAncestor(sidecarPath, remoteBranch, mergeBase));
}
function daemonServiceStatus() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (!fs.existsSync(plistPath)) {
    return { available: true, installed: false, running: false, path: plistPath };
  }
  const result = spawnSync("launchctl", ["print", `${launchctlDomain()}/${DAEMON_LABEL}`], {
    encoding: "utf8"
  });
  const running = result.status === 0 && /\bstate = running\b/.test(result.stdout);
  return {
    available: true,
    installed: true,
    running,
    path: plistPath,
    message: running || result.status === 0 ? undefined : launchctlMessage(result)
  };
}
function installDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return { available: false, installed: false, running: false, path: plistPath, message: "root install skipped" };
  }
  const stateDir = sidecarStateDir();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const invocation = currentExecutableInvocation();
  fs.writeFileSync(plistPath, daemonPlist(invocation), "utf8");
  const domain = launchctlDomain();
  spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
  const bootstrap = spawnSync("launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
  if (bootstrap.status !== 0) {
    return {
      available: true,
      installed: true,
      running: false,
      path: plistPath,
      message: bootstrap.stderr.trim() || bootstrap.stdout.trim() || "launchctl bootstrap failed"
    };
  }
  spawnSync("launchctl", ["enable", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
  spawnSync("launchctl", ["kickstart", "-k", `${domain}/${DAEMON_LABEL}`], { stdio: "ignore" });
  return daemonServiceStatus();
}
function stopDaemonService() {
  if (process.env[SKIP_SERVICE_ENV] === "1") {
    return { available: false, installed: false, running: false, message: "skipped" };
  }
  const plistPath = daemonLaunchAgentPath();
  if (!plistPath)
    return { available: false, installed: false, running: false, message: "unsupported platform" };
  spawnSync("launchctl", ["bootout", launchctlDomain(), plistPath], { stdio: "ignore" });
  return { available: true, installed: fs.existsSync(plistPath), running: false, path: plistPath };
}
function daemonServiceLabel(service) {
  if (!service.available)
    return "unavailable";
  if (!service.installed)
    return "uninstalled";
  return service.running ? "running" : "stopped";
}
function launchctlMessage(result) {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stderr || stdout || undefined;
}
function launchctlDomain() {
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  return `gui/${uid}`;
}
function currentExecutableInvocation() {
  let executable = process.argv[1] || fileURLToPath(import.meta.url);
  try {
    executable = fs.realpathSync(executable);
  } catch {
    executable = path.resolve(executable);
  }
  return [process.execPath, executable, "daemon", "run"];
}
function currentExecutableStamp(programArguments) {
  const executable = programArguments[1];
  if (!executable)
    return "unknown";
  try {
    const stat = fs.statSync(executable);
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
    StandardOutPath: path.join(sidecarStateDir(), "daemon.out.log"),
    StandardErrorPath: path.join(sidecarStateDir(), "daemon.err.log"),
    EnvironmentVariables: {
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      SIDECAR_DAEMON_EXECUTABLE: currentExecutableStamp(programArguments)
    }
  });
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
function logSidecarEvent(event, fields = {}) {
  try {
    ensureStateDir();
    const record = {
      timestamp: nowIso(),
      event,
      ...fields
    };
    fs.appendFileSync(sidecarLogPath(), `${JSON.stringify(record)}
`, "utf8");
  } catch {}
}
function followLog(filePath, startOffset) {
  let offset = startOffset;
  while (true) {
    sleep(1000);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      offset = 0;
      continue;
    }
    if (stat.size < offset)
      offset = 0;
    if (stat.size <= offset)
      continue;
    const fd = fs.openSync(filePath, "r");
    try {
      const length = stat.size - offset;
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
      if (bytesRead > 0) {
        process.stdout.write(buffer.subarray(0, bytesRead).toString("utf8"));
        offset += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}
function ensureStateDir() {
  fs.mkdirSync(sidecarStateDir(), { recursive: true });
}
function isSidecarInstance(value) {
  if (!value || typeof value !== "object")
    return false;
  const record = value;
  return typeof record.root === "string" && typeof record.configPath === "string" && typeof record.sidecarPath === "string" && typeof record.remote === "string" && typeof record.branch === "string" && typeof record.inbox === "string" && typeof record.registeredAt === "string" && typeof record.updatedAt === "string";
}
function instanceStatus(instance) {
  let config = "ok";
  if (!fs.existsSync(instance.configPath)) {
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
  return process.env[GLOBAL_EXEC_ENV] === "1" || !findDependencyRoot(process.cwd());
}
function findDependencyRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (projectDependsOnSidecar(current))
      return current;
    const parent = path.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function projectDependsOnSidecar(projectRoot) {
  const manifestPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME] || manifest.devDependencies?.[PACKAGE_NAME] || manifest.optionalDependencies?.[PACKAGE_NAME] || manifest.peerDependencies?.[PACKAGE_NAME]);
  } catch {
    return false;
  }
}
function loadProject() {
  const root = findConfigRoot(process.cwd());
  return [root, readConfig(path.join(root, ".sidecar"))];
}
function findConfigRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".sidecar")))
      return current;
    const parent = path.dirname(current);
    if (parent === current)
      throw new SidecarError("could not find .sidecar");
    current = parent;
  }
}
function gitToplevel(cwd) {
  const result = gitRaw(["-C", cwd, "rev-parse", "--show-toplevel"], { check: false });
  if (result.status !== 0)
    throw new SidecarError("not inside a Git repository");
  return result.stdout.trim();
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
    ""
  ].join(`
`);
  fs.writeFileSync(configPath, text, "utf8");
}
function readConfig(configPath) {
  let values;
  try {
    const parsed = parse(fs.readFileSync(configPath, "utf8"));
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
    inbox: stringConfigValue(configPath, values, "inbox", DEFAULT_INBOX)
  };
  validateBranch(config.branch);
  validateInboxTemplate(config.inbox);
  return config;
}
function ensureGitignoreEntry(gitignorePath, sidecarPath) {
  const stripped = sidecarPath.replace(/^\/+|\/+$/g, "");
  const entry = `/${stripped}/`;
  const lines = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry)) {
    lines.push(entry);
    fs.writeFileSync(gitignorePath, `${lines.join(`
`).replace(/\s+$/g, "")}
`, "utf8");
  }
}
function gitignoreEntryForSidecarPath(root, sidecarPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedSidecarPath = path.resolve(root, sidecarPath);
  const relative = path.relative(resolvedRoot, resolvedSidecarPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
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
    maxBuffer: 100 * 1024 * 1024
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
    maxBuffer: 100 * 1024 * 1024
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
  return path.resolve(root, config.path);
}
function hasGitMetadata(repo) {
  return fs.existsSync(path.join(repo, ".git"));
}
function isDirty(repo) {
  return Boolean(git(repo, ["status", "--porcelain"]).stdout.trim());
}
function gitDir(repo) {
  const result = git(repo, ["rev-parse", "--git-dir"]).stdout.trim();
  return path.isAbsolute(result) ? result : path.resolve(repo, result);
}
function* walkEntries(root) {
  if (!fs.existsSync(root))
    return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    yield entryPath;
    if (entry.isDirectory() && !entry.isSymbolicLink())
      yield* walkEntries(entryPath);
  }
}
function* walkFiles(root) {
  for (const entryPath of walkEntries(root)) {
    try {
      const stat = fs.lstatSync(entryPath);
      if (!stat.isSymbolicLink() && stat.isFile())
        yield entryPath;
    } catch {
      continue;
    }
  }
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

// src/bin.ts
var SKIP_LOCAL_EXEC_ENV = "SIDECAR_SKIP_LOCAL_EXEC";
var GLOBAL_EXEC_ENV2 = "SIDECAR_GLOBAL_EXEC";
var PACKAGE_NAME2 = "@anteprojector/sidecar";
if (!process.env[SKIP_LOCAL_EXEC_ENV]) {
  const localExecutable = findLocalExecutable(process.cwd(), fileURLToPath2(import.meta.url));
  if (localExecutable) {
    const result = spawnSync2(process.execPath, [localExecutable, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: {
        ...process.env,
        [SKIP_LOCAL_EXEC_ENV]: "1",
        [GLOBAL_EXEC_ENV2]: "1"
      }
    });
    if (result.signal) {
      process.kill(process.pid, result.signal);
    }
    process.exit(result.status ?? 1);
  }
}
process.exit(main());
function findLocalExecutable(start, self) {
  let current = path2.resolve(start);
  while (true) {
    if (projectDependsOnSidecar2(current)) {
      const candidate = path2.join(current, "node_modules", "@anteprojector", "sidecar", "dist", "cli.js");
      if (isFile(candidate) && !sameFile(candidate, self)) {
        return candidate;
      }
    }
    const parent = path2.dirname(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function projectDependsOnSidecar2(projectRoot) {
  const manifestPath = path2.join(projectRoot, "package.json");
  if (!isFile(manifestPath))
    return false;
  try {
    const manifest = JSON.parse(fs2.readFileSync(manifestPath, "utf8"));
    return Boolean(manifest.dependencies?.[PACKAGE_NAME2] || manifest.devDependencies?.[PACKAGE_NAME2] || manifest.optionalDependencies?.[PACKAGE_NAME2] || manifest.peerDependencies?.[PACKAGE_NAME2]);
  } catch {
    return false;
  }
}
function isFile(filePath) {
  try {
    return fs2.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function sameFile(first, second) {
  try {
    return fs2.realpathSync(first) === fs2.realpathSync(second);
  } catch {
    return false;
  }
}
