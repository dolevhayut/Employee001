// Tiny OneLake DFS client used by the Fabric storage backend. Speaks the
// Azure DFS REST API directly so we don't depend on the @azure/storage-file-
// datalake SDK's filesystem semantics (which assume an ADLS Gen2 account, not
// Fabric's OneLake namespace).
//
// Auth: DefaultAzureCredential → bearer token for https://storage.azure.com.

import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

const STORAGE_SCOPE = "https://storage.azure.com/.default";

let _credential: DefaultAzureCredential | null = null;
let _token: AccessToken | null = null;

function getCredential(): DefaultAzureCredential {
  if (!_credential) {
    _credential = new DefaultAzureCredential({
      tenantId: process.env.AZURE_TENANT_ID,
    });
  }
  return _credential;
}

async function getToken(force = false): Promise<string> {
  if (!force && _token && _token.expiresOnTimestamp - 60_000 > Date.now()) {
    return _token.token;
  }
  const t = await getCredential().getToken(STORAGE_SCOPE);
  if (!t) throw new Error("Could not acquire AAD token for OneLake.");
  _token = t;
  return t.token;
}

function baseUrl(): string {
  const url = process.env.FABRIC_ONELAKE_PATH;
  if (!url) {
    throw new Error(
      "FABRIC_ONELAKE_PATH is not set (expected https://onelake.dfs.fabric.microsoft.com/<workspace>/<lakehouse>.Lakehouse/Files)."
    );
  }
  return url.replace(/\/+$/, "");
}

async function dfsFetch(
  method: string,
  url: string,
  init: RequestInit & { body?: string | Uint8Array | Buffer } = {}
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${await getToken()}`,
    "x-ms-version": "2020-10-02",
    ...(init.headers as Record<string, string> | undefined),
  };
  const opts: RequestInit = {
    method,
    headers,
    body: init.body as BodyInit | undefined,
  };
  let res = await fetch(url, opts);
  if (res.status === 401) {
    headers.Authorization = `Bearer ${await getToken(true)}`;
    res = await fetch(url, { ...opts, headers });
  }
  return res;
}

export type AppendOptions = {
  /** Subdirectory under Files/. e.g. "audit" → Files/audit/<filename> */
  table: string;
  /** Filename within the table dir. e.g. "2026-06-02.jsonl" */
  filename: string;
  /** UTF-8 string to append (newline-terminated by caller if desired). */
  data: string;
};

function fileUrl(table: string, filename: string): string {
  const safeTable = encodeURIComponent(table).replace(/%2F/g, "/");
  const safeName = encodeURIComponent(filename);
  return `${baseUrl()}/${safeTable}/${safeName}`;
}

async function getCurrentLength(table: string, filename: string): Promise<number | null> {
  const res = await dfsFetch("HEAD", `${fileUrl(table, filename)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`OneLake HEAD failed (${res.status}): ${await res.text()}`);
  }
  const len = res.headers.get("content-length");
  return len ? Number(len) : 0;
}

async function createFile(table: string, filename: string): Promise<void> {
  const res = await dfsFetch("PUT", `${fileUrl(table, filename)}?resource=file`, {
    headers: { "Content-Length": "0" },
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`OneLake create-file failed (${res.status}): ${await res.text()}`);
  }
}

/** Append + flush a chunk to a file under Files/<table>/<filename>. */
export async function appendOneLake(opts: AppendOptions): Promise<void> {
  if (!opts.data) return;
  const bytes = Buffer.from(opts.data, "utf8");
  let length = await getCurrentLength(opts.table, opts.filename);
  if (length === null) {
    await createFile(opts.table, opts.filename);
    length = 0;
  }
  const appendRes = await dfsFetch(
    "PATCH",
    `${fileUrl(opts.table, opts.filename)}?action=append&position=${length}`,
    {
      headers: { "Content-Length": String(bytes.length) },
      body: bytes,
    }
  );
  if (!appendRes.ok) {
    throw new Error(`OneLake append failed (${appendRes.status}): ${await appendRes.text()}`);
  }
  const newLen = length + bytes.length;
  const flushRes = await dfsFetch(
    "PATCH",
    `${fileUrl(opts.table, opts.filename)}?action=flush&position=${newLen}`,
    { headers: { "Content-Length": "0" } }
  );
  if (!flushRes.ok) {
    throw new Error(`OneLake flush failed (${flushRes.status}): ${await flushRes.text()}`);
  }
}

/** Overwrite (create-or-replace) a file. */
export async function writeOneLake(opts: AppendOptions): Promise<void> {
  const bytes = Buffer.from(opts.data, "utf8");
  // Recreate file (deletes old content), then append+flush.
  const createRes = await dfsFetch("PUT", `${fileUrl(opts.table, opts.filename)}?resource=file`, {
    headers: { "Content-Length": "0" },
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`OneLake create-file failed (${createRes.status}): ${await createRes.text()}`);
  }
  // PUT with resource=file leaves the file empty even if it already existed.
  // Re-open: get fresh length, append, flush.
  await appendOneLake(opts);
  // suppress unused
  void bytes;
}

/** Read a UTF-8 file (entire body) from Files/<table>/<filename>. Returns null on 404. */
export async function readOneLake(
  table: string,
  filename: string
): Promise<string | null> {
  const res = await dfsFetch("GET", fileUrl(table, filename));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`OneLake read failed (${res.status}): ${await res.text()}`);
  }
  return await res.text();
}

export function isOneLakeConfigured(): boolean {
  return Boolean(process.env.FABRIC_ONELAKE_PATH && process.env.AZURE_TENANT_ID);
}
