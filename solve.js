// solve.js — an exact, fast re-implementation of csv-reader 1.0.0's reading,
// written from the competition spec. Dependency-free ES module.
//
// The text is read once, left to right, with commas and double quotes.
// A U+FEFF at its very start is dropped. A record ends at LF or CRLF, and a
// line left with no characters is no record. Outside quotes a CR not followed
// by LF is dropped (error stray_cr). A field that opens with a quote runs to
// the next quote that is not doubled; "" inside it is one quote; each CRLF or
// lone CR inside it is read as LF; what follows its closing quote, up to the
// next comma or line break, is appended as it stands (error quote_junk, when
// the field ends); a quote that never closes is a literal character, and the
// text after it is read again as unquoted (error unterminated_quote). A quote
// inside an unquoted field is a literal character. Fields stay strings, never
// trimmed or converted. columns is the first record when header is true, else
// null; rows holds the records after it, each padded with empty strings
// (error short_row, with fields: its field count) or cut (error long_row,
// with extra: the cut fields) to the first record's width. Each error is
// {code, line, row}, in the order met, a record's short_row or long_row when
// it ends: line is the 1-based line its record starts on, counting every LF,
// CRLF and lone CR inside quotes, and row is its record's index in rows,
// null for the header.
//
// Speed: a single-pass scanner. Delimiters are found with index searches,
// fields are sliced instead of built per character, errors live in a flat
// array, and no regular expression runs in the hot path.

export function run(input) {
  const text = input.text;
  const header = input.header === true;
  const n = text.length;
  let i = 0;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) i = 1;

  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let line = 1;
  let recordIndex = 0;

  // Parse an unquoted field starting at `start`, with `prefix` already in
  // the value ('' normally, '"' when re-reading after an unterminated
  // quote). Returns [value, term, pos]: term is 'comma' | 'lf' | 'crlf' |
  // 'eof' and pos is the terminator's position (the CR of a CRLF, n for
  // eof). A lone CR inside the field is dropped with a stray_cr error and
  // the field continues past it. Only two searches run over the text (the
  // next comma and the next LF); a CR is found by checking the short field
  // slice, and a CRLF by the character before the LF.
  function parseUnquoted(start, prefix, recLine, recRow) {
    const jComma = text.indexOf(',', start);
    const jLF = text.indexOf('\n', start);
    let end;
    let term;
    if (jComma !== -1 && (jLF === -1 || jComma < jLF)) {
      end = jComma;
      term = 'comma';
    } else if (jLF !== -1) {
      end = jLF;
      term = 'lf';
    } else {
      end = n;
      term = 'eof';
    }
    let value = prefix + text.slice(start, end);
    if (term === 'lf' && end > start && text.charCodeAt(end - 1) === 13) {
      value = prefix + text.slice(start, end - 1);
      term = 'crlf';
    }
    if (value.indexOf('\r') !== -1) {
      let clean = '';
      let from = 0;
      let count = 0;
      for (;;) {
        const k = value.indexOf('\r', from);
        if (k === -1) break;
        clean += value.slice(from, k);
        count++;
        from = k + 1;
      }
      clean += value.slice(from);
      for (let t = 0; t < count; t++) {
        errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      }
      value = clean;
    }
    return [value, term, term === 'crlf' ? end - 1 : end];
  }

  // Parse a quoted field starting at `start` (text[start] === '"').
  // Returns [value, term, pos, lineDelta]: lineDelta counts the line breaks
  // inside the quoted field, each CRLF or lone CR or LF read as one LF.
  function parseQuoted(start, recLine, recRow) {
    let j = start + 1;
    let closeQuote = -1;
    let hasDoubled = false;
    for (;;) {
      const q = text.indexOf('"', j);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        hasDoubled = true;
        j = q + 2;
        continue;
      }
      closeQuote = q;
      break;
    }
    if (closeQuote === -1) {
      errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
      const out = parseUnquoted(start + 1, '"', recLine, recRow);
      return [out[0], out[1], out[2], 0];
    }
    const cs = start + 1;
    const ce = closeQuote;
    let value;
    let lineDelta = 0;
    const lfAt = text.indexOf('\n', cs);
    const hasLF = lfAt !== -1 && lfAt < ce;
    const crAt = text.indexOf('\r', cs);
    const hasCR = crAt !== -1 && crAt < ce;
    if (!hasDoubled && !hasLF && !hasCR) {
      value = text.slice(cs, ce);
    } else {
      const parts = [];
      let seg = cs;
      let k = cs;
      while (k < ce) {
        const ch = text.charCodeAt(k);
        if (ch === 34) {
          parts.push(text.slice(seg, k), '"');
          k += 2;
          seg = k;
        } else if (ch === 13) {
          parts.push(text.slice(seg, k), '\n');
          lineDelta++;
          k = text.charCodeAt(k + 1) === 10 ? k + 2 : k + 1;
          seg = k;
        } else if (ch === 10) {
          parts.push(text.slice(seg, k), '\n');
          lineDelta++;
          k += 1;
          seg = k;
        } else {
          k++;
        }
      }
      parts.push(text.slice(seg, ce));
      value = parts.join('');
    }
    const junk = parseUnquoted(closeQuote + 1, '', recLine, recRow);
    if (junk[0] !== '') {
      value += junk[0];
      errors.push({ code: 'quote_junk', line: recLine, row: recRow });
    }
    return [value, junk[1], junk[2], lineDelta];
  }

  while (i < n) {
    const c0 = text.charCodeAt(i);
    if (c0 === 10) {
      i++;
      line++;
      continue;
    }
    if (c0 === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        i += 2;
        line++;
        continue;
      }
      errors.push({ code: 'stray_cr', line, row: rows.length });
      i++;
      continue;
    }
    const recLine = line;
    const recRow = header ? (recordIndex === 0 ? null : recordIndex - 1) : recordIndex;
    const fields = [];
    let ended = false;
    while (!ended) {
      for (;;) {
        if (i >= n) break;
        if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) {
          errors.push({ code: 'stray_cr', line: recLine, row: recRow });
          i++;
          continue;
        }
        break;
      }
      let value;
      let term;
      let pos;
      let lineDelta = 0;
      if (i >= n) {
        value = '';
        term = 'eof';
        pos = n;
      } else {
        const cc = text.charCodeAt(i);
        if (cc === 10) {
          value = '';
          term = 'lf';
          pos = i;
        } else if (cc === 13) {
          value = '';
          term = 'crlf';
          pos = i;
        } else if (cc === 44) {
          value = '';
          term = 'comma';
          pos = i;
        } else if (cc === 34) {
          const out = parseQuoted(i, recLine, recRow);
          value = out[0];
          term = out[1];
          pos = out[2];
          lineDelta = out[3];
        } else {
          const out = parseUnquoted(i, '', recLine, recRow);
          value = out[0];
          term = out[1];
          pos = out[2];
        }
      }
      fields.push(value);
      line += lineDelta;
      if (term === 'comma') {
        i = pos + 1;
      } else if (term === 'lf') {
        i = pos + 1;
        line++;
        ended = true;
      } else if (term === 'crlf') {
        i = pos + 2;
        line++;
        ended = true;
      } else {
        i = n;
        ended = true;
      }
    }
    if (width < 0) {
      width = fields.length;
      if (header) columns = fields;
      else rows.push(fields);
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
      rows.push(fields);
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.slice(width) });
      fields.length = width;
      rows.push(fields);
    } else {
      rows.push(fields);
    }
    recordIndex++;
  }

  return { columns, rows, errors };
}
