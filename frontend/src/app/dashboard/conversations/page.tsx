// src/app/dashboard/conversations/page.tsx
'use client';

import { useState } from 'react';
import { MessageSquare, User, Inbox } from 'lucide-react';
import { useChatbots, useSessions, useChatHistory } from '../../../hooks/useApi';
import { cn } from '../../../lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

export default function ConversationsPage() {
  const { data: chatbots = [] } = useChatbots();
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const activeNamespace = selectedNamespace || chatbots[0]?.embedToken || '';
  const { data: sessionsData } = useSessions(activeNamespace);
  const sessions = sessionsData?.sessions ?? [];

  return (
    <div className="flex h-full">
      {/* Left: Chatbot selector + session list */}
      <div className="w-80 border-r border-border flex flex-col shrink-0">
        {/* Chatbot picker */}
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold mb-3">Conversations</h1>
          <select
            value={activeNamespace}
            onChange={(e) => { setSelectedNamespace(e.target.value); setSelectedSession(null); }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {chatbots.map((bot) => (
              <option key={bot.embedToken} value={bot.embedToken}>
                {bot.name}
              </option>
            ))}
          </select>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No conversations yet
            </div>
          ) : (
            sessions.map((session: any) => (
              <button
                key={session.sessionId}
                onClick={() => setSelectedSession(session.sessionId)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors',
                  selectedSession === session.sessionId && 'bg-accent'
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0 mt-0.5">
                    <User className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {session.firstQuestion || 'Visitor'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {session.messageCount} messages
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(session.lastActivityAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: Chat history */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <ChatHistory
            session={sessions.find((s: any) => s.sessionId === selectedSession)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a conversation to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatHistory({ session }: { session: any }) {
  const sessionId = session?.sessionId ?? '';
  const { data: messages = [], isLoading } = useChatHistory(sessionId);

  return (
    <>
      {/* Header — visitor + session metadata */}
      {session && (
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {session.firstQuestion || 'Visitor session'}
              </p>
              <p className="text-xs text-muted-foreground">
                Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}
                {' · '}
                {session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}
                {session.hostPageUrl && (
                  <>
                    {' · '}
                    <a
                      href={session.hostPageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-foreground truncate"
                    >
                      {new URL(session.hostPageUrl).hostname}
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center max-w-sm px-6">
            <Inbox className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No messages recorded</p>
            <p className="text-xs mt-1 leading-relaxed">
              This session was started but the visitor never sent a full
              message, usually because they closed the chat before the bot
              finished responding, or the chat errored out.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.map((msg: any) => (
            <div key={msg.id} className="space-y-2">
              {/* User Q */}
              <div className="flex justify-end">
                <div className="max-w-lg space-y-1">
                  <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {msg.question}
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right pr-2">
                    {format(new Date(msg.createdAt), 'p · MMM d')}
                  </p>
                </div>
              </div>
              {/* Bot A */}
              <div className="flex justify-start">
                <div className="max-w-lg">
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2.5 text-sm whitespace-pre-wrap">
                    {msg.answer || <span className="italic text-muted-foreground">(empty response)</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}