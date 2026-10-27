import { MenuConfig, MenuPosition } from 'arca';

export const appMenu: MenuConfig = {
  title: '',
  floatingPosition: MenuPosition.left,
  fixedPosition: MenuPosition.left,
  itemsStyle: '',
  items: [
    { id: 'dashboard', title: 'Dashboard', path: '/dashboard' },
    { id: 'system', title: 'System', path: '/system' },
    { id: 'docker', title: 'Docker', path: '/docker' },
    { id: 'backups', title: 'Backups', path: '/backups' },
    { id: 'scheduler', title: 'Scheduler', path: '/scheduler' },
    { id: 'administrators', title: 'Administradores', path: '/administrators' },
    { id: 'settings', title: 'Settings', path: '/settings' },
  ],
};
