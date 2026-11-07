import { readFileSync } from 'fs';
import { join } from 'path';
import { ERASURE_DECISIONS } from './erasure.decisions';

const schema = readFileSync(join(__dirname, '..', 'schema.prisma'), 'utf8');
const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);

describe('erasure decisions', () => {
  it('has a decision for every model of the Prisma schema', () => {
    const missing = models.filter((model) => !ERASURE_DECISIONS[model]);
    expect(missing).toEqual([]);
  });

  it('has no decision for a model that no longer exists', () => {
    const unknown = Object.keys(ERASURE_DECISIONS).filter(
      (model) => !models.includes(model)
    );
    expect(unknown).toEqual([]);
  });

  it('keeps the affiliate ledger and nothing else as a retained record', () => {
    const retained = Object.entries(ERASURE_DECISIONS)
      .filter(([, decision]) => decision.scope === 'retain')
      .map(([model]) => model);
    expect(retained).toEqual(['AffiliateCommission']);
  });

  it('never leaves a model with an organization or user key undecided as none', () => {
    // every model with a relation to Organization or User must be handled
    const keyed = models.filter((model) => {
      const body = schema
        .split(new RegExp(`^model ${model} \\{`, 'm'))[1]
        .split(/^\}/m)[0];
      return (
        /^\s+(organizationId|orgId|userId)\s/m.test(body) &&
        !model.startsWith('mastra_')
      );
    });
    const untouched = keyed.filter(
      (model) => ERASURE_DECISIONS[model]?.scope === 'none'
    );
    expect(untouched).toEqual([]);
  });
});
