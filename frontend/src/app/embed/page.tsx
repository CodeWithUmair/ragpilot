// src/app/embed/page.tsx
import ChatWidget from '../../components/chat/ChatWidget';

type EmbedPageProps = {
  searchParams: Promise<{
    token?: string;
    url?: string;
    parentUrl?: string;
  }>;
};

export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : undefined;
  const url = typeof params.url === 'string' ? params.url : undefined;
  const parentUrl = typeof params.parentUrl === 'string' ? params.parentUrl : undefined;

  return (
    <ChatWidget
      token={token}
      url={url}
      hostPageUrl={parentUrl}
    />
  );
}
