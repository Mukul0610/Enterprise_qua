'use client';

import React, { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { downloadQuoteAttachment } from '@/lib/rfqClient';
import type { RFQQuoteAttachment } from '@/lib/types';

export default function QuoteAttachmentLink({
  rfqId,
  attachment,
}: {
  rfqId: string;
  attachment: RFQQuoteAttachment;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const prepareDownload = async () => {
    setBusy(true);
    setError('');
    const result = await downloadQuoteAttachment(rfqId, attachment);
    setBusy(false);
    if (!result.success || !result.url) {
      setError(result.error || 'Download unavailable.');
      return;
    }
    setUrl(result.url);
  };

  if (url) {
    return (
      <a
        href={url}
        download={attachment.fileName}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
      >
        <Paperclip size={11} className="shrink-0" />
        <span className="truncate">{attachment.fileName}</span>
      </a>
    );
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={busy}
        onClick={() => void prepareDownload()}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 px-2 py-1 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 hover:underline disabled:opacity-60"
      >
        <Paperclip size={11} className="shrink-0" />
        <span className="truncate">{busy ? 'Preparing…' : attachment.fileName}</span>
      </button>
      {error && <span role="alert" className="mt-1 text-[10px] text-rose-600">{error}</span>}
    </span>
  );
}
