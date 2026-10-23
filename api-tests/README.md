# api-tests/

Tests that call Rhombus's backend directly. Rhombus has no public API, so I found these endpoints in the browser's network tab while using the app ([endpoint list](../docs/setup/03-rhombus-pipeline.md#endpoints-observed)).

Run it with `npm run test:api` from the repo root (it asks for the test account the first time). Latest run: **7 passed in 15 s**, with the two known issues failing as expected.

## How auth works
The web app swaps its login cookie at `GET https://rhombusai.com/api/auth/session` for a short-lived JWT (a signed login token), then sends it to `https://api.rhombusai.com/api/...` as `Authorization: Bearer <jwt>`. The tests do the same ([`helpers.ts`](helpers.ts)), so they exercise what a real browser does. The token is never printed.

## Why these tests
I picked them by **risk**. Rhombus holds customers' data **and their cloud credentials** (GCS keys, presigned S3 links), and it's multi-tenant. The worst failures are someone getting in who shouldn't, or seeing another customer's project. After that: the frontend's core reads changing shape, or a saved pipeline being broken before it runs. Every request is a **GET**, so it's safe on a real account.

| Test | Endpoints | What it checks | Why |
|---|---|---|---|
| **1 (usual)** The project list keeps its contract | `GET /dataset/projects/all`, `GET /dataset/projects/{id}/context` | `200`; every project has id, name, org, roles; for each one, `/context` agrees on id, org and role | Every page load calls this. Two endpoints describing the same project must not disagree |
| **2 (usual)** A saved pipeline is structurally sound | `GET /dataset/analyzer/v2/projects/{id}/nodes` | One input with a real dataset; one output with a **numeric** destination id; every LLM node has a prompt or code; built-ins still have their columns; every node's input comes from another node; the output leads back to the input with no cycle | Each check is a bug I hit: the builder saving `"rhom-1"` as the id, empty LLM prompts (3 times), built-ins losing their columns when the input changed |
| **3 (edge)** Bad or forged credentials → `401` | `GET /dataset/projects/all` | No header; empty `Bearer `; wrong scheme (`Token`); real token with the signature altered; an **`alg:none`** token (the same contents with no signature at all, a classic forgery); the token as `?token=` and as `?access_token=`. Each must be `401 {"detail":"Unauthorized"}` | The spec's example of a negative test. These are the standard ways people try to get past token checks |
| **4 (edge)** Other customers' projects stay hidden, and odd ids fail safely | `/context`, `/nodes`, `/datasets` | Another org's project (one that **exists**) → `404` on all three, with no project data in the body. Then `99999999`, `abc`, `-1`, `0`, `1.5`, a 20-digit number, `1 OR 1=1`, `../../all` → `404`/`422`, never `500`, no stack trace | Reading someone else's pipeline just by changing the number in the URL (known as IDOR) is the worst realistic bug for a multi-tenant product, and nested endpoints are where it slips through. A 500 or a leaked error hints at code paths worth probing |

## Known issues (written as tests that are expected to fail)
They keep the suite green while documenting a finding, and flip the day Rhombus fixes it.

| Test | What actually happens |
|---|---|
| Imported datasets keep the presigned S3 link | `GET …/datasets` returns the full link, **signature and our access key id included**, to anyone on the project |
| A lowercase `bearer` scheme behaves like `Bearer` | Schemes are case-insensitive (RFC 7235). `bearer <valid jwt>` gets past the 401 check (a garbage token is still rejected), but the project list comes back **empty** and `/context` returns a **500 HTML error page** |

## What I left out on purpose
- **Write endpoints** (create, delete, run), because they have side effects on a real account. The UI journey covers creating things.
- **Rate limiting and load**, because I'd be load-testing a production service I don't own.
- **Expired tokens**, because I can't mint a validly signed expired one. The tampered-signature case exercises the same check.

## What I noticed but didn't assert
- A path-traversal id (`..%2F..%2Fall`) gets a 404 as an **HTML** page, not JSON. It's harmless, so the test only checks the status.
- Non-numeric ids get a `422` whose body echoes the input back ("Input should be a valid integer"). That's normal for this framework and leaks nothing.
