export function repairJSON(str: string): unknown {
  let s = str.trim();
  s = s.replace(/,\s*([}\]])/g, '$1');

  try { return JSON.parse(s); } catch { /* continue */ }

  const opens: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') opens.push(c);
    if (c === '}' || c === ']') opens.pop();
  }

  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  s = s.replace(/,\s*$/, '');

  while (opens.length > 0) {
    const o = opens.pop();
    s += o === '{' ? '}' : ']';
  }

  s = s.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(s);
}
