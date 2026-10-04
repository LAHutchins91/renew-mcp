import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { approvalBoundary, presentFact, rankApprovedTerms, resolveConcession } from "../src/lib/renew.js";
import { validateMcpClaims } from "../src/mcp-claims.js";
import { connectPageBody } from "../src/connect-page.js";
import { createRenewServer, selectApproved, type RenewDb, type Row } from "../src/renew-tools.js";

const toolNames = [
  "list_accounts",
  "create_account",
  "get_approved_context",
  "search_approved_terms",
  "record_current_entitlement",
  "record_renewal_offer",
  "record_forbidden_concession",
  "revise_approved_fact",
  "get_fact_history",
  "renew_audit"
];

describe("selectApproved", () => {
  it("prefers a locked no-concession rule that matches the request", () => {
    const rows = [
      { id: "1", kind: "ENTITLEMENT", title: "Seats in use", status: "DEVELOPING", content: "concession talks are still open", tags: [] },
      { id: "2", kind: "NO_CONCESSION", title: "No extra concession", status: "LOCKED", content: "No extra concession is approved.", tags: ["concession"] },
      { id: "3", kind: "RENEWAL_OFFER", title: "Retired offer", status: "RETIRED", content: "concession", tags: [] }
    ];
    const selected = selectApproved("concession", rows, 2);
    expect(selected.map((row) => row.title)).toEqual(["No extra concession", "Seats in use"]);
  });
});

describe("rankApprovedTerms", () => {
  it("drops retired terms", () => {
    const ranked = rankApprovedTerms("entitlement", [
      { id: "1", kind: "ENTITLEMENT", title: "Old seats", status: "RETIRED", content: "old", tags: [] }
    ]);
    expect(ranked).toEqual([]);
  });
});

describe("approvalBoundary", () => {
  it("says a concession, a discount, and an extra entitlement are not approved when the owner did not record them", () => {
    const boundary = approvalBoundary([
      { id: "1", kind: "ENTITLEMENT", title: "Current seats", status: "LOCKED", content: "The seats they already use", tags: [] }
    ]);
    expect(boundary.concession.extra_approved).toBe(false);
    expect(boundary.concession.rule).toMatch(/not approved/);
    expect(boundary.approved_entitlement_titles).toEqual(["Current seats"]);
    expect(boundary.approved_offer_titles).toEqual([]);
    expect(boundary.not_approved.join(" ")).toMatch(/discount is not approved/);
    expect(boundary.not_approved.join(" ")).toMatch(/not approved/);
    expect(boundary.must_not_add.join(" ")).toMatch(/not locked|none is approved|extra concession|concession/i);
    expect(boundary.must_not_discount.join(" ")).toMatch(/discount is not approved/);
    expect(boundary.forbidden_to_invent.length).toBeGreaterThan(0);
  });

  it("says no extra concession is approved when that rule is locked", () => {
    const boundary = approvalBoundary([
      { id: "1", kind: "NO_CONCESSION", title: "Concession policy", status: "LOCKED", content: "No extra concession is approved.", tags: [] },
      { id: "2", kind: "RENEWAL_OFFER", title: "Side offer", status: "DEVELOPING", content: "one extra month", tags: [] }
    ]);
    expect(boundary.concession).toEqual({ extra_approved: false, rule: "No extra concession is approved." });
    expect(boundary.not_approved.join(" ")).toMatch(/Facts that are not LOCKED are not approved to say/);
    expect(boundary.must_not_discount.join(" ")).toMatch(/discount is not approved/);
  });

  it("allows only the recorded renewal offer and still blocks other concessions", () => {
    const boundary = approvalBoundary([
      { id: "1", kind: "RENEWAL_OFFER", title: "Term length", status: "LOCKED", content: "One extra month on the next term", tags: [] },
      { id: "2", kind: "FORBIDDEN_CONCESSION", title: "No added seats", status: "LOCKED", content: "Do not add seats at renewal.", tags: [] }
    ]);
    expect(boundary.approved_offer_titles).toEqual(["Term length"]);
    expect(boundary.forbidden_concession_titles).toEqual(["No added seats"]);
    expect(boundary.concession.extra_approved).toBe(false);
    expect(boundary.concession.rule).toMatch(/not approved/);
    expect(boundary.must_not_add).toContain("No added seats");
    expect(boundary.must_not_discount.join(" ")).toMatch(/Do not add seats at renewal/);
  });
});

