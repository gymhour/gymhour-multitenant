import axios from 'axios';
import CLIENT_SETUP from '../setup';

const platformApi = axios.create({ baseURL: CLIENT_SETUP.apiUrl, withCredentials: true });
let csrfToken = sessionStorage.getItem('platformCsrf') || '';

export const setPlatformCsrf = token => {
  csrfToken = token || '';
  if (csrfToken) sessionStorage.setItem('platformCsrf', csrfToken);
  else sessionStorage.removeItem('platformCsrf');
};

platformApi.interceptors.request.use(config => {
  if (csrfToken && !['get', 'head', 'options'].includes(String(config.method).toLowerCase())) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

platformApi.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && !String(error.config?.url).includes('/auth/')) {
    setPlatformCsrf('');
    window.dispatchEvent(new Event('platform-session-expired'));
  }
  return Promise.reject(error);
});

export default platformApi;
