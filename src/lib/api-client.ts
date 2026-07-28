import axios from 'axios';

const API_BASE_URL = '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const hadToken = Boolean(localStorage.getItem('token'));
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // Previously this silently cleared the session without telling the
      // user - they'd stay on the current dashboard looking completely
      // normal, only to hit a confusing "Unauthorized" error later when
      // trying an unrelated action (e.g. background polling for
      // notifications got a 401, wiping the token, and the NEXT thing the
      // user actively clicked - like "bulk add employees" - failed with no
      // clear explanation). Now we redirect to login with a clear reason,
      // so the moment the session becomes invalid, the user immediately
      // understands why - instead of silently continuing to use a "logged
      // out" UI until some later action mysteriously fails.
      if (hadToken && window.location.pathname !== '/') {
        sessionStorage.setItem('sessionExpiredMessage', 'Таны нэвтрэлтийн хугацаа дууссан байна. Дахин нэвтэрнэ үү.');
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
