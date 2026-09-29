// src/app/page.tsx
import type { Metadata } from 'next';
import ChatWidget from '../components/chat/ChatWidget';
import { LandingNav } from '../components/landing/LandingNav';
import { Hero } from '../components/landing/Hero';
import { ProblemSolution } from '../components/landing/ProblemSolution';
import { ArchitectureFlow } from '../components/landing/ArchitectureFlow';
import { LiveDemo } from '../components/landing/LiveDemo';
import { LandingFooter } from '../components/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'RagPilot — a chat widget that actually knows your site',
  description:
    'Give RagPilot a URL and it crawls, indexes, and answers your visitors with grounded, cited replies — no hallucinated prices, no wrong pitches, no forgetting the conversation.',
};

// Set after the public demo tenant is trained (docs/ROADMAP.md "Next"):
// NEXT_PUBLIC_DEMO_CHATBOT_TOKEN=<embedToken>. Until then LiveDemo shows a
// graceful "coming soon" instead of mounting a widget with no chatbot behind it.
const DEMO_TOKEN = process.env.NEXT_PUBLIC_DEMO_CHATBOT_TOKEN;

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <LandingNav />
      <main>
        <Hero />
        <ProblemSolution />
        <ArchitectureFlow />
        <LiveDemo demoAvailable={!!DEMO_TOKEN} />
      </main>
      <LandingFooter />
      {DEMO_TOKEN && <ChatWidget token={DEMO_TOKEN} hostPageUrl="https://rag.umairamir.com/" />}
    </div>
  );
}
