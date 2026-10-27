import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Platform } from '@ionic/angular';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('hosts routed pages', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideRouter([])],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Platform), 'ready').mockResolvedValue('dom');
    const fixture = TestBed.createComponent(App);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('arca-core ion-router-outlet')).toBeTruthy();
    const menuItems = fixture.nativeElement.querySelectorAll('arca-menu-item');
    expect(Array.from(menuItems, (item) => (item as HTMLElement).textContent?.trim())).toEqual([
      'Dashboard',
      'System',
      'Docker',
      'Backups',
      'Scheduler',
      'Administradores',
      'Settings',
    ]);
    expect(fixture.nativeElement.textContent).not.toContain('Congratulations');
  });
});
