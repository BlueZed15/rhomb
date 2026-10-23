import { APIRequestContext, expect } from '@playwright/test';

export const APP = process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com';
export const API = 'https://api.rhombusai.com/api';
/**
 * The project to read: RHOMBUS_PROJECT_ID if set, otherwise the newest project that has a full pipeline
 * (an input and an output node), e.g. the one the UI journey builds. Undefined if there's none yet.
 */
export async function findPipelineProject(request: APIRequestContext, token: string): Promise<number | undefined> {
  if (process.env.RHOMBUS_PROJECT_ID) return Number(process.env.RHOMBUS_PROJECT_ID);
  const { items } = await (await request.get(`${API}/dataset/projects/all`, { headers: bearer(token) })).json();
  const newestFirst = [...items].sort((a: { created: string }, b: { created: string }) => b.created.localeCompare(a.created));
  for (const p of newestFirst) {
    const res = await request.get(`${API}/dataset/analyzer/v2/projects/${p.id}/nodes`, { headers: bearer(token) });
    if (!res.ok()) continue;
    const types = Object.values(await res.json()).map((n) => (n as { transformer_type: string }).transformer_type);
    if (types.includes('input') && types.includes('output')) return p.id;
  }
  return undefined;
}

/**
 * The frontend (NextAuth) swaps the login cookie for a short-lived JWT, which the backend wants as a Bearer token.
 * We do the same thing the app does. The token is never logged.
 */
export async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${APP}/api/auth/session`);
  expect(res.status(), 'session endpoint (is .auth/state.json fresh? run `npm run auth`)').toBe(200);
  const body = await res.json();
  expect(body.accessToken, 'no accessToken: the saved login has probably expired').toBeTruthy();
  return body.accessToken as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
