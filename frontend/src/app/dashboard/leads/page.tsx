// src/app/dashboard/leads/page.tsx
'use client';

import { useState } from 'react';
import { Users, Mail, Phone, Building2, Download, ExternalLink, Send } from 'lucide-react';
import {
  useChatbots,
  useLeads,
  useUpdateLeadStatus,
  downloadLeadsCsv,
  type Lead,
  type LeadStatus,
} from '../../../hooks/useApi';
import { cn } from '../../../lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

const STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'ARCHIVED'];

const STATUS_STYLES: Record<LeadStatus, string> = {
  NEW: 'bg-primary/10 text-primary',
  CONTACTED: 'bg-green-500/10 text-green-600 dark:text-green-400',
  ARCHIVED: 'bg-muted text-muted-foreground',
};

export default function LeadsPage() {
  const { data: chatbots = [] } = useChatbots();
  const [selectedChatbotId, setSelectedChatbotId] = useState<string>('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const activeChatbotId = selectedChatbotId || chatbots[0]?.id || '';
  const activeChatbot = chatbots.find((b) => b.id === activeChatbotId);
  const { data, isLoading } = useLeads(activeChatbotId);
  const leads = data?.leads ?? [];
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;

  return (
    <div className="flex h-full">
      {/* Left: chatbot picker + lead list */}
      <div className="w-80 border-r border-border flex flex-col shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold">Leads</h1>
            {leads.length > 0 && (
              <button
                onClick={() =>
                  downloadLeadsCsv(activeChatbotId, `leads-${activeChatbot?.name ?? 'export'}.csv`)
                }
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            )}
          </div>
          <select
            value={activeChatbotId}
            onChange={(e) => {
              setSelectedChatbotId(e.target.value);
              setSelectedLeadId(null);
            }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {chatbots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
          {data && (
            <p className="text-xs text-muted-foreground mt-2">
              {data.total} {data.total === 1 ? 'lead' : 'leads'}
              {data.newCount > 0 && ` · ${data.newCount} new`}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No leads captured yet
            </div>
          ) : (
            leads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors',
                  selectedLeadId === lead.id && 'bg-accent',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0 mt-0.5">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {lead.name || lead.email || lead.phone || 'Lead'}
                      </p>
                      <span
                        className={cn(
                          'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0',
                          STATUS_STYLES[lead.status],
                        )}
                      >
                        {lead.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {lead.email || lead.phone || '—'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: lead detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedLead ? (
          <LeadDetail lead={selectedLead} chatbotId={activeChatbotId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select a lead to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeadDetail({ lead, chatbotId }: { lead: Lead; chatbotId: string }) {
  const updateStatus = useUpdateLeadStatus(chatbotId);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 shrink-0">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{lead.name || 'Lead'}</h2>
            <p className="text-xs text-muted-foreground">
              Captured {format(new Date(lead.createdAt), "p '·' MMM d, yyyy")}
            </p>
          </div>
          {lead.syncedAt && (
            <span
              className="ml-auto flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded-full shrink-0"
              title={`Forwarded ${format(new Date(lead.syncedAt), "p '·' MMM d, yyyy")} (email / webhook / sheet)`}
            >
              <Send className="h-3 w-3" />
              Forwarded
            </span>
          )}
        </div>

        {/* Status selector */}
        <div className="flex items-center gap-2 mt-4 mb-6">
          {STATUSES.map((s) => (
            <button
              key={s}
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ leadId: lead.id, status: s })}
              className={cn(
                'text-xs font-medium px-3 py-1.5 rounded-full border transition-colors',
                lead.status === s
                  ? STATUS_STYLES[s] + ' border-transparent'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Field icon={<Mail className="h-4 w-4" />} label="Email">
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                {lead.email}
              </a>
            ) : (
              '—'
            )}
          </Field>
          <Field icon={<Phone className="h-4 w-4" />} label="Phone">
            {lead.phone ? (
              <a href={`tel:${lead.phone}`} className="text-primary hover:underline">
                {lead.phone}
              </a>
            ) : (
              '—'
            )}
          </Field>
          <Field icon={<Building2 className="h-4 w-4" />} label="Company">
            {lead.company || '—'}
          </Field>
          {lead.message && (
            <Field icon={<Mail className="h-4 w-4" />} label="Message">
              <span className="whitespace-pre-wrap">{lead.message}</span>
            </Field>
          )}
          {lead.source && (
            <Field icon={<ExternalLink className="h-4 w-4" />} label="Page">
              <a
                href={lead.source}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline break-all"
              >
                {lead.source}
              </a>
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-foreground break-words">{children}</div>
      </div>
    </div>
  );
}
