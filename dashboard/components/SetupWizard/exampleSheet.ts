// Shared example knowledge sheet + downloader for the document-upload feature.
// Used by both the Solo setup ("What will callers ask?") and the full wizard's
// website-scan step, so the template and download behavior stay identical.

// A ready-to-edit template the owner can download, fill in, and re-upload. The
// top is free prose (the AI answers the standard questions from it); the
// **Q:/**A: blocks become their own custom questions verbatim.
export const EXAMPLE_SHEET = `HOW THIS WORKS (replace this whole intro with your own text):
- Write anything about your business as plain text. The assistant uses it to
  answer the standard questions (hours, services, pricing, and so on).
- To add your OWN question and answer, mark them like the examples below: a line
  starting with **Q: then a line starting with **A:.
- An answer can span several lines. A BLANK LINE ends the answer.

We are open Monday through Friday, 9am to 5pm, and closed on weekends and major
holidays. We offer consulting, contract work, and full-time engagements. You can
reach us through this line or leave a message any time.

**Q: What is your cancellation policy?
**A: You can cancel or reschedule up to 24 hours ahead at no charge. Inside 24
hours we ask for a short heads-up so we can offer the slot to someone else.

**Q: Do you work remotely or on-site?
**A: Both. Most work is remote, and on-site is available within the metro area.

**Q: How quickly do you get up to speed on a new project?
**A: Usually a week or two on a new stack. Ask about specific tools and I can be
more precise.
`;

/** Download the example sheet as a .md file the owner can edit and re-upload. */
export function downloadExampleSheet(): void {
  const blob = new Blob([EXAMPLE_SHEET], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'example-knowledge-sheet.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
