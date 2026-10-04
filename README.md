# Renew

Renew keeps approved renewal terms for a customer: the entitlements they already have, what may be offered at renewal, and what an assistant must not add or discount. It stores that record, then lets an assistant read it before it answers. If a concession, a discount, or an extra entitlement is not approved, the tools say so. The assistant does not fill it in.

It works with ChatGPT, Claude, Gemini, Grok, and Cursor, plus any other MCP client that can do Streamable HTTP and OAuth. It is not a ChatGPT-only plugin.

- Source: https://github.com/LAHutchins91/renew-mcp
- Setup: `http://localhost:3000/connect` on a local server, or `https://<your host>/connect` when deployed
- MCP address: `http://localhost:3000/mcp` locally, or `https://<your host>/mcp` when deployed

Sign in with your Renew account when the assistant opens OAuth. Do not paste an API key or password into a header. Renewal tools need Pro or an active trial. The site offers a 14-day trial, then Pro. Checkout shows the billing terms before you confirm. This page does not invent an amount.

## What the assistant can do

After you approve the connection, the server exposes these tools:

- list_accounts
- create_account
- get_approved_context
- search_approved_terms
- record_current_entitlement
- record_renewal_offer
- record_forbidden_concession
- revise_approved_fact
- get_fact_history
- renew_audit

Locked facts stay locked until you revise them. A concession, a discount, or an extra entitlement is included only when you approved it. A concession rule is either a forbidden concession or the rule that no extra concession is approved. The assistant only calls these tools when you and the host allow it.

## Connect

Cursor, in `~/.cursor/mcp.json` or a project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "renew": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Use your deployed origin plus `/mcp` when the server is public. Claude Code:

```bash
claude mcp add --transport http renew http://localhost:3000/mcp
```

Other clients: add the same URL, choose OAuth, and leave client id and secret empty. Renew supports dynamic client registration. Full steps for each assistant are on the connect page.

Registry metadata for this remote server is in `server.json` (`io.github.LAHutchins91/renew`).

## Run

```bash
npm install
npm run build
npm start
```

Set `APP_BASE_URL` to the public origin when you deploy. Sign-in uses Supabase. Billing uses Stripe, with a 14-day trial on checkout. The process speaks Streamable HTTP when stdin is a terminal, and stdio MCP when it is not.
