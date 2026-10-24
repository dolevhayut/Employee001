// The query languages the emulated tools accept: Gmail search, Slack search,
// Microsoft Graph $filter, JQL, Drive `q` and SharePoint KQL. Each covers the
// subset twins actually write; anything else throws UnsupportedQuery so a
// test sees "the emulator can't answer this" instead of a silently wrong list.

export class UnsupportedQuery extends Error {}

const lower = (s: string) => s.toLowerCase();
const unquote = (s: string) => s.replace(/^["']|["']$/g, "");
const has = (hay: string, needle: string) => lower(hay).includes(lower(needle));

/** Split on a keyword at the top level (outside quotes and parentheses). */
function splitTop(input: string, word: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const re = new RegExp(`^\\s+${word}\\s+`, "i");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const m = re.exec(input.slice(i));
      if (m) { parts.push(input.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(input.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const wrapped = (s: string) => {
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")") depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return true;
};

/** Boolean expression with or < and < not < parentheses; clauses parsed by `leaf`. */
function boolExpr<T>(input: string, leaf: (clause: string) => (x: T) => boolean): (x: T) => boolean {
  const s = input.trim();
  if (!s) return () => true;
  const ors = splitTop(s, "or");
  if (ors.length > 1) { const fs = ors.map((p) => boolExpr(p, leaf)); return (x) => fs.some((f) => f(x)); }
  const ands = splitTop(s, "and");
  if (ands.length > 1) { const fs = ands.map((p) => boolExpr(p, leaf)); return (x) => fs.every((f) => f(x)); }
  if (wrapped(s)) return boolExpr(s.slice(1, -1), leaf);
  const not = /^not\s+(.+)$/i.exec(s);
  if (not) { const f = boolExpr(not[1], leaf); return (x) => !f(x); }
  return leaf(s);
}

function compare(a: number | string | boolean, op: string, b: number | string | boolean): boolean {
  switch (op) {
    case "=": case "eq": case "==": return a === b;
    case "!=": case "ne": return a !== b;
    case ">": case "gt": return a > b;
    case ">=": case "ge": return a >= b;
    case "<": case "lt": return a < b;
    case "<=": case "le": return a <= b;
    default: throw new UnsupportedQuery(`operator ${op}`);
  }
}

// ─── Gmail search ────────────────────────────────────────────────────────────

export type GmailSearchable = { from: string; to: string; cc: string; subject: string; body: string; labels: string[]; at: number };

function gmailDate(v: string): number {
  if (/^\d{9,}$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v.replace(/\//g, "-"));
  if (Number.isNaN(t)) throw new UnsupportedQuery(`Gmail date ${v}`);
  return t;
}

function gmailAge(v: string): number {
  const m = /^(\d+)([dmyh])$/i.exec(v);
  if (!m) throw new UnsupportedQuery(`Gmail age ${v}`);
  return Number(m[1]) * { h: 3600e3, d: 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 }[lower(m[2]) as "h" | "d" | "m" | "y"];
}

function gmailTerm(token: string, now: number): (m: GmailSearchable) => boolean {
  const neg = token.startsWith("-");
  const t = neg ? token.slice(1) : token;
  const op = /^([a-z_]+):(.*)$/i.exec(t);
  let f: (m: GmailSearchable) => boolean;
  if (op) {
    const value = unquote(op[2]);
    const key = lower(op[1]);
    const label = (l: string) => (m: GmailSearchable) => m.labels.includes(l);
    switch (key) {
      case "from": f = (m) => has(m.from, value); break;
      case "to": f = (m) => has(m.to, value) || has(m.cc, value); break;
      case "cc": f = (m) => has(m.cc, value); break;
      case "subject": f = (m) => has(m.subject, value); break;
      case "in": f = lower(value) === "anywhere" ? () => true : label(lower(value) === "sent" ? "SENT" : value.toUpperCase()); break;
      case "label": f = label(value.toUpperCase()); break;
      case "category": f = label(`CATEGORY_${value.toUpperCase()}`); break;
      case "is": f = lower(value) === "unread" ? label("UNREAD") : lower(value) === "read" ? (m) => !m.labels.includes("UNREAD") : label(value.toUpperCase()); break;
      case "after": { const d = gmailDate(value); f = (m) => m.at >= d; break; }
      case "before": { const d = gmailDate(value); f = (m) => m.at < d; break; }
      case "newer_than": { const d = now - gmailAge(value); f = (m) => m.at >= d; break; }
      case "older_than": { const d = now - gmailAge(value); f = (m) => m.at < d; break; }
      case "has": f = () => false; break; // no attachments in the emulated mailbox
      default: f = (m) => has(`${m.subject} ${m.body}`, t); // Gmail treats unknown operators as text
    }
  } else {
    const word = unquote(t);
    f = (m) => has(`${m.from} ${m.to} ${m.subject} ${m.body}`, word);
  }
  return neg ? (m) => !f(m) : f;
}

/** Gmail search: space = AND, OR between terms, -term, quotes, (groups), {any-of}. */
export function gmailQuery(query: string | undefined, now = Date.now()): (m: GmailSearchable) => boolean {
  const q = (query ?? "").trim();
  if (!q) return () => true;
  const tokens = q.match(/-?[a-z_]+:"[^"]*"|-?"[^"]*"|[(){}]|-?[^\s(){}]+/gi) ?? [];
  let i = 0;
  // `a b OR c` binds OR tighter than the implicit AND, like Gmail: a AND (b OR c).
  const seq = (close?: string): ((m: GmailSearchable) => boolean) => {
    const clauses: ((m: GmailSearchable) => boolean)[][] = [];
    let joinNext = false;
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (tok === close) break;
      if (tok === "OR") { joinNext = true; continue; }
      if (tok === "AND") continue;
      const f = tok === "(" ? seq(")") : tok === "{" ? seqAny() : gmailTerm(tok, now);
      if (joinNext && clauses.length) clauses.at(-1)!.push(f);
      else clauses.push([f]);
      joinNext = false;
    }
    return (m) => clauses.every((c) => c.some((f) => f(m)));
  };
  const seqAny = (): ((m: GmailSearchable) => boolean) => {
    const fs: ((m: GmailSearchable) => boolean)[] = [];
    while (i < tokens.length) {
      const tok = tokens[i++];
      if (tok === "}") break;
      fs.push(gmailTerm(tok, now));
    }
    return (m) => fs.some((f) => f(m));
  };
  return seq();
}

// ─── Slack search ────────────────────────────────────────────────────────────

export type SlackSearchable = { text: string; user: string; userName: string; channelId: string; channelName: string; at: number };

export function slackQuery(query: string): (m: SlackSearchable) => boolean {
  const tokens = query.match(/-?[a-z]+:"[^"]*"|"[^"]*"|<[^>]+>|\S+/gi) ?? [];
  const fs = tokens.map((token): ((m: SlackSearchable) => boolean) => {
    const op = /^([a-z]+):(.+)$/i.exec(token);
    if (/^<@([A-Z0-9]+)(\|[^>]*)?>$/i.test(token)) { const id = token.slice(2).split(/[|>]/)[0]; return (m) => m.text.includes(`<@${id}`); }
    if (!op) { const w = unquote(token); return (m) => has(m.text, w); }
    const value = unquote(op[2]);
    const id = /^<[@#]([A-Z0-9]+)/i.exec(value)?.[1];
    const plain = value.replace(/^[@#]/, "");
    const day = (v: string) => { const t = Date.parse(v); if (Number.isNaN(t)) throw new UnsupportedQuery(`Slack date ${v}`); return t; };
    switch (lower(op[1])) {
      case "in": return (m) => (id ? m.channelId === id : lower(m.channelName) === lower(plain));
      case "from": return (m) => (id ? m.user === id : has(m.userName, plain.replace(/[._]/g, " ")) || m.user === plain);
      case "after": { const t = day(value) + 86400e3; return (m) => m.at >= t; }
      case "before": { const t = day(value); return (m) => m.at < t; }
      case "on": case "during": {
        const start = day(value);
        const end = /^\d{4}-\d{2}$/.test(value) ? Date.parse(`${value}-01T00:00:00Z`) + 31 * 86400e3 : start + 86400e3;
        return (m) => m.at >= start && m.at < end;
      }
      case "has": case "is": return () => false;
      default: return (m) => has(m.text, token);
    }
  });
  return (m) => fs.every((f) => f(m));
}

// ─── Microsoft Graph $filter ─────────────────────────────────────────────────

const path = (obj: unknown, p: string): unknown => p.split("/").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

function odataValue(raw: string): string | number | boolean {
  const v = raw.trim();
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (v === "true" || v === "false") return v === "true";
  if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v)) return Date.parse(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  throw new UnsupportedQuery(`$filter value ${v}`);
}

export function odataFilter(filter: string | undefined): (o: Record<string, unknown>) => boolean {
  if (!filter?.trim()) return () => true;
  return boolExpr<Record<string, unknown>>(filter, (clause) => {
    const fn = /^(contains|startswith|endswith)\(\s*([\w/]+)\s*,\s*'((?:[^']|'')*)'\s*\)$/i.exec(clause);
    if (fn) {
      const [, name, field, value] = fn;
      const needle = lower(value.replace(/''/g, "'"));
      return (o) => {
        const v = lower(String(path(o, field) ?? ""));
        return lower(name) === "contains" ? v.includes(needle) : lower(name) === "startswith" ? v.startsWith(needle) : v.endsWith(needle);
      };
    }
    const cmp = /^([\w/]+)\s+(eq|ne|ge|gt|le|lt)\s+(.+)$/i.exec(clause);
    if (!cmp) throw new UnsupportedQuery(`$filter clause "${clause}"`);
    const [, field, op, raw] = cmp;
    const value = odataValue(raw);
    return (o) => {
      let v = path(o, field) as string | number | boolean | undefined;
      if (v === undefined || v === null) return op === "ne";
      if (typeof value === "number" && typeof v === "string" && /^\d{4}-/.test(v)) v = Date.parse(v);
      if (typeof value === "string" && typeof v === "string") return compare(lower(v), lower(op), lower(value));
      return compare(v, lower(op), value);
    };
  });
}

// ─── JQL ─────────────────────────────────────────────────────────────────────

export type JqlIssue = {
  key: string; projectKey: string; projectName: string; summary: string; description: string; status: string;
  statusCategory: string; priority: string; labels: string[]; type: string; created: number; updated: number;
  assignee?: { accountId: string; email: string; name: string };
};
export type JqlOrder = { field: string; dir: "asc" | "desc" }[];

function jqlDate(raw: string, now: number): number {
  const v = unquote(raw.trim());
  const rel = /^([-+]?)(\d+)([mhdw])$/i.exec(v);
  if (rel) return now + (rel[1] === "-" ? -1 : 1) * Number(rel[2]) * { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[lower(rel[3]) as "m" | "h" | "d" | "w"];
  const fn = /^(startOfDay|startOfWeek|startOfMonth|endOfDay|now)\(\s*([-+]?\d+[dwm]?)?\s*\)$/i.exec(v);
  if (fn) {
    const d = new Date(now);
    if (/^start/i.test(fn[1])) d.setUTCHours(0, 0, 0, 0);
    if (/week/i.test(fn[1])) d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    if (/month/i.test(fn[1])) d.setUTCDate(1);
    if (/^end/i.test(fn[1])) d.setUTCHours(23, 59, 59, 999);
    return fn[2] ? jqlDate(fn[2], d.getTime()) : d.getTime();
  }
  const t = Date.parse(v.replace(/\//g, "-").replace(" ", "T"));
  if (Number.isNaN(t)) throw new UnsupportedQuery(`JQL date ${v}`);
  return t;
}

export function jqlQuery(jql: string | undefined, me: { accountId: string; email: string; name: string }, now = Date.now()): { match: (i: JqlIssue) => boolean; order: JqlOrder } {
  const [where, orderBy] = (jql ?? "").split(/\s+order\s+by\s+/i);
  const order: JqlOrder = (orderBy ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [field, dir] = s.split(/\s+/);
    return { field: lower(field), dir: lower(dir ?? "asc") === "desc" ? "desc" : "asc" };
  });
  const match = boolExpr<JqlIssue>((where ?? "").replace(/^\s*order\s+by.*$/i, ""), (clause) => {
    const m = /^("?[\w ]+?"?)\s*(not in|is not|!=|!~|>=|<=|=|~|>|<|in|is)\s*(.+)$/i.exec(clause);
    if (!m) throw new UnsupportedQuery(`JQL clause "${clause}"`);
    const field = lower(unquote(m[1]).trim());
    const op = lower(m[2]);
    const raw = m[3].trim();
    const list = /^\(.*\)$/.test(raw) ? raw.slice(1, -1).split(",").map((s) => unquote(s.trim())) : [unquote(raw)];
    const isEmpty = /^(empty|null)$/i.test(raw);
    const person = (v: string) => (i: JqlIssue) => {
      if (/^currentuser\(\)$/i.test(v)) return i.assignee?.accountId === me.accountId;
      return Boolean(i.assignee && [i.assignee.accountId, lower(i.assignee.email), lower(i.assignee.name)].includes(lower(v)));
    };
    const text = (get: (i: JqlIssue) => string) => (i: JqlIssue) => list.every((w) => w.split(/\s+/).every((t) => has(get(i), t.replace(/\*/g, ""))));
    const eq = (get: (i: JqlIssue) => string | string[]) => (i: JqlIssue) => {
      const v = get(i);
      return list.some((w) => (Array.isArray(v) ? v.map(lower).includes(lower(w)) : lower(v) === lower(w)));
    };
    let f: (i: JqlIssue) => boolean;
    switch (field) {
      case "assignee":
        if (op === "is" || op === "is not") { f = (i) => !i.assignee === isEmpty; break; }
        f = (i) => list.some((v) => person(v)(i));
        break;
      // CompanySim tickets have no reporter: these fields are always empty.
      case "reporter": case "creator": case "watcher":
        f = op === "is" || op === "is not" ? () => isEmpty : () => false;
        break;
      case "project": f = (i) => list.some((v) => [lower(i.projectKey), lower(i.projectName)].includes(lower(v))); break;
      case "key": case "issuekey": case "id": f = eq((i) => i.key); break;
      case "status": f = eq((i) => i.status); break;
      case "statuscategory": f = (i) => list.some((v) => lower(v) === i.statusCategory || lower(v) === { new: "to do", indeterminate: "in progress", done: "done" }[i.statusCategory]); break;
      case "priority": f = eq((i) => i.priority); break;
      case "labels": f = eq((i) => i.labels); break;
      case "type": case "issuetype": f = eq((i) => i.type); break;
      case "resolution":
        f = op === "is" || op === "is not" || op === "=" || op === "!=" ? (i) => (i.statusCategory !== "done") === isEmpty : () => false;
        break;
      case "summary": f = text((i) => i.summary); break;
      case "description": f = text((i) => i.description); break;
      case "text": f = text((i) => `${i.summary} ${i.description} ${i.labels.join(" ")}`); break;
      case "created": case "createddate": case "updated": case "updateddate": {
        const t = jqlDate(raw, now);
        const get = field.startsWith("created") ? (i: JqlIssue) => i.created : (i: JqlIssue) => i.updated;
        return (i) => compare(get(i), op, t);
      }
      default: throw new UnsupportedQuery(`JQL field ${field}`);
    }
    if (op === "!=" || op === "!~" || op === "not in" || op === "is not") return (i) => !f(i);
    if (["=", "~", "in", "is"].includes(op)) return f;
    throw new UnsupportedQuery(`JQL operator ${op} on ${field}`);
  });
  return { match, order };
}

// ─── Google Drive `q` ────────────────────────────────────────────────────────

export type DriveSearchable = { name: string; body: string; mimeType: string; owners: string[]; parents: string[]; modified: number; created: number; mine: boolean };

export function driveQuery(q: string | undefined): (f: DriveSearchable) => boolean {
  return boolExpr<DriveSearchable>(q ?? "", (clause) => {
    const inOwners = /^'([^']*)'\s+in\s+(owners|writers|readers|parents)$/i.exec(clause);
    if (inOwners) {
      const [, who, where] = inOwners;
      if (lower(where) === "parents") return (f) => f.parents.includes(who) || (who === "root" && f.parents.length === 0);
      return (f) => (who === "me" ? f.mine : f.owners.some((o) => lower(o) === lower(who)));
    }
    if (/^sharedwithme(\s*=\s*true)?$/i.test(clause)) return (f) => !f.mine;
    const m = /^(\w+)\s+(contains|=|!=|>=|<=|>|<)\s+(.+)$/i.exec(clause);
    if (!m) throw new UnsupportedQuery(`Drive q clause "${clause}"`);
    const [, field, op, raw] = m;
    const value = unquote(raw.trim()).replace(/\\'/g, "'");
    switch (lower(field)) {
      case "name": return (f) => (lower(op) === "contains" ? has(f.name, value) : compare(lower(f.name), op, lower(value)));
      case "fulltext": return (f) => has(`${f.name} ${f.body}`, value);
      case "mimetype": return (f) => (lower(op) === "contains" ? has(f.mimeType, value) : compare(f.mimeType, op, value));
      case "trashed": case "starred": case "hidden": return () => compare(false, op, lower(value) === "true");
      case "modifiedtime": case "createdtime": case "viewedbymetime": {
        const t = Date.parse(value);
        if (Number.isNaN(t)) throw new UnsupportedQuery(`Drive date ${value}`);
        return (f) => compare(lower(field) === "createdtime" ? f.created : f.modified, op, t);
      }
      default: throw new UnsupportedQuery(`Drive q field ${field}`);
    }
  });
}

// ─── SharePoint KQL ──────────────────────────────────────────────────────────

export type KqlSearchable = { title: string; body: string; author: string; extension: string; path: string };

export function kqlQuery(query: string): (d: KqlSearchable) => boolean {
  const ors = splitTop(query.trim(), "OR");
  if (ors.length > 1) { const fs = ors.map(kqlQuery); return (d) => fs.some((f) => f(d)); }
  const tokens = query.match(/-?[a-z]+:"[^"]*"|-?"[^"]*"|\S+/gi) ?? [];
  const fs = tokens.filter((t) => t !== "AND" && t !== "*").map((token): ((d: KqlSearchable) => boolean) => {
    const neg = token.startsWith("-") || token.startsWith("NOT ");
    const t = neg ? token.slice(1) : token;
    const op = /^([a-z]+)[:=](.+)$/i.exec(t);
    let f: (d: KqlSearchable) => boolean;
    if (op) {
      const value = unquote(op[2]).replace(/\*$/, "");
      switch (lower(op[1])) {
        case "filename": case "title": f = (d) => has(d.title, value); break;
        case "author": f = (d) => has(d.author, value); break;
        case "filetype": case "fileextension": f = (d) => lower(d.extension) === lower(value); break;
        case "path": f = (d) => has(d.path, value); break;
        case "isdocument": case "contentclass": f = () => true; break;
        default: f = (d) => has(`${d.title} ${d.body}`, value);
      }
    } else {
      const w = unquote(t).replace(/\*$/, "");
      f = (d) => has(`${d.title} ${d.body}`, w);
    }
    return neg ? (d) => !f(d) : f;
  });
  return (d) => fs.every((f) => f(d));
}
