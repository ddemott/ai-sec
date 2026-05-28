'use client';

import React, { useState } from 'react';
import { MessageCircle, Star, X, Send } from 'lucide-react';
import { Api } from '../../lib/api';
import { useActiveTenantId } from '../../lib/SessionContext';
import { showToast } from './Toast';
import { Button } from './Button';

interface FeedbackButtonProps {
  page: string; // e.g., "My Business > Skill Map"
  context?: string; // optional extra context about what they're looking at
}

export function FeedbackButton({ page, context }: FeedbackButtonProps) {
  const tenantId = useActiveTenantId();
  const [isOpen, setIsOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await Api.feedback.submit(tenantId, {
        page,
        context: context || undefined,
        comment: comment.trim(),
        rating: rating || undefined,
      });
      showToast('Thanks for your feedback!');
      setComment('');
      setRating(null);
      setIsOpen(false);
    } catch {
      showToast('Failed to send feedback', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-20 md:bottom-6 right-6 z-50 hover:opacity-90 pl-3 pr-4 py-2.5 rounded-full shadow-lg transition-all hover:scale-105 flex items-center gap-2"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text, #fff)' }}
      >
        <MessageCircle className="w-4 h-4" aria-hidden="true" />
        <span className="text-xs font-medium">Feedback</span>
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-6 z-50 w-80 rounded-xl shadow-2xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-soft)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--primary-text, #fff)' }}
      >
        <div>
          <p className="text-sm font-bold">Send Feedback</p>
          <p className="text-xs opacity-70 truncate max-w-[200px]">{page}</p>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          aria-label="Close feedback"
          className="p-1 hover:bg-white/20 rounded"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Rating */}
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            How&apos;s this page working for you?
          </p>
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? null : n)}
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="p-1 transition-colors"
              >
                <Star
                  className={`w-5 h-5 ${
                    rating && n <= rating
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What's working? What's confusing? What would you change?"
          aria-label="Feedback comment"
          rows={3}
          className="w-full p-2.5 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-[var(--accent-glow)] focus:border-[var(--accent)] resize-none"
          style={{
            backgroundColor: 'var(--bg-raised)',
            borderColor: 'var(--border-soft)',
            color: 'var(--text-primary)',
          }}
        />

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!comment.trim() || saving}
          isLoading={saving}
          className="w-full"
        >
          {!saving && <Send className="w-4 h-4 mr-2" />}
          Send Feedback
        </Button>
      </div>
    </div>
  );
}
