// context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SelfHostedInstance } from '@gitroom/nestjs-libraries/chat/mcp.relay.service';

type Ctx = {
  requestId: string;
  auth: any; // replace with your org type if you have it, e.g. Organization
  // a self-hosted connection: where its tool calls are relayed to
  relay?: SelfHostedInstance & { id: string };
  // the MCP client (OAuth app) or "API key" the tool calls come from
  source?: string;
};

const als = new AsyncLocalStorage<Ctx>();

export function runWithContext<T>(ctx: Ctx, fn: () => Promise<T> | T) {
  return als.run(ctx, fn);
}

export function getContext(): Ctx | undefined {
  return als.getStore();
}

export function getAuth<T = any>(): T | undefined {
  return als.getStore()?.auth as T | undefined;
}

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function getRelay(): Ctx['relay'] {
  return als.getStore()?.relay;
}
export function getSource(): string | undefined {
  return als.getStore()?.source;
}
