'use client';

import React, { useState, useCallback } from 'react';
import { Api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { STARTER_IDS, STARTER_QUESTIONS } from './Step7CallerQuestions';

interface Props {
  tenantId: string | null;
}

export function Step7WebsiteScan({ tenantId }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    if (!url || !tenantId) return;
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res: any = await Api.knowledge.importWebsite(tenantId, url);
      if (res?.success && res?.extracted && Array.isArray(res.extracted)) {
        let filled = 0;
        for (const item of res.extracted) {
          if (item.questionId && STARTER_IDS.includes(item.questionId) && item.answer) {
            const q = STARTER_QUESTIONS.find((sq) => sq.id === item.questionId);
            if (q) {
              await Api.knowledge.add(tenantId, {
                question: item.question || q.question,
                answer: item.answer,
                category: q.category,
              });
              filled++;
            }
          }
        }
        setMessage(
          `Great! We extracted and saved ${filled} answer${filled === 1 ? '' : 's'} from your website. Head to the next step to review and adjust them.`
        );
      } else {
        setMessage(
          res?.message ||
            'Scan completed but no matching answers were found for the starter questions. You can still answer them manually in the next step.'
        );
      }
    } catch (e: any) {
      setError(
        'Could not scan the website. Check the URL and try again, or skip to manual answers.'
      );
      console.error('Website scan error', e);
    } finally {
      setLoading(false);
    }
  }, [url, tenantId]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          Import from your website (optional, recommended)
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          This is where your AI Assistant gets its knowledge about your company. When questions are
          asked of your AI Assistant, the information from your company comes from here.
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Our system will scan your website to get as much information as possible. The following
          page is to answer any questions that were not answered by the website.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">Your website URL</label>
          <Input
            type="url"
            placeholder="https://www.yourbusiness.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            className="mt-1"
          />
        </div>

        <Button
          onClick={handleScan}
          disabled={!url || loading}
          isLoading={loading}
          variant="primary"
        >
          Scan website &amp; pre-fill answers
        </Button>

        {message && (
          <p className="text-sm" style={{ color: 'var(--accent-soft)' }}>
            {message}
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          We only look at public pages (homepage, about, services, contact, policies, etc.). Your
          data stays private. You can always edit the answers in the next step.
        </p>
      </div>
    </div>
  );
}
