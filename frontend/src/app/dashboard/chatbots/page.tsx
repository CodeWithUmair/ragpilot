// src/app/dashboard/chatbots/page.tsx
'use client';

import { Bot, ExternalLink, MoreVertical, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useChatbots, useDeleteChatbot } from '../../../hooks/useApi';
import { cn } from '../../../lib/utils';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { CardSkeleton } from '../../../components/ui/skeleton';

export default function ChatbotsPage() {
  const { data: chatbots = [], isLoading } = useChatbots();
  const deleteMutation = useDeleteChatbot();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This also deletes all its knowledge.`)) return;
    setDeletingId(id);
    try {
      await deleteMutation.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 max-w-full mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Chatbots</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your AI chatbots.
          </p>
        </div>
        <Link
          href="/dashboard/chatbots/new"
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chatbot
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : chatbots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg">No chatbots yet</h3>
          <p className="text-muted-foreground text-sm mt-2 mb-6">
            Create your first chatbot by entering a website URL.
          </p>
          <Link
            href="/dashboard/chatbots/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create your first chatbot
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chatbots.map((bot) => (
            <div
              key={bot.id}
              className="group relative rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{bot.name}</p>
                    <a
                      href={bot.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate max-w-[160px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {new URL(bot.url).hostname}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(bot.id, bot.name)}
                  disabled={deletingId === bot.id}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <StatusBadge tone={bot.isTrained ? 'success' : 'warning'}>
                  {bot.isTrained ? '✓ Trained' : 'Not trained'}
                </StatusBadge>

                <Link
                  href={`/dashboard/chatbots/${bot.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Manage →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