describe("presentFact", () => {
  it("does not treat a developing entitlement as approved", () => {
    const fact = presentFact({ id: "1", kind: "ENTITLEMENT", title: "Seats", status: "DEVELOPING", content: "The seats they already use", tags: [] });
    expect(fact.approved_to_say).toBe(false);
    expect(fact.not_approved).toBe("This fact is not approved.");
  });

  it("states that a locked forbidden concession must not be added or discounted", () => {
    const fact = presentFact({
      id: "1",
      kind: "FORBIDDEN_CONCESSION",
      title: "No discount",
      status: "LOCKED",
      content: "Do not discount this renewal.",
      tags: []
    });
    expect(fact).toMatchObject({
      concession_forbidden: true,
      concession_notice: "This concession is not approved. Do not add or discount it."
    });
  });

  it("states that a locked no-concession rule blocks extras", () => {
    const fact = presentFact({
      id: "1",
      kind: "NO_CONCESSION",
      title: "Concession policy",
      status: "LOCKED",
      content: "No extra concession is approved.",
      tags: []
    });
    expect(fact).toMatchObject({
      extra_concession_approved: false,
      concession_notice: "No extra concession is approved."
    });
  });
});

describe("resolveConcession", () => {
  it("refuses to invent a forbidden concession when the owner supplied no terms", () => {
    expect(resolveConcession("FORBIDDEN", "  ")).toMatchObject({
      ok: false,
      saved: false,
      not_approved: expect.stringMatching(/not approved/)
    });
  });

  it("refuses to store terms alongside the rule that nothing extra is approved", () => {
    expect(resolveConcession("NONE", "one extra month")).toMatchObject({
      ok: false,
      not_approved: expect.stringMatching(/No extra concession is approved/)
    });
  });

  it("stores the no-extra-concession rule without invented terms", () => {
    expect(resolveConcession("NONE", "")).toEqual({
      ok: true,
      kind: "NO_CONCESSION",
      content: "No extra concession is approved."
    });
  });
});

describe("validateMcpClaims", () => {
  it("accepts an email-scoped token for this resource", () => {
    const claims = {
      sub: "user-1",
      iss: "https://example.supabase.co/auth/v1",
      aud: "https://renew.example/mcp",
      role: "authenticated",
      exp: 2_000_000_000,
      client_id: "client",
      session_id: "session",
      scope: "email offline_access"
    };
    const token = `aaa.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    expect(validateMcpClaims(token, "user-1", claims.iss, "https://renew.example/mcp", 1_700_000_000).sub).toBe("user-1");
  });

  it("rejects a token that is missing the email scope", () => {
    const claims = {
      sub: "user-1",
      iss: "https://example.supabase.co/auth/v1",
      aud: "https://renew.example/mcp",
      role: "authenticated",
      exp: 2_000_000_000,
      client_id: "client",
      session_id: "session",
      scope: "openid"
    };
    const token = `aaa.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    expect(() => validateMcpClaims(token, "user-1", claims.iss, "https://renew.example/mcp", 1_700_000_000)).toThrow(/Reconnect Renew/);
  });
});

describe("public copy", () => {
  it("registers the renewal tools and explains OAuth without a currency amount", () => {
    const tools = readFileSync("src/renew-tools.ts", "utf8");
    for (const name of toolNames) expect(tools).toContain(`"${name}"`);
    const connect = connectPageBody("http://localhost:3000");
    expect(connect).toMatch(/dynamic client registration/i);
    expect(connect).toMatch(/OAuth/);
    expect(connect).toMatch(/Do not paste an API key or password into a header/);
    const files = [
      "README.md",
      "src/connect-page.ts",
      "src/landing-page.ts",
      "src/public-pages.ts",
      "src/server.ts",
      "src/renew-tools.ts",
      "src/plugin-auth.ts",
      "glama.json",
      "server.json",
      "Dockerfile"
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\$\d/);
    }
    const server = JSON.parse(readFileSync("server.json", "utf8")) as { name: string };
    const glama = JSON.parse(readFileSync("glama.json", "utf8")) as { maintainers: string[] };
    expect(server.name).toBe("io.github.LAHutchins91/renew");
    expect(glama.maintainers).toContain("LAHutchins91");
    expect(readFileSync("src/server.ts", "utf8")).toMatch(/process\.stdin\.isTTY !== true/);
    expect(readFileSync("src/server.ts", "utf8")).toMatch(/trialing/);
    expect(readFileSync("src/server.ts", "utf8")).toMatch(/trial_period_days/);
  });
});

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

