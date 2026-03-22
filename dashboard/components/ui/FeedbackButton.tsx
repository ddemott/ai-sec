'use client'

import React, { useState } from 'react'
import { MessageCircle, Star, X, Send } from 'lucide-react'
import { Api } from '../../lib/api'
import { useSession } from '../../lib/hooks'
import { showToast } from './Toast'
import { Button } from './Button'

interface FeedbackButtonProps {
  page: string       // e.g., "Back Office > Services & Resources > Staffing Map"
  context?: string   // optional extra context about what they're looking at
}

export function FeedbackButton({ page, context }: FeedbackButtonProps) {
  const { tenantId } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    if (!comment.trim()) return
    setSaving(true)
    try {
      await Api.feedback.submit(tenantId, {
        page,
        context: context || undefined,
        comment: comment.trim(),
        rating: rating || undefined,
      })
      showToast('Thanks for your feedback!')
      setComment('')
      setRating(null)
      setIsOpen(false)
    } catch {
      showToast('Failed to send feedback', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-full shadow-lg transition-all hover:scale-105"
        title="Send feedback about this page"
      >
        <MessageCircle className="w-5 h-5" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-20 md:bottom-6 right-6 z-50 w-80 bg-white dark:bg-[#222] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
        <div>
          <p className="text-sm font-bold">Send Feedback</p>
          <p className="text-[10px] opacity-70 truncate max-w-[200px]">{page}</p>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/20 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Rating */}
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">How&apos;s this page working for you?</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setRating(rating === n ? null : n)}
                className="p-1 transition-colors"
              >
                <Star
                  className={`w-5 h-5 ${
                    rating && n <= rating
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="What's working? What's confusing? What would you change?"
          rows={3}
          className="w-full p-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-[#1a1a1a] outline-none focus:ring-2 focus:ring-blue-500 resize-none dark:text-gray-200"
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
  )
}
