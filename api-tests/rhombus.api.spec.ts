import { test, expect, APIResponse } from '@playwright/test';
import { API, bearer, findPipelineProject, getToken } from './helpers';

/*
 * Why these tests
 * ---------------
 * Rhombus has no public API, so these call the endpoints its own frontend uses (found in the network tab), with
 * the same short-lived JWT the app gets from /api/auth/session. Every request is a GET: safe on a real account.
 *
 * I picked them by risk. Rhombus holds customers' data AND their cloud credentials (GCS keys, presigned S3 links),
 * and it's multi-tenant, so the worst failures are someone getting in who shouldn't, or seeing another customer's
 * project. Next worst: the frontend's core reads changing shape, or a saved pipeline being broken before it runs.
 *
 *  1. Usual: the project list keeps its contract, and agrees with the per-project endpoint.
 *  2. Usual: a saved pipeline is structurally sound. Each check maps to a bug I hit while testing: the builder
 *     saving "rhom-1" as the destination id, empty LLM prompts, built-in nodes losing their columns.
 *  3. Edge: bad or forged credentials are rejected. The standard bypass attempts (none, empty, wrong scheme,
 *     tampered signature, alg:none, token in the URL) must all get 401, never 200 or 500.
 *  4. Edge: other customers' projects stay hidden, and odd ids fail safely. Cross-tenant reads (IDOR) are the worst
 *     realistic bug here, and they usually slip through on nested endpoints, so all three are checked. Odd ids
 *     must get a clean 4xx, never a 500 or a leaked stack trace.
 *
 * Known issues (expected to fail, so they flag the day Rhombus fixes them):
 *  - imported datasets keep the full presigned S3 link, signature and all;
 *  - "bearer" in lowercase gets past auth but then returns an empty list / a 500 (schemes are case-insensitive).
 *
 * Not tested on purpose: write endpoints (side effects on a real account), rate limits (I'd be load-testing a
 * production service I don't own), and expired tokens (I can't mint a validly signed one; tampering covers it).
 */

let token: string;
let projectId: number | undefined;

// A project in another organisation that definitely exists (my main account's baseline), plus a low id that
// almost certainly belongs to someone else. "Exists but 404" is what proves access control, not just absence.
const OTHER_ORG_PROJECTS = [process.env.OTHER_ORG_PROJECT_ID || '5354', '1'];

const UNAUTHORIZED = { detail: 'Unauthorized' };
const leaksInternals = (body: string) => /traceback|exception|sqlalchemy|psycopg|syntax error|select .+ from/i.test(body);

test.beforeAll(async ({ request }) => {
  token = await getToken(request); // fails the suite up front if the saved login gives no valid JWT
  projectId = await findPipelineProject(request, token);
});

test('usual: the project list keeps its contract', async ({ request }) => {
  const res = await request.get(`${API}/dataset/projects/all`, { headers: bearer(token) });
  expect(res.status()).toBe(200);
  const { items } = await res.json();
  expect(Array.isArray(items)).toBe(true);

  for (const p of items) {
    await test.step(`project ${p.id}: fields, and /context agrees`, async () => {
      expect(p).toMatchObject({
        id: expect.any(Number),
        name: expect.any(String),
        organization_id: expect.any(Number),
        org_role: expect.any(String),
        project_role: expect.any(String),
      });
      // Two endpoints describing the same project must not disagree (the sidebar vs the opened project).
      const ctx = await request.get(`${API}/dataset/projects/${p.id}/context`, { headers: bearer(token) });
      expect(ctx.status()).toBe(200);
      expect(await ctx.json()).toMatchObject({ id: p.id, organization_id: p.organization_id, project_role: p.project_role });
    });
  }
});

test('usual: a saved pipeline is structurally sound', async ({ request }) => {
  test.skip(!projectId, 'No project with a full pipeline yet: run the UI journey first, or set RHOMBUS_PROJECT_ID.');
  const res = await request.get(`${API}/dataset/analyzer/v2/projects/${projectId}/nodes`, { headers: bearer(token) });
  expect(res.status()).toBe(200);
  type Node = { name: string; transformer_type: string; params: Record<string, unknown>; inputs: string[]; outputs: string[] };
  const nodes = Object.values(await res.json()) as Node[];
  const byType = (t: string) => nodes.filter((n) => n.transformer_type === t);

  await test.step('exactly one input, reading a real dataset', async () => {
    expect(byType('input')).toHaveLength(1);
    expect(byType('input')[0].params.dataset_id).toEqual(expect.any(Number));
  });

  await test.step('exactly one output, with a numeric destination id (not a name like "rhom-1")', async () => {
    expect(byType('output')).toHaveLength(1);
    expect(byType('output')[0].params.destination_id).toEqual(expect.any(Number));
  });

  await test.step('every LLM node has a prompt or code (the chatbot left empty ones 3 times)', async () => {
    for (const n of byType('llm')) {
      expect(String(n.params.prompt ?? '').trim() || String(n.params.code ?? '').trim(), n.name).not.toBe('');
    }
  });

  await test.step('built-in nodes still have their columns (switching the input used to wipe them)', async () => {
    for (const n of nodes.filter((x) => ['text_case_convert', 'remove_duplicate'].includes(x.transformer_type))) {
      expect(n.params.columns, n.name).toEqual(expect.arrayContaining([expect.any(String)]));
    }
  });

  await test.step('the graph is connected: every input comes from another node, and the output reaches back to the input', async () => {
    const producer = new Map<string, Node>();
    for (const n of nodes) for (const o of n.outputs) producer.set(o, n);
    for (const n of nodes) {
      for (const i of n.inputs) {
        expect(producer.get(i), `${n.name} reads "${i}", which no node produces`).toBeTruthy();
        expect(producer.get(i)!.name, `${n.name} reads its own output`).not.toBe(n.name);
      }
    }
    // Walk back from the output; we must reach the input without looping.
    let current: Node | undefined = byType('output')[0];
    const seen = new Set<string>();
    while (current && current.transformer_type !== 'input') {
      expect(seen.has(current.name), `cycle at ${current.name}`).toBe(false);
      seen.add(current.name);
      current = producer.get(current.inputs[0]);
    }
    expect(current?.transformer_type).toBe('input');
  });
});

