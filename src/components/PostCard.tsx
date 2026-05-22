import { motion } from 'framer-motion';
import { ExternalLink, Heart, MessageCircle } from 'lucide-react';
import type { Post } from '../types';
import { SENTIMENT_META, SOURCE_META } from '../lib/meta';
import { cn, compactNumber, initials, relativeTime } from '../lib/format';

function highlightText(text: string, terms: string[]) {
  const escaped = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return text;
  const re = new RegExp(`(\\$?\\b(?:${escaped.join('|')})\\b)`, 'gi');
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="font-semibold text-brand-300">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface Props {
  post: Post;
  highlightTerms: string[];
  index?: number;
}

export default function PostCard({ post, highlightTerms, index = 0 }: Props) {
  const src = SOURCE_META[post.source];
  const sent = SENTIMENT_META[post.sentiment];

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(index, 12) * 0.035, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="card p-4 transition-colors hover:border-edge sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold',
            src.soft,
            src.color,
          )}
        >
          {initials(post.author)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-fg">{post.author}</span>
            <span className="hidden truncate text-xs text-faint sm:inline">{post.handle}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
            <span className={cn('font-medium', src.color)}>{src.label}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{post.community}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{relativeTime(post.timestamp)}</span>
          </div>
        </div>

        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            sent.soft,
            sent.text,
            sent.border,
          )}
        >
          {sent.label}
        </span>
      </div>

      <p className="mt-3 text-[15px] leading-relaxed text-fg">
        {highlightText(post.text, highlightTerms)}
      </p>

      <div className="mt-4 flex items-center gap-5 text-xs text-faint">
        <span className="inline-flex items-center gap-1.5">
          <Heart className="h-3.5 w-3.5" />
          {compactNumber(post.likes)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" />
          {compactNumber(post.comments)}
        </span>
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:text-brand-300"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View
        </a>
      </div>
    </motion.article>
  );
}
