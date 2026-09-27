// src/hooks/useApi.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api } from '../lib/api';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Chatbot {
  id: string;
  name: string;
  url: string;
  embedToken: string;
  status: 'ACTIVE' | 'TRAINING' | 'INACTIVE';
  isTrained: boolean;
  lastTrainedAt: string | null;
  systemPrompt: string | null;
  personalityType: string | null;
  welcomeMessage: string | null;
  themeColor: string | null;
  primaryColor: string | null;
  widgetTheme: 'light' | 'dark' | 'auto';
  widgetWidth: number;
  widgetHeight: number;
  logoUrl: string | null;
  headerColor: string | null;
  botAvatar: string | null;
  inputPlaceholder: string | null;
  showPoweredBy: boolean;
  leadConfig?: LeadConfig | null;
  categories: ChatbotCategory[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatbotCategory {
  id: string;
  name: string;
  pages: number;
  enabled: boolean;
  indexed: boolean;
}

export type LeadField = 'name' | 'email' | 'phone' | 'company';

export interface LeadConfig {
  enabled: boolean;
  fields: LeadField[];
  required: LeadField[];
  heading: string;
  successMessage: string;
  notifyEmail: boolean;
  webhookUrl?: string;
  sheetUrl?: string;
}

export const DEFAULT_LEAD_CONFIG: LeadConfig = {
  enabled: false,
  fields: ['name', 'email', 'phone'],
  required: ['email'],
  heading: 'Want our team to follow up? Leave your details:',
  successMessage: 'Thanks! Our team will get back to you shortly.',
  notifyEmail: true,
  webhookUrl: '',
  sheetUrl: '',
};

export type LeadStatus = 'NEW' | 'CONTACTED' | 'ARCHIVED';

export interface Lead {
  id: string;
  chatbotId: string;
  namespace: string;
  sessionId: string | null;
  visitorId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  source: string | null;
  status: LeadStatus;
  syncedAt: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  plan: 'free' | 'pro';
  messageUsage: number;
  messageLimit: number;
  chatbotCount: number;
  isAdmin: boolean;
  onboardingCompleted: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  plan: 'free' | 'pro';
  messageUsage: number;
  messageLimit: number;
  chatbotCount: number;
  createdAt: string;
}

export interface AnalyticsSeriesPoint {
  date: string; // YYYY-MM-DD
  conversations: number;
  messages: number;
  leads: number;
}

export interface Analytics {
  range: { from: string; to: string };
  totals: {
    conversations: number;
    messages: number;
    leads: number;
    visitors: number;
    conversionRate: number;
  };
  previous: { conversations: number; messages: number; leads: number };
  series: AnalyticsSeriesPoint[];
  hourly: { hour: number; messages: number }[];
  leadStatus: { status: LeadStatus; count: number }[];
  topQuestions: { question: string; count: number }[];
  topPages: { page: string; count: number }[];
  bots: { id: string; name: string; conversations: number; leads: number }[];
}

export interface AnalyticsFilters {
  chatbotId: string; // 'all' or a chatbot id
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const queryKeys = {
  me: ['me'] as const,
  chatbots: ['chatbots'] as const,
  chatbot: (id: string) => ['chatbots', id] as const,
  sessions: (namespace: string) => ['sessions', namespace] as const,
  chatHistory: (sessionId: string) => ['chat-history', sessionId] as const,
  leads: (chatbotId: string) => ['leads', chatbotId] as const,
  adminUsers: (search: string) => ['admin', 'users', search] as const,
  analytics: (f: AnalyticsFilters) => ['analytics', f.chatbotId, f.from ?? '', f.to ?? ''] as const,
};

// ─── User hooks ───────────────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<User> => {
      const { data } = await api.get('/users/me');
      return data.user;
    },
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string }) => api.patch('/users/me', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Profile updated');
    },
  });
}

// Self-serve plan flip — dev-only on the backend (POST /users/me/plan is
// gated by NODE_ENV !== 'production'). Lets the logged-in user upgrade
// themselves to Pro (or downgrade to Free) without checkout or admin.
export function useUpdateMyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: 'free' | 'pro') => api.post('/users/me/plan', { plan }),
    onSuccess: (_, plan) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success(plan === 'pro' ? 'Upgraded to Pro' : 'Switched to Free');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to update plan');
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/users/complete-onboarding'),
    onSuccess: () => {
      // Write the new flag straight into the cache so the very next render
      // (e.g. after router.replace('/dashboard')) reads onboardingCompleted=true.
      // Without this the dashboard layout reads stale cache, bounces to
      // /onboarding, and the user sees the wizard flash before /onboarding's
      // own layout sends them back. Fire-and-forget invalidate keeps the
      // background revalidation honest.
      queryClient.setQueryData<User | undefined>(queryKeys.me, (old) =>
        old ? { ...old, onboardingCompleted: true } : old,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

// ─── Chatbot hooks ────────────────────────────────────────────────────────────

export function useChatbots() {
  return useQuery({
    queryKey: queryKeys.chatbots,
    queryFn: async (): Promise<Chatbot[]> => {
      const { data } = await api.get('/chatbots');
      return data.chatbots;
    },
  });
}

export function useChatbot(id: string) {
  return useQuery({
    queryKey: queryKeys.chatbot(id),
    queryFn: async (): Promise<{ chatbot: Chatbot; vectorCount: number }> => {
      const { data } = await api.get(`/chatbots/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export interface CreateChatbotPayload {
  url: string;
  name?: string;
  systemPrompt?: string;
  personalityType?: string;
  welcomeMessage?: string;
  themeColor?: string;
  primaryColor?: string;
  widgetTheme?: 'light' | 'dark' | 'auto';
  widgetWidth?: number;
  widgetHeight?: number;
  showPoweredBy?: boolean;
  inputPlaceholder?: string;
}

export function useCreateChatbot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateChatbotPayload) => api.post('/chatbots', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbots });
      toast.success('Chatbot created');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to create chatbot');
    },
  });
}

export function useUpdateChatbot(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Omit<Chatbot, 'id' | 'embedToken' | 'userId' | 'createdAt' | 'updatedAt' | 'categories'>>) =>
      api.patch(`/chatbots/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbot(id) });
      toast.success('Chatbot updated');
    },
  });
}

export function useDeleteChatbot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/chatbots/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbots });
      toast.success('Chatbot deleted');
    },
  });
}

