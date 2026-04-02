import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SendApprovalGate } from './send-approval-gate.js';

const MAIN_JID = 'main-group@g.us';
const OTHER_JID = '120363099887766@g.us';
const PERSON_JID = '972501234567@s.whatsapp.net';

function makeGate(overrides?: {
  mainJid?: string | undefined;
  groupName?: string;
}) {
  const sent: Array<{ jid: string; text: string }> = [];
  const rawSend = vi.fn(async (jid: string, text: string) => {
    sent.push({ jid, text });
  });
  const gate = new SendApprovalGate(
    rawSend,
    () => overrides?.mainJid ?? MAIN_JID,
    (jid) =>
      overrides?.groupName ?? (jid === MAIN_JID ? 'My Group' : 'Other Group'),
  );
  return { gate, sent, rawSend };
}

/** Extract the 6-char hex ID from an approval preview message */
function extractId(text: string): string {
  const match = text.match(/`([a-f0-9]{6})`/);
  if (!match) throw new Error(`No approval ID found in: ${text}`);
  return match[1];
}

describe('SendApprovalGate.send', () => {
  it('delivers main-group messages directly without queuing', async () => {
    const { gate, sent } = makeGate();
    await gate.send(MAIN_JID, 'hello');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ jid: MAIN_JID, text: 'hello' });
  });

  it('queues a non-main message and sends a preview to main group', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'dinner at 8pm');

    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(MAIN_JID); // preview goes to main
    expect(sent[0].text).toContain('Send Approval Required');
    expect(sent[0].text).toContain('dinner at 8pm');
    expect(sent[0].text).toContain('Other Group');
  });

  it('preview includes both group name and JID identifier', async () => {
    const { gate, sent } = makeGate();
    await gate.send(PERSON_JID, 'hello person');

    expect(sent[0].text).toContain('Other Group');
    expect(sent[0].text).toContain('+972501234567'); // shortJid for individual
  });

  it('preview includes JID identifier for group targets', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'hello group');

    // shortJid for @g.us shows last 8 chars of local part
    expect(sent[0].text).toContain('(group)');
  });

  it('bypasses gate when no main JID is configured', async () => {
    // Build gate manually so getMainJid() truly returns undefined
    const sent: Array<{ jid: string; text: string }> = [];
    const rawSend = vi.fn(async (jid: string, text: string) => {
      sent.push({ jid, text });
    });
    const gate = new SendApprovalGate(
      rawSend,
      () => undefined,
      () => 'Unknown',
    );
    await gate.send(OTHER_JID, 'fallback send');
    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(OTHER_JID);
  });
});

describe('SendApprovalGate.handleCommand — source verification', () => {
  it('rejects commands from non-main JID', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'msg');
    sent.length = 0; // clear preview

    const id = extractId(
      sent.length === 0
        ? await (async () => {
            const { gate: g2, sent: s2 } = makeGate();
            await g2.send(OTHER_JID, 'msg');
            return s2[0].text;
          })()
        : sent[0].text,
    );

    const handled = await gate.handleCommand('attacker@g.us', `approve ${id}`);
    expect(handled).toBe(false);
    expect(sent).toHaveLength(0); // no message sent
  });

  it('processes approve command only from main JID', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'test message');
    const id = extractId(sent[sent.length - 1].text);
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, `approve ${id}`);
    expect(handled).toBe(true);
    // First send: actual message to target
    expect(sent[0].jid).toBe(OTHER_JID);
    expect(sent[0].text).toBe('test message');
    // Second send: confirmation to main
    expect(sent[1].jid).toBe(MAIN_JID);
    expect(sent[1].text).toContain('✅');
    expect(sent[1].text).toContain(id);
    // Confirmation shows target identifier
    expect(sent[1].text).toContain('(group)');
  });

  it('deny discards the message without sending', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'sensitive message');
    const id = extractId(sent[sent.length - 1].text);
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, `deny ${id}`);
    expect(handled).toBe(true);
    // Only one send: the denial confirmation to main
    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(MAIN_JID);
    expect(sent[0].text).toContain('❌');
    // Target group never received anything
    expect(sent.every((s) => s.jid !== OTHER_JID)).toBe(true);
  });

  it('unknown ID returns handled=true with error notice', async () => {
    const { gate, sent } = makeGate();
    const handled = await gate.handleCommand(MAIN_JID, 'approve aabbcc');
    expect(handled).toBe(true);
    expect(sent[0].jid).toBe(MAIN_JID);
    expect(sent[0].text).toContain('No pending approval');
  });

  it('pending lists queued messages with target identifier', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'first message');
    await gate.send(PERSON_JID, 'second message');
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, 'pending');
    expect(handled).toBe(true);
    expect(sent[0].jid).toBe(MAIN_JID);
    expect(sent[0].text).toContain('Pending approvals (2)');
    expect(sent[0].text).toContain('(group)');
    expect(sent[0].text).toContain('+972501234567');
  });

  it('pending shows empty message when nothing queued', async () => {
    const { gate, sent } = makeGate();
    const handled = await gate.handleCommand(MAIN_JID, 'pending');
    expect(handled).toBe(true);
    expect(sent[0].text).toContain('No pending approvals');
  });

  it('non-approval content returns false', async () => {
    const { gate, sent } = makeGate();
    const handled = await gate.handleCommand(
      MAIN_JID,
      'hello bot, how are you?',
    );
    expect(handled).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('notifies main group when approved target is unreachable', async () => {
    const sent: Array<{ jid: string; text: string }> = [];
    const rawSend = vi.fn(async (jid: string, text: string) => {
      if (jid === OTHER_JID) throw new Error('No channel for JID');
      sent.push({ jid, text });
    });
    const gate = new SendApprovalGate(
      rawSend,
      () => MAIN_JID,
      () => 'Unknown Group',
    );
    // Queue a message to OTHER_JID (preview goes to main — rawSend for main doesn't throw)
    try {
      await gate.send(OTHER_JID, 'will fail');
    } catch {
      /* ignore */
    }
    // rawSend threw for OTHER_JID during preview? No — preview goes to MAIN_JID which works.
    // Actually the gate sends to MAIN_JID for the preview, which succeeds.
    // We need a fresh gate where OTHER_JID is NOT the target on first send.
    // Simpler: just call handleCommand directly with a manually seeded pending map via send().
    const gate2Sent: Array<{ jid: string; text: string }> = [];
    const rawSend2 = vi.fn(async (jid: string, text: string) => {
      if (jid === OTHER_JID) throw new Error('No channel for JID');
      gate2Sent.push({ jid, text });
    });
    const gate2 = new SendApprovalGate(
      rawSend2,
      () => MAIN_JID,
      () => 'Other Group',
    );
    await gate2.send(OTHER_JID, 'unreachable message'); // preview stored to main (succeeds)
    const id = extractId(gate2Sent[gate2Sent.length - 1].text);
    gate2Sent.length = 0;

    await gate2.handleCommand(MAIN_JID, `approve ${id}`);

    // Only one message sent: the failure notice to main (target send threw)
    expect(gate2Sent).toHaveLength(1);
    expect(gate2Sent[0].jid).toBe(MAIN_JID);
    expect(gate2Sent[0].text).toContain('failed to deliver');
    expect(gate2Sent[0].text).toContain('No channel for JID');
  });

  it('does not process same approval twice', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'once');
    const id = extractId(sent[sent.length - 1].text);
    sent.length = 0;

    await gate.handleCommand(MAIN_JID, `approve ${id}`);
    sent.length = 0;

    // Second approve for same ID
    await gate.handleCommand(MAIN_JID, `approve ${id}`);
    expect(sent[0].text).toContain('No pending approval');
  });
});