function memoryDb() {
  const accounts: Row[] = [{ id: ACCOUNT, name: "Northwind", description: "Annual renewal" }];
  const terms: Row[] = [];
  const history: Row[] = [];
  const db: RenewDb = async (path, options) => {
    const url = new URL(`http://local${path}`);
    if (path.startsWith("/rest/v1/accounts") && options?.method === "POST") {
      const body = JSON.parse(String(options.body)) as Row;
      const row = { id: "22222222-2222-4222-8222-222222222222", ...body };
      accounts.push(row);
      return [row] as never;
    }
    if (path.startsWith("/rest/v1/accounts")) {
      const idEq = url.searchParams.get("id");
      if (idEq?.startsWith("eq.")) return accounts.filter((row) => row.id === idEq.slice(3)) as never;
      return accounts.map(({ id, name, description }) => ({ id, name, description })) as never;
    }
    if (path.startsWith("/rest/v1/renewal_terms")) {
      const account = url.searchParams.get("account_id")?.slice(3);
      const kind = url.searchParams.get("kind")?.slice(3);
      const title = url.searchParams.get("title")?.slice(3);
      const status = url.searchParams.get("status");
      let rows = terms.filter((row) => row.account_id === account);
      if (kind) rows = rows.filter((row) => row.kind === kind);
      if (title) rows = rows.filter((row) => row.title === title);
      if (status === "neq.RETIRED") rows = rows.filter((row) => row.status !== "RETIRED");
      if (status === "eq.LOCKED") rows = rows.filter((row) => row.status === "LOCKED");
      return rows as never;
    }
    if (path === "/rest/v1/rpc/save_renew_term") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      const existing = terms.find((row) => row.account_id === body.p_account && row.kind === body.p_kind && row.title === body.p_title);
      if (existing) {
        history.push({ renewal_term_id: existing.id, revision: Number(existing.revision) + 1, previous: existing.content, content: body.p_content });
        existing.content = body.p_content;
        existing.status = body.p_status;
        existing.tags = body.p_tags;
        existing.revision = Number(existing.revision) + 1;
        return { ...existing } as never;
      }
      const row: Row = {
        id: crypto.randomUUID(),
        account_id: body.p_account,
        kind: body.p_kind,
        title: body.p_title,
        status: body.p_status,
        content: body.p_content,
        tags: body.p_tags,
        revision: 1
      };
      terms.push(row);
      history.push({ renewal_term_id: row.id, revision: 1, previous: null, content: row.content });
      return { ...row } as never;
    }
    if (path.startsWith("/rest/v1/term_revisions")) {
      const id = url.searchParams.get("renewal_term_id")?.slice(3);
      return history.filter((row) => row.renewal_term_id === id) as never;
    }
    throw new Error(`unexpected path ${path}`);
  };
  return db;
}

async function connected(db: RenewDb) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createRenewServer(db, "user-1");
  const client = new Client({ name: "renew-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

function payload(result: unknown) {
  const value = result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const text = value.content?.find((item) => item.type === "text")?.text ?? "{}";
  return { isError: Boolean(value.isError), data: JSON.parse(text) as Record<string, unknown> };
}

describe("renewal tools", () => {
  it("lists tools, refuses an invented concession, keeps a locked entitlement locked, and says a discount is not approved", async () => {
    const { client, close } = await connected(memoryDb());
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(toolNames);

      const invented = payload(await client.callTool({
        name: "record_forbidden_concession",
        arguments: { accountId: ACCOUNT, decision: "FORBIDDEN", status: "LOCKED", terms: "   " }
      }));
      expect(invented.isError).toBe(false);
      expect(invented.data).toMatchObject({ saved: false, approved: false });
      expect(String(invented.data.not_approved)).toMatch(/not approved/);

      const none = payload(await client.callTool({
        name: "record_forbidden_concession",
        arguments: { accountId: ACCOUNT, decision: "NONE", status: "LOCKED" }
      }));
      expect(none.isError).toBe(false);
      expect(none.data).toMatchObject({ kind: "NO_CONCESSION", extra_concession_approved: false });
      expect(String(none.data.concession_notice)).toBe("No extra concession is approved.");

      const entitlement = payload(await client.callTool({
        name: "record_current_entitlement",
        arguments: {
          accountId: ACCOUNT,
          title: "Current seats",
          status: "LOCKED",
          content: "The seats the customer already has"
        }
      }));
      expect(entitlement.isError).toBe(false);
      expect(entitlement.data).toMatchObject({ entitlement_approved: true, revision: 1 });

      const locked = payload(await client.callTool({
        name: "record_current_entitlement",
        arguments: {
          accountId: ACCOUNT,
          title: "Current seats",
          status: "LOCKED",
          content: "Extra seats the assistant invented"
        }
      }));
      expect(locked.isError).toBe(true);
      expect(locked.data).toMatchObject({ error: "Locked fact" });

      const context = payload(await client.callTool({
        name: "get_approved_context",
        arguments: { accountId: ACCOUNT, request: "discount seats" }
      }));
      expect(context.isError).toBe(false);
      expect(JSON.stringify(context.data)).toMatch(/not approved/);
      expect(JSON.stringify(context.data.must_not_discount)).toMatch(/discount is not approved|No extra concession is approved/);

      const audit = payload(await client.callTool({
        name: "renew_audit",
        arguments: { accountId: ACCOUNT, proposedText: "Offer a discount and extra seats." }
      }));
      expect(audit.isError).toBe(false);
      expect(JSON.stringify(audit.data.must_not_add)).toMatch(/concession|entitlement/i);
      expect(JSON.stringify(audit.data.must_not_discount)).toMatch(/not approved/);
    } finally {
      await close();
    }
  });
});
