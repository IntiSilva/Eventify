import { test, type Browser, type Page } from '@playwright/test';


export const authName = () => test.info().project.name.split(' - ').at(-1);
export const isAuth = (name: string) => authName() === name;

export function getBaseURL(): string {
  return (test.info().project.use.baseURL as string) ?? 'http://localhost:3000';
}

/**
 * Small helper to open a new context with a given storageState,
 * execute a function, and always close it at the end.
 */

export async function withContext(
  browser: Browser,
  storageState: string,
  fn: (pg: Page) => Promise<void>,
) {
  const ctx = await browser.newContext({
    baseURL: getBaseURL(),
    storageState,
  });
  const pg = await ctx.newPage();
  try {
    await fn(pg);
  } finally {
    await ctx.close();
  }
}
