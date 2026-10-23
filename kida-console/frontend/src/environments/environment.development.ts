export const environment = {
  apiBaseUrl: 'http://127.0.0.1:8000/api',
  endpoints: {
    health: '/health',
    session: '/auth/session',
    login: '/auth/login',
    logout: '/auth/logout',
    csrf: '/auth/csrf',
    admins: '/admins',
    rename: '/admins/me',
    password: '/admins/me/password',
    delete: '/admins/{id}',
  },
};
