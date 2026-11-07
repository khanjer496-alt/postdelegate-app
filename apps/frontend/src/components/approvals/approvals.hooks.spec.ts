// the hooks file pulls in the fetch provider (a .tsx React module)
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: jest.fn(),
}));

import { channelsToActOn } from '@gitroom/frontend/components/approvals/approvals.hooks';

describe('channelsToActOn', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const later = '2026-11-02T12:00:00Z';
  const earlier = '2026-10-31T12:00:00Z';
  const siblings = [
    { id: 'waiting', state: 'DRAFT', approvalStatus: 'IN_REVIEW', publishDate: later },
    { id: 'sent_back', state: 'DRAFT', approvalStatus: 'CHANGES_REQUESTED', publishDate: later },
    { id: 'rejected', state: 'DRAFT', approvalStatus: 'REJECTED', publishDate: later },
    { id: 'draft', state: 'DRAFT', approvalStatus: 'NONE', publishDate: later },
    { id: 'approved', state: 'QUEUE', approvalStatus: 'APPROVED', publishDate: later },
    { id: 'going_out', state: 'QUEUE', approvalStatus: 'APPROVED', publishDate: earlier },
    { id: 'published', state: 'PUBLISHED', approvalStatus: 'IN_REVIEW', publishDate: earlier },
  ];
  const ids = (
    action: Parameters<typeof channelsToActOn>[1],
    current: string
  ) => channelsToActOn(siblings, action, current, now).map((p) => p.id);

  it('approves and rejects only the other channels at the same step', () => {
    expect(ids('approve', 'IN_REVIEW')).toEqual(['waiting']);
    expect(ids('reject', 'IN_REVIEW')).toEqual(['waiting']);
    // a channel the client sent back is not approved with one in review
    expect(ids('approve', 'CHANGES_REQUESTED')).toEqual(['sent_back']);
  });

  it('requests changes only on channels in review', () => {
    expect(ids('request_changes', 'IN_REVIEW')).toEqual(['waiting']);
    expect(ids('request_changes', 'CHANGES_REQUESTED')).toEqual([]);
  });

  it('submits the channels at the same step that can go back to review', () => {
    expect(ids('submit', 'CHANGES_REQUESTED')).toEqual(['sent_back']);
    expect(ids('submit', 'NONE')).toEqual(['draft']);
  });

  it('shares every channel that has not gone out', () => {
    expect(ids('share', 'IN_REVIEW')).toEqual([
      'waiting',
      'sent_back',
      'rejected',
      'draft',
      'approved',
    ]);
  });

  it('acts on nothing more for a single channel post', () => {
    expect(channelsToActOn([], 'approve', 'IN_REVIEW', now)).toEqual([]);
  });
});