export function useSaveCategories(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      categories: ChatbotCategory[];
      isTrained?: boolean;
      lastTrainedAt?: string;
    }) => api.post(`/chatbots/${id}/categories`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbot(id) });
      toast.success('Categories saved');
    },
  });
}

export function useResetKnowledge(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/chatbots/${id}/reset-knowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbot(id) });
      toast.success('Knowledge reset');
    },
  });
}

// ─── Scrape hooks ─────────────────────────────────────────────────────────────

export function useDiscoverCategories() {
  return useMutation({
    mutationFn: (url: string) =>
      api.get('/scrape', { params: { url } }).then((r) => r.data),
  });
}

export function useIndexCategories() {
  return useMutation({
    mutationFn: ({
      url,
      categories,
    }: {
      url: string;
      categories: string[];
    }) =>
      api
        .get('/scrape', { params: { url, categories: categories.join(',') } })
        .then((r) => r.data),
  });
}

export function useUploadFile() {
  return useMutation({
    mutationFn: ({ namespace, file }: { namespace: string; file: File }) => {
      const formData = new FormData();
      formData.append('namespace', namespace);
      formData.append('file', file);
      return api.post('/scrape/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => toast.success('File indexed successfully'),
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? 'Failed to index file'),
  });
}

// ─── Chat history hooks ───────────────────────────────────────────────────────

export function useChatHistory(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.chatHistory(sessionId),
    queryFn: async () => {
      const { data } = await api.get(`/chat/history/${sessionId}`);
      return data.messages;
    },
    enabled: !!sessionId,
  });
}

export function useSessions(namespace: string) {
  return useQuery({
    queryKey: queryKeys.sessions(namespace),
    queryFn: async () => {
      const { data } = await api.get(`/sessions/${namespace}`);
      return data;
    },
    enabled: !!namespace,
  });
}

// ─── Lead hooks ───────────────────────────────────────────────────────────────

export function useLeads(chatbotId: string) {
  return useQuery({
    queryKey: queryKeys.leads(chatbotId),
    queryFn: async (): Promise<{ leads: Lead[]; total: number; newCount: number }> => {
      const { data } = await api.get(`/chatbots/${chatbotId}/leads`);
      return data;
    },
    enabled: !!chatbotId,
  });
}

export function useUpdateLeadStatus(chatbotId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, status }: { leadId: string; status: LeadStatus }) =>
      api.patch(`/chatbots/${chatbotId}/leads/${leadId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.leads(chatbotId) });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to update lead');
    },
  });
}

/** Fetch the leads CSV (with auth) and trigger a browser download. */
export async function downloadLeadsCsv(chatbotId: string, filename = 'leads.csv') {
  const res = await api.get(`/chatbots/${chatbotId}/leads/export`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Analytics hooks ──────────────────────────────────────────────────────────

export function useAnalytics(filters: AnalyticsFilters) {
  return useQuery({
    queryKey: queryKeys.analytics(filters),
    queryFn: async (): Promise<Analytics> => {
      const { data } = await api.get('/analytics', {
        params: {
          chatbotId: filters.chatbotId,
          ...(filters.from ? { from: filters.from } : {}),
          ...(filters.to ? { to: filters.to } : {}),
        },
      });
      return data;
    },
    placeholderData: (prev) => prev, // keep charts mounted while filters change
  });
}

/** Send a sample lead to one forwarding destination to verify the wiring. */
export function useTestLeadForward(chatbotId: string) {
  return useMutation({
    mutationFn: async ({ destination, url }: { destination: 'email' | 'webhook' | 'sheet'; url?: string }) => {
      try {
        const { data } = await api.post(`/chatbots/${chatbotId}/leads/test-forward`, { destination, url });
        return data as { ok: boolean; error?: string };
      } catch (err: any) {
        // The backend answers 502 with { ok:false, error } when the destination
        // rejects the test — surface that as a result, not an exception.
        const data = err?.response?.data;
        if (data && typeof data.ok === 'boolean') return data as { ok: boolean; error?: string };
        throw err;
      }
    },
  });
}

// ─── Admin hooks ──────────────────────────────────────────────────────────────

export function useAdminUsers(search = '') {
  return useQuery({
    queryKey: queryKeys.adminUsers(search),
    queryFn: async (): Promise<{ users: AdminUser[]; total: number }> => {
      const { data } = await api.get('/admin/users', { params: { search } });
      return data;
    },
  });
}

export function useSetUserPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, plan }: { userId: string; plan: 'free' | 'pro' }) =>
      api.patch(`/admin/users/${userId}/plan`, { plan }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Plan updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error ?? 'Failed to update plan');
    },
  });
}

export function useResetUserUsage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/reset-usage`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success('Usage reset');
    },
  });
}
