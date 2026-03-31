import crypto from 'crypto';

import { logger } from './logger.js';

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface PendingApproval {
  id: string;
  targetJid: string;
  text: string;
  createdAt: Date;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// Matches: "approve abc123" or "deny abc123"
export const APPROVAL_COMMAND_PATTERN = /^(approve|deny)\s+([a-f0-9]{6})$/i;
// Matches shorthand: "approve" / "yes" / "כן" / "אשר" / "שלח" (approve most-recent if single pending)
export const APPROVE_SHORTHAND = /^(approve|yes|כן|אשר|מאשר|שלח)$/i;
// Matches shorthand: "deny" / "no" / "לא" / "דחה" (deny most-recent if single pending)
export const DENY_SHORTHAND = /^(deny|no|לא|דחה)$/i;
// Matches: "pending"
export const PENDING_LIST_PATTERN = /^pending$/i;

/**
 * Returns a short, human-readable identifier for a JID so the user can
 * verify the exact destination even when group names are ambiguous.
 *
 * Individual:  "972501234567@s.whatsapp.net" → "+972501234567"
 * Group:       "120363012345678@g.us"        → "…12345678 (group)"
 * Other:       returns the raw JID
 */
function shortJid(jid: string): string {
  const atIdx = jid.indexOf('@');
  if (atIdx === -1) return jid;
  const local = jid.slice(0, atIdx);
  const domain = jid.slice(atIdx + 1);
  if (domain === 's.whatsapp.net') return `+${local}`;
  if (domain === 'g.us') {
    const suffix = local.length > 8 ? `…${local.slice(-8)}` : local;
    return `${suffix} (group)`;
  }
  return jid;
}

/**
 * Hard send-approval gate.
 *
 * Every outgoing message that is NOT addressed to the main (owner) group is
 * held in a pending queue and a preview is sent to the main group.  The owner
 * must reply "approve <id>" or "deny <id>" before the message is delivered.
 * Messages expire after 10 minutes if unanswered.
 *
 * Messages addressed to the main group itself always bypass the gate so that
 * approval previews can always reach the owner.
 */
export class SendApprovalGate {
  private pending = new Map<string, PendingApproval>();

  constructor(
    /** The raw send function — must NOT go through this gate to avoid loops */
    private rawSend: (jid: string, text: string) => Promise<void>,
    /** Returns the main (owner) group JID, or undefined if not yet registered */
    private getMainJid: () => string | undefined,
    /** Returns a human-readable name for a JID */
    private getGroupName: (jid: string) => string,
  ) {}

  /**
   * Send a message, routing through the approval gate unless it's addressed
   * to the main group.
   */
  async send(jid: string, text: string): Promise<void> {
    const mainJid = this.getMainJid();

    // Always deliver directly to main group (approval previews must reach owner)
    if (!mainJid || jid === mainJid) {
      return this.rawSend(jid, text);
    }

    const id = crypto.randomBytes(3).toString('hex');
    const groupName = this.getGroupName(jid);

    logger.info(
      { id, targetJid: jid, groupName },
      'Approval gate: queuing outbound message',
    );

    const timeoutHandle = setTimeout(async () => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      logger.warn(
        { id, targetJid: jid },
        'Approval gate: message expired, discarded',
      );
      // Re-resolve mainJid at expiry time (not captured at queue time)
      const currentMainJid = this.getMainJid();
      if (!currentMainJid) return;
      const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      await this.rawSend(
        currentMainJid,
        `⏰ *[${id}] expired* — message to "${groupName}" (${shortJid(jid)}) was discarded.\n\nWas: ${preview}`,
      ).catch(() => {});
    }, APPROVAL_TIMEOUT_MS);

    this.pending.set(id, {
      id,
      targetJid: jid,
      text,
      createdAt: new Date(),
      timeoutHandle,
    });

    // Show name + short JID for verification. If no name is registered,
    // just show the short JID to avoid showing "raw-jid (short-jid)" redundantly.
    const targetLabel =
      groupName === jid ? shortJid(jid) : `${groupName} (${shortJid(jid)})`;
    const preview =
      `🔐 *Send Approval Required*\n` +
      `*ID:* \`${id}\`\n` +
      `*To:* ${targetLabel}\n\n` +
      `${text}\n\n` +
      `✅ \`approve ${id}\`\n` +
      `❌ \`deny ${id}\`\n` +
      `📋 \`pending\` — list all`;
    await this.rawSend(mainJid, preview);
  }

  /**
   * Check if a message content is an approval command coming from the main group.
   * Hard-rejects commands from any other JID.
   * Returns true if the message was an approval command (caller should skip agent).
   */
  async handleCommand(fromJid: string, content: string): Promise<boolean> {
    const trimmed = content.trim();
    const mainJid = this.getMainJid();
    if (!mainJid) return false;

    // Hard guard: only the main group can issue approval commands
    if (fromJid !== mainJid) {
      logger.warn(
        { fromJid, mainJid },
        'Approval gate: command rejected — not from main group',
      );
      return false;
    }

    if (PENDING_LIST_PATTERN.test(trimmed)) {
      if (this.pending.size === 0) {
        await this.rawSend(mainJid, '📋 No pending approvals.');
      } else {
        const lines = [...this.pending.values()].map((p) => {
          const ageS = Math.round((Date.now() - p.createdAt.getTime()) / 1000);
          const name = this.getGroupName(p.targetJid);
          const snippet =
            p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text;
          const label = name === p.targetJid ? shortJid(p.targetJid) : `${name} (${shortJid(p.targetJid)})`;
          return `• \`${p.id}\` → ${label} (${ageS}s ago): ${snippet}`;
        });
        await this.rawSend(
          mainJid,
          `📋 *Pending approvals (${this.pending.size}):*\n${lines.join('\n')}`,
        );
      }
      return true;
    }

    // Shorthand: "yes" / "approve" / "כן" etc. — works only when exactly one message is pending
    if (APPROVE_SHORTHAND.test(trimmed) || DENY_SHORTHAND.test(trimmed)) {
      if (this.pending.size === 0) {
        await this.rawSend(mainJid, '❓ No pending approvals.');
        return true;
      }
      if (this.pending.size > 1) {
        await this.rawSend(
          mainJid,
          `⚠️ ${this.pending.size} messages pending — use \`approve <id>\` or \`deny <id>\` to be specific. Type \`pending\` to list them.`,
        );
        return true;
      }
      // Exactly one pending — apply shorthand to it
      const [singlePending] = this.pending.values();
      const isApprove = APPROVE_SHORTHAND.test(trimmed);
      return this._resolve(singlePending.id, isApprove ? 'approve' : 'deny', mainJid);
    }

    const match = trimmed.match(APPROVAL_COMMAND_PATTERN);
    if (!match) return false;

    const [, action, rawId] = match;
    const id = rawId.toLowerCase();
    const pending = this.pending.get(id);

    if (!pending) {
      await this.rawSend(mainJid, `❓ No pending approval with ID \`${id}\`.`);
      return true;
    }

    return this._resolve(id, action, mainJid);
  }

  private async _resolve(
    id: string,
    action: string,
    mainJid: string,
  ): Promise<true> {
    const pending = this.pending.get(id);
    if (!pending) return true;

    clearTimeout(pending.timeoutHandle);
    this.pending.delete(id);

    const pendingName = this.getGroupName(pending.targetJid);
    const targetLabel =
      pendingName === pending.targetJid
        ? shortJid(pending.targetJid)
        : `"${pendingName}" (${shortJid(pending.targetJid)})`;

    if (action.toLowerCase() === 'approve') {
      logger.info(
        { id, targetJid: pending.targetJid },
        'Approval gate: approved, sending',
      );
      try {
        await this.rawSend(pending.targetJid, pending.text);
        await this.rawSend(mainJid, `✅ \`[${id}]\` sent to ${targetLabel}`);
      } catch (err) {
        logger.error(
          { id, targetJid: pending.targetJid, err },
          'Approval gate: send failed after approval',
        );
        await this.rawSend(
          mainJid,
          `⚠️ \`[${id}]\` approved but *failed to deliver* to ${targetLabel}\n\nReason: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      logger.info({ id }, 'Approval gate: denied, discarding');
      await this.rawSend(mainJid, `❌ \`[${id}]\` discarded.`);
    }

    return true;
  }
}
