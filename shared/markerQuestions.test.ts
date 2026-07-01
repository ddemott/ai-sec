import { describe, it, expect } from 'vitest';
import { parseMarkerQuestions } from './markerQuestions';

describe('parseMarkerQuestions', () => {
  it('parses a single well-formed block', () => {
    const r = parseMarkerQuestions('**Q: Do you sell gift cards?\n**A: Yes, any amount.');
    expect(r.custom).toEqual([{ question: 'Do you sell gift cards?', answer: 'Yes, any amount.' }]);
    expect(r.malformed).toEqual([]);
  });

  it('joins a multi-line question up to the **A: line', () => {
    const r = parseMarkerQuestions(
      '**Q: What is your\ncancellation policy?\n**A: 24 hours notice.'
    );
    expect(r.custom[0].question).toBe('What is your cancellation policy?');
    expect(r.custom[0].answer).toBe('24 hours notice.');
  });

  it('treats the answer as a continuous block ended by a blank line', () => {
    const r = parseMarkerQuestions(
      '**Q: Hours?\n**A: Mon-Fri 9-5.\nWeekends closed.\n\nignored prose'
    );
    expect(r.custom[0].answer).toBe('Mon-Fri 9-5.\nWeekends closed.');
    expect(r.prose).toContain('ignored prose');
  });

  it('parses multiple blocks', () => {
    const r = parseMarkerQuestions('**Q: A?\n**A: 1.\n\n**Q: B?\n**A: 2.');
    expect(r.custom).toEqual([
      { question: 'A?', answer: '1.' },
      { question: 'B?', answer: '2.' },
    ]);
  });

  it('reports a **Q: with no **A: as malformed (not dropped)', () => {
    const r = parseMarkerQuestions('**Q: Orphan question?\n\n**Q: Real?\n**A: yes');
    expect(r.malformed).toEqual(['Orphan question?']);
    expect(r.custom).toEqual([{ question: 'Real?', answer: 'yes' }]);
  });

  it('ends an orphan question at a blank line; trailing text is prose, not part of it', () => {
    const r = parseMarkerQuestions('**Q: Orphan?\n\nsome prose');
    expect(r.malformed).toEqual(['Orphan?']);
    expect(r.custom).toEqual([]);
    expect(r.prose).toContain('some prose');
  });

  it('ignores a **A: with no preceding **Q:', () => {
    const r = parseMarkerQuestions('**A: stray answer\nsome prose');
    expect(r.custom).toEqual([]);
    expect(r.malformed).toEqual([]);
  });

  it('is case- and whitespace-tolerant and handles CRLF', () => {
    const r = parseMarkerQuestions('  ** q :  Spaced?\r\n** a : Yes.\r\n');
    expect(r.custom).toEqual([{ question: 'Spaced?', answer: 'Yes.' }]);
  });

  it('returns all text as prose when there are no markers', () => {
    const r = parseMarkerQuestions('Just hours and services, no markers.');
    expect(r.custom).toEqual([]);
    expect(r.malformed).toEqual([]);
    expect(r.prose.trim()).toBe('Just hours and services, no markers.');
  });
});