describe('SendApprovalGate — Hebrew and bare shorthand', () => {
  it('מאשר <id> approves like "approve <id>"', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'test msg');
    const id = extractId(sent[sent.length - 1].text);
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, `מאשר ${id}`);
    expect(handled).toBe(true);
    expect(sent[0].jid).toBe(OTHER_JID);
    expect(sent[0].text).toBe('test msg');
    expect(sent[1].text).toContain('✅');
  });

  it('מסרב <id> denies like "deny <id>"', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'test msg');
    const id = extractId(sent[sent.length - 1].text);
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, `מסרב ${id}`);
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(MAIN_JID);
    expect(sent[0].text).toContain('❌');
    expect(sent.every((s) => s.jid !== OTHER_JID)).toBe(true);
  });

  it('bare "מאשר" with 1 pending approves it automatically', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'solo message');
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, 'מאשר');
    expect(handled).toBe(true);
    expect(sent[0].jid).toBe(OTHER_JID);
    expect(sent[0].text).toBe('solo message');
  });

  it('bare "approve" with 1 pending approves it automatically', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'solo message');
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, 'approve');
    expect(handled).toBe(true);
    expect(sent[0].jid).toBe(OTHER_JID);
  });

  it('bare "מאשר" with 0 pending responds gracefully', async () => {
    const { gate, sent } = makeGate();
    const handled = await gate.handleCommand(MAIN_JID, 'מאשר');
    expect(handled).toBe(true);
    expect(sent[0].text).toContain('No pending');
  });

  it('bare "מאשר" with multiple pending asks to specify ID', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'msg one');
    await gate.send(PERSON_JID, 'msg two');
    sent.length = 0;

    const handled = await gate.handleCommand(MAIN_JID, 'מאשר');
    expect(handled).toBe(true);
    expect(sent[0].text).toContain('Multiple pending');
  });
});

describe('SendApprovalGate — timeout expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-denies and notifies main group after 10 minutes', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'this will expire');
    sent.length = 0;

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);

    // Expiry notice goes to main group only
    expect(sent).toHaveLength(1);
    expect(sent[0].jid).toBe(MAIN_JID);
    expect(sent[0].text).toContain('expired');
    expect(sent[0].text).toContain('(group)'); // target JID shown
    // Target never received the message
    expect(sent.every((s) => s.jid !== OTHER_JID)).toBe(true);
  });

  it('approve before timeout cancels expiry', async () => {
    const { gate, sent } = makeGate();
    await gate.send(OTHER_JID, 'approve me fast');
    const id = extractId(sent[sent.length - 1].text);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // 5 min — not yet expired
    sent.length = 0;
    await gate.handleCommand(MAIN_JID, `approve ${id}`);
    sent.length = 0;

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000); // push past 10 min total
    // No expiry notice since timeout was cancelled
    expect(sent).toHaveLength(0);
  });
});
