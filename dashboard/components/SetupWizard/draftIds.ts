/**
 * Client-generated ids for Wizard Phase B draft entities. Stored in the same
 * `*_id` fields WizardService/WizardResource/WizardEmployee already use — no
 * type changes needed anywhere downstream. Prefixed so a stray tmp id is
 * obviously not a real UUID in a log, an error message, or a stale reference
 * left behind after a delete.
 */
export function newTmpId(): string {
  return `tmp_${crypto.randomUUID()}`;
}

export function isTmpId(id: string): boolean {
  return id.startsWith('tmp_');
}
