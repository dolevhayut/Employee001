// Smoke test: exercise the new Azure OpenAI + OneLake stack against real
// services. Run with:
//   source .azure-secrets/.env.azure && node scripts/smoke-azure.mjs

import { DefaultAzureCredential } from "@azure/identity";

async function main() {
  // 1. AAD token
  const cred = new DefaultAzureCredential({
    tenantId: process.env.AZURE_TENANT_ID,
  });
  const token = await cred.getToken("https://cognitiveservices.azure.com/.default");
  if (!token) throw new Error("no AAD token");
  console.log("✓ AAD bearer for Cognitive Services");

  // 2. gpt-4o smoke
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, "");
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const res = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Reply with exactly: SMOKE_OK" }],
        max_completion_tokens: 20,
      }),
    }
  );
  if (!res.ok) throw new Error(`chat completion failed: ${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content ?? "";
  if (!reply.includes("SMOKE_OK")) {
    console.warn(`⚠ chat reply unexpected: ${reply}`);
  } else {
    console.log(`✓ gpt-4o reply: ${reply.trim()}`);
  }

  // 3. OneLake write/read
  const storageTok = await cred.getToken("https://storage.azure.com/.default");
  const oneLake = `${process.env.FABRIC_ONELAKE_PATH.replace(/\/+$/, "")}/smoke/${Date.now()}.txt`;
  const payload = `smoke ${new Date().toISOString()}\n`;
  let r = await fetch(`${oneLake}?resource=file`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${storageTok.token}`,
      "x-ms-version": "2020-10-02",
      "Content-Length": "0",
    },
  });
  if (!r.ok) {
    console.warn(`⚠ OneLake create failed: ${r.status} ${await r.text()}`);
    return;
  }
  const bytes = Buffer.from(payload, "utf8");
  r = await fetch(`${oneLake}?action=append&position=0`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${storageTok.token}`,
      "x-ms-version": "2020-10-02",
      "Content-Length": String(bytes.length),
    },
    body: bytes,
  });
  if (!r.ok) console.warn(`⚠ OneLake append: ${r.status} ${await r.text()}`);
  r = await fetch(`${oneLake}?action=flush&position=${bytes.length}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${storageTok.token}`,
      "x-ms-version": "2020-10-02",
      "Content-Length": "0",
    },
  });
  if (!r.ok) console.warn(`⚠ OneLake flush: ${r.status} ${await r.text()}`);
  r = await fetch(oneLake, {
    headers: {
      Authorization: `Bearer ${storageTok.token}`,
      "x-ms-version": "2020-10-02",
    },
  });
  if (r.ok) {
    const body = await r.text();
    console.log(`✓ OneLake round-trip: ${body.trim()}`);
  } else {
    console.warn(`⚠ OneLake read: ${r.status}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