test('edge: bad or forged credentials are rejected with 401', async ({ playwright }) => {
  // A fresh context, so no cookie from the saved login rides along.
  const anon = await playwright.request.newContext();
  const [header, payload] = token.split('.');
  const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;
  const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');

  const cases: Array<[string, string, Record<string, string>]> = [
    ['no Authorization header', '', {}],
    ['empty "Bearer "', '', { Authorization: 'Bearer ' }],
    ['wrong scheme ("Token <jwt>")', '', { Authorization: `Token ${token}` }],
    ['real token, signature altered', '', { Authorization: `Bearer ${tampered}` }],
    ['alg:none token (same claims, no signature)', '', { Authorization: `Bearer ${unsigned}` }],
    ['token in the query string instead of the header', `?token=${encodeURIComponent(token)}`, {}],
    ['token as ?access_token=', `?access_token=${encodeURIComponent(token)}`, {}],
  ];
  expect(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'tokens are signed (RS256)').not.toBe('none');

  for (const [name, query, headers] of cases) {
    await test.step(`${name} → 401`, async () => {
      const res = await anon.get(`${API}/dataset/projects/all${query}`, { headers });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual(UNAUTHORIZED);
    });
  }
  await anon.dispose();
});

test('edge: other customers\' projects stay hidden, and odd ids fail safely', async ({ request }) => {
  const endpoints = (id: string) => [
    `/dataset/projects/${id}/context`,
    `/dataset/analyzer/v2/projects/${id}/nodes`,
    `/dataset/analyzer/v2/projects/${id}/datasets`,
  ];
  const check = async (res: APIResponse, allowed: number[]) => {
    const body = await res.text();
    expect(allowed, `status ${res.status()}`).toContain(res.status());
    expect(leaksInternals(body), 'error body leaks internals').toBe(false);
    // Nothing of the project may come back: no ids, pipeline nodes or dataset details.
    expect(body).not.toMatch(/organization_id|transformer_type|dataset_id|description/);
  };

  for (const id of OTHER_ORG_PROJECTS) {
    for (const path of endpoints(id)) {
      await test.step(`another org's project: ${path} → 404, no data`, async () => {
        await check(await request.get(`${API}${path}`, { headers: bearer(token) }), [404]);
      });
    }
  }

  const odd: Array<[string, string]> = [
    ['does not exist', '99999999'],
    ['not a number', 'abc'],
    ['negative', '-1'],
    ['zero', '0'],
    ['decimal', '1.5'],
    ['overflows a 64-bit int', '99999999999999999999'],
    ['injection-looking', encodeURIComponent('1 OR 1=1')],
    ['path traversal', '..%2F..%2Fall'],
  ];
  for (const [what, id] of odd) {
    for (const path of endpoints(id)) {
      await test.step(`${what} (${decodeURIComponent(id)}): ${path} → clean 4xx`, async () => {
        await check(await request.get(`${API}${path}`, { headers: bearer(token) }), [404, 422]);
      });
    }
  }
});

test.describe('known issues (expected to fail)', () => {
  test('imported datasets keep the presigned S3 link, signature and all', async ({ request }) => {
    // From Web URL stores the whole link in the dataset description, readable by anyone on the project. It carries
    // our IAM access key id and a valid signature until it expires.
    test.fail(true, 'Rhombus stores the credential-bearing URL; see README findings');
    test.skip(!projectId, 'No project with an imported dataset yet.');
    const res = await request.get(`${API}/dataset/analyzer/v2/projects/${projectId}/datasets`, { headers: bearer(token) });
    expect(res.status()).toBe(200);
    for (const d of (await res.json()) as Array<{ description?: string }>) {
      expect(d.description ?? '').not.toContain('X-Amz-Signature');
    }
  });

  test('a lowercase "bearer" scheme behaves like "Bearer"', async ({ playwright }) => {
    // HTTP auth schemes are case-insensitive (RFC 7235). Rhombus accepts "bearer <valid jwt>" past the 401 check
    // (a garbage token is still rejected) but then returns an empty project list, and a 500 HTML page on /context.
    test.fail(true, 'lowercase "bearer": empty list and a 500; see README findings');
    const anon = await playwright.request.newContext();
    const upper = await anon.get(`${API}/dataset/projects/all`, { headers: { Authorization: `Bearer ${token}` } });
    const lower = await anon.get(`${API}/dataset/projects/all`, { headers: { Authorization: `bearer ${token}` } });
    expect(lower.status()).toBe(upper.status());
    expect(await lower.json()).toEqual(await upper.json());
    const { items } = await upper.json();
    if (items.length) {
      const ctx = await anon.get(`${API}/dataset/projects/${items[0].id}/context`, { headers: { Authorization: `bearer ${token}` } });
      expect(ctx.status()).toBe(200);
    }
    await anon.dispose();
  });
});

