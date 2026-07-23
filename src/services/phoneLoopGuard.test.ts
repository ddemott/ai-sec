import { describe, it, expect } from 'vitest';
import { isTransferLoop, canTransfer } from '../../shared/phone';

/**
 * The transfer-loop guard. The 20260629 migration split forward_phone from
 * forwarded_from_phone and stated in its own comment that they were kept
 * distinct "so the two can't be the same number and loop the call back to the
 * AI" — and then nothing compared them and nothing tested it. This is that
 * missing coverage.
 */
describe('transfer loop guard', () => {
  const INBOUND = '+16308229086'; // the assistant's own Telnyx DID
  const HOME = '+16082175303'; // the line that forwards INTO the assistant
  const SHOP = '+12624979039'; // a different line, staffed by a human

  it('HAPPY: forwards in from the home line, transfers out to the shop line', () => {
    // WHO:   an owner who forwards their home/published line into the assistant
    //        but wants live transfers to ring a DIFFERENT line (the shop).
    // WHAT:  two distinct numbers — no loop is possible.
    // WHEN:  every call for a tenant configured this way.
    // WHERE: canTransfer, read by /agent-tools/tenant-config.
    // WHY:   this is the case a blanket "forwarding is on ⇒ no transfer" rule
    //        would have silently broken (Dale, 2026-07-23). Forwarding IN is not
    //        what disqualifies a transfer; SAMENESS is.
    expect(isTransferLoop(SHOP, HOME, INBOUND)).toBe(false);
    expect(canTransfer(SHOP, HOME, INBOUND)).toBe(true);
  });

  it('SAD: transfer target IS the line that forwards in — rings straight back', () => {
    // WHO:   an owner who set the transfer number to their own forwarded line.
    // WHAT:  the transfer dials the line that forwards into us; the carrier
    //        forwards it right back and the caller loops.
    // WHY:   the exact failure the two columns were split to prevent.
    expect(isTransferLoop(HOME, HOME, INBOUND)).toBe(true);
    expect(canTransfer(HOME, HOME, INBOUND)).toBe(false);
  });

  it("SAD: transfer target is the assistant's own inbound number", () => {
    // WHAT: dialling ourselves — the same loop by a shorter route.
    expect(isTransferLoop(INBOUND, HOME, INBOUND)).toBe(true);
    expect(canTransfer(INBOUND, HOME, INBOUND)).toBe(false);
  });

  it('SAD: a loop written in a different format is still a loop', () => {
    // WHO:   an owner typing the number the way a human writes it.
    // WHAT:  "(608) 217-5303" and "+16082175303" are ONE line.
    // WHY:   a raw string compare passes the guard and dials the loop. This is
    //        why the comparison normalizes both sides before testing equality.
    expect(isTransferLoop('(608) 217-5303', HOME, INBOUND)).toBe(true);
    expect(isTransferLoop('608-217-5303', HOME, INBOUND)).toBe(true);
    expect(canTransfer('6082175303', HOME, INBOUND)).toBe(false);
  });

  it('SAD: no transfer target configured is NOT a loop — it is just no transfer', () => {
    // WHY: the two states are different and callers must be able to tell them
    //      apart. isTransferLoop answers "would it loop?", canTransfer answers
    //      "can we transfer at all?" — an unconfigured tenant loops nothing and
    //      transfers nothing.
    for (const empty of [null, undefined, '', '   ']) {
      expect(isTransferLoop(empty, HOME, INBOUND)).toBe(false);
      expect(canTransfer(empty, HOME, INBOUND)).toBe(false);
    }
  });

  it('HAPPY: a tenant that does not forward at all can still transfer', () => {
    // WHO:  a tenant publishing the assistant's number directly, no forwarding.
    // WHY:  forwarded_from_phone is NULL, so there is nothing to collide with.
    expect(canTransfer(SHOP, null, INBOUND)).toBe(true);
  });
});
