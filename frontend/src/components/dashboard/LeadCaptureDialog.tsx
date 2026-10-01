'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/InfoTip';
import { GoogleSheetGuide, ForwardTestButton } from '@/components/dashboard/GoogleSheetGuide';
import type { LeadField } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

export interface LeadConfigState {
  enabled: boolean;
  fields: LeadField[];
  heading: string;
  successMessage: string;
  notifyEmail: boolean;
  webhookUrl: string;
  sheetUrl: string;
  slackWebhookUrl: string;
  discordWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
}

const LEAD_FIELDS: LeadField[] = ['name', 'email', 'phone', 'company'];
const INPUT =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed';

function Label({ text, tip }: { text: string; tip?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <label className="text-xs font-medium text-muted-foreground">{text}</label>
      {tip && <InfoTip>{tip}</InfoTip>}
    </div>
  );
}

export function LeadCaptureDialog({
  open, onOpenChange, chatbotId, config, setConfig, saving, onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatbotId: string;
  config: LeadConfigState;
  setConfig: Dispatch<SetStateAction<LeadConfigState>>;
  saving: boolean;
  onSave: () => void;
}) {
  const set = <K extends keyof LeadConfigState>(key: K, value: LeadConfigState[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lead form</DialogTitle>
          <DialogDescription>What visitors fill in, and where you hear about it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label text="Ask visitors for" tip="Shown when a visitor shows interest. An email or phone is always required so you can reply." />
            <div className="flex flex-wrap gap-2">
              {LEAD_FIELDS.map((f) => {
                const on = config.fields.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => set('fields', on ? config.fields.filter((x) => x !== f) : [...config.fields, f])}
                    className={cn(
                      'text-xs font-medium px-3 py-1.5 rounded-full border capitalize transition-colors',
                      on ? 'bg-primary/10 text-primary border-transparent' : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label text="Form title" />
            <input value={config.heading} onChange={(e) => set('heading', e.target.value)} disabled={saving} className={INPUT} />
          </div>
          <div>
            <Label text="Thank-you message" tip="Shown to the visitor right after they send the form." />
            <input value={config.successMessage} onChange={(e) => set('successMessage', e.target.value)} disabled={saving} className={INPUT} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={config.notifyEmail} onChange={(e) => set('notifyEmail', e.target.checked)} />
              Email me each new lead
            </label>
            {config.notifyEmail && <ForwardTestButton chatbotId={chatbotId} destination="email" label="Send test email" />}
          </div>

          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
              Send leads to other apps (optional)
            </summary>
            <div className="space-y-4 border-t border-border p-3">
              <div>
                <Label text="Webhook" tip="Zapier, Make, n8n or any CRM that accepts a webhook URL." />
                <div className="flex items-center gap-2">
                  <input type="url" placeholder="https://hooks.zapier.com/..." value={config.webhookUrl}
                    onChange={(e) => set('webhookUrl', e.target.value)} disabled={saving} className={INPUT} />
                  <ForwardTestButton chatbotId={chatbotId} destination="webhook" url={config.webhookUrl} />
                </div>
              </div>
              <div>
                <Label text="Google Sheet" tip="Paste the web-app URL from the Apps Script. The guide below walks you through it." />
                <input type="url" placeholder="https://script.google.com/macros/s/.../exec" value={config.sheetUrl}
                  onChange={(e) => set('sheetUrl', e.target.value)} disabled={saving} className={INPUT} />
                <div className="mt-2">
                  <GoogleSheetGuide chatbotId={chatbotId} sheetUrl={config.sheetUrl} />
                </div>
              </div>
              <div>
                <Label text="Slack" tip="An Incoming Webhook URL from your Slack workspace." />
                <div className="flex items-center gap-2">
                  <input type="url" placeholder="https://hooks.slack.com/services/..." value={config.slackWebhookUrl}
                    onChange={(e) => set('slackWebhookUrl', e.target.value)} disabled={saving} className={INPUT} />
                  <ForwardTestButton chatbotId={chatbotId} destination="slack" url={config.slackWebhookUrl} />
                </div>
              </div>
              <div>
                <Label text="Discord" tip="A webhook URL from your Discord channel's Integrations settings." />
                <div className="flex items-center gap-2">
                  <input type="url" placeholder="https://discord.com/api/webhooks/..." value={config.discordWebhookUrl}
                    onChange={(e) => set('discordWebhookUrl', e.target.value)} disabled={saving} className={INPUT} />
                  <ForwardTestButton chatbotId={chatbotId} destination="discord" url={config.discordWebhookUrl} />
                </div>
              </div>
              <div>
                <Label text="Telegram" tip="Your bot token and the chat ID to message. Tests use what's saved, so press Save first." />
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Bot token" value={config.telegramBotToken}
                    onChange={(e) => set('telegramBotToken', e.target.value)} disabled={saving} className={INPUT} />
                  <input type="text" placeholder="Chat ID" value={config.telegramChatId}
                    onChange={(e) => set('telegramChatId', e.target.value)} disabled={saving} className={cn(INPUT, 'w-28')} />
                  <ForwardTestButton chatbotId={chatbotId} destination="telegram" label="Test" />
                </div>
              </div>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onSave} loading={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
