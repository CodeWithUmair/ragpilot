// src/lib/api.ts
import axios from 'axios';
import { config } from './config';
import { getToken, clearToken } from './auth-token';

export const api = axios.create({
  baseURL: `${config.apiUrl}/api`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the bearer token (cross-domain auth without cookies). withCredentials
// stays on so cookie-based auth still works locally.
api.interceptors.request.use((cfg) => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      clearToken();
      window.location.href = '/auth';
    }
    return Promise.reject(error);
  }
);