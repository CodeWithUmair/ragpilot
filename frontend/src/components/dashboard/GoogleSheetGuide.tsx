// src/components/dashboard/GoogleSheetGuide.tsx
//
// Step-by-step "connect your Google Sheet" tutorial shown in a chatbot's lead
// capture settings. Walks the owner through creating the Apps Script web app,
// gives them the exact script with a copy button, and lets them send a test
// row to confirm the wiring before any real lead depends on it.
'use client';

import { useState } from 'react';
import {
  ChevronDown, Copy, Check, ExternalLink, FileSpreadsheet,
  CheckCircle2, XCircle, FlaskConical,
} from 'lucide-react';
import { useTestLeadForward } from '../../hooks/useApi';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

const APPS_SCRIPT_CODE = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Name', 'Email', 'Phone', 'Company', 'Message', 'Page', 'Chatbot']);
  }
  sheet.appendRow([d.createdAt, d.name, d.email, d.phone, d.company, d.message, d.source, d.chatbot]);
  return ContentService.createTextOutput('ok');
}`;

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Create (or open) a Google Sheet',
    body: (
      <>
        Go to{' '}
        <a href="https://sheets.new" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
          sheets.new <ExternalLink className="h-3 w-3" />
        </a>{' '}
        and give the spreadsheet a name like <em>“Chatbot Leads”</em>. You can leave it empty — the
        script adds a header row automatically.
      </>
    ),
  },
  {
    title: 'Open the Apps Script editor',
    body: (
      <>
        In the Sheet&apos;s menu bar click{' '}
        <span className="font-medium text-foreground">Extensions → Apps Script</span>. A new tab
        opens with an empty <code className="text-[11px] bg-muted px-1 py-0.5 rounded">Code.gs</code> file.
      </>
    ),
  },
  {
    title: 'Paste the script',
    body: (
      <>
        Delete anything in the editor, paste the script below (use the copy button), then press the
        💾 save icon.
      </>
    ),
  },
  {
    title: 'Deploy it as a web app',
    body: (
      <>
        Click <span className="font-medium text-foreground">Deploy → New deployment</span>, choose
        the <span className="font-medium text-foreground">Web app</span> type (gear icon), then set:{' '}
        <span className="font-medium text-foreground">Execute as: Me</span> ·{' '}
        <span className="font-medium text-foreground">Who has access: Anyone</span>. Click{' '}
        <span className="font-medium text-foreground">Deploy</span> and authorize when Google asks
        (Advanced → Go to project if you see a warning — it&apos;s your own script).
        <span className="mt-1.5 block rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          ⚠️ <span className="font-semibold">Use a personal @gmail.com account</span>, not a Google
          Workspace one. If your final URL looks like{' '}
          <code className="bg-muted px-1 rounded">script.google.com/a/macros/yourcompany.com/…</code>,
          it&apos;s a Workspace deploy — Google locks it to your organization and our server gets a
          401. A personal Gmail gives a public{' '}
          <code className="bg-muted px-1 rounded">script.google.com/macros/s/…/exec</code> URL.
        </span>
      </>
    ),
  },
  {
    title: 'Copy the web app URL into the field above',
    body: (
      <>
        Copy the URL that ends in <code className="text-[11px] bg-muted px-1 py-0.5 rounded">/exec</code>,
        paste it into the <span className="font-medium text-foreground">Google Sheet</span> field
        above, then hit <span className="font-medium text-foreground">Send test row</span> below.
        A “Test Lead” row should appear in your sheet within a few seconds. Don&apos;t forget to
        save your settings.
      </>
    ),
  },
];

/**
 * Small inline "send a test" button + result note, reused for the webhook URL
 * field and the owner-email notification toggle.
 */
export function ForwardTestButton({
  chatbotId,
  destination,
  url,
  label = 'Send test',
}: {
  chatbotId: string;
  destination: 'email' | 'webhook' | 'sheet' | 'slack' | 'discord' | 'telegram';
  url?: string;
  label?: string;
}) {
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const testForward = useTestLeadForward(chatbotId);

  async function run() {
    setResult(null);
    const r = await testForward.mutateAsync({ destination, url });
    setResult(r);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={testForward.isPending}
        disabled={!['email', 'telegram'].includes(destination) && !url?.trim()}
        onClick={run}
        data-testid={`test-forward-${destination}`}
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {label}
      </Button>
      {result?.ok && (
        <span className="flex items-center gap-1 text-[11px] text-green-500 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> Sent!
        </span>
      )}
      {result && !result.ok && (
        <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
          <XCircle className="h-3.5 w-3.5 shrink-0" /> {result.error ?? 'Failed'}
        </span>
      )}
    </span>
  );
}

export function GoogleSheetGuide({
  chatbotId,
  sheetUrl,
}: {
  chatbotId: string;
  sheetUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const testForward = useTestLeadForward(chatbotId);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select manually */
    }
  }

  async function sendTestRow() {
    setTestResult(null);
    const result = await testForward.mutateAsync({ destination: 'sheet', url: sheetUrl });
    setTestResult(result);
  }

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="sheet-guide-toggle"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
        <span className="text-xs font-medium flex-1">
          How to connect a Google Sheet (step-by-step)
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3" data-testid="sheet-guide-body">
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium">{step.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{step.body}</p>

                  {/* The script block lives under step 3 */}
                  {i === 2 && (
                    <div className="relative mt-2 group">
                      <pre className="bg-muted/60 rounded-md p-2.5 pr-10 overflow-x-auto text-[10px] leading-relaxed whitespace-pre">
                        {APPS_SCRIPT_CODE}
                      </pre>
                      <button
                        type="button"
                        onClick={copyScript}
                        aria-label="Copy script"
                        className="absolute top-1.5 right-1.5 rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-2 pt-1 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={testForward.isPending}
              disabled={!sheetUrl.trim()}
              onClick={sendTestRow}
              data-testid="sheet-test-button"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Send test row
            </Button>
            {!sheetUrl.trim() && (
              <span className="text-[11px] text-muted-foreground">Paste your /exec URL above first.</span>
            )}
            {testResult?.ok && (
              <span className="flex items-center gap-1 text-[11px] text-green-500 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Row sent — check your sheet!
              </span>
            )}
            {testResult && !testResult.ok && (
              <span className="flex items-start gap-1 text-[11px] text-red-500 font-medium">
                <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{testResult.error ?? 'Failed'}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
