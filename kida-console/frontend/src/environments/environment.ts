export const environment = {
  apiBaseUrl: '/api',
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
