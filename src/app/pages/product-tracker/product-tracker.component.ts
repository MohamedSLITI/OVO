import { Component, OnDestroy, OnInit } from '@angular/core';
import { SettingsMappingService } from '../../@core/services/settings-mapping.service';

@Component({
  selector: 'ngx-product-tracker',
  template: `
    <nb-card>
      <nb-card-header>Product Tracker</nb-card-header>
      <nb-card-body>
        <div class="filters" style="display:flex; gap:12px; align-items:center; margin-bottom:12px;">
          <nb-select placeholder="Select Project" [selected]="selectedProject" (selectedChange)="onProjectChange($event)">
            <nb-option *ngFor="let p of projects" [value]="p">{{ p }}</nb-option>
          </nb-select>
          <input nbInput placeholder="Enter Serial Number" [disabled]="!selectedProject" [(ngModel)]="serialInput" (ngModelChange)="onSerialChange($event)" style="max-width: 240px;" />
        </div>

        <div *ngIf="cycleLife !== null" class="metric" style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <nb-badge text="Cycle Life" status="primary"></nb-badge>
            <span style="font-size:24px; font-weight:600;">{{ cycleLife }}</span>
            <span style="opacity:0.7;">number of testers in project</span>
          </div>
          <nb-stepper #stepper [orientation]="'horizontal'" [(selectedIndex)]="currentPhaseIndex" [disableStepNavigation]="true">
            <nb-step *ngFor="let t of availableTesters; let i = index" [label]="t" [completed]="phaseStatuses[i] === 'passed'">
              <div style="padding:12px;">
                <div style="font-weight:600;">Phase {{ i + 1 }}</div>
                <div style="opacity:0.7;">{{ t }}</div>
                <div style="margin-top:8px;">
                  <nb-badge *ngIf="phaseStatuses[i] === 'passed'" text="Passed" status="success"></nb-badge>
                  <nb-badge *ngIf="phaseStatuses[i] === 'failed'" text="Failed" status="danger"></nb-badge>
                  <nb-badge *ngIf="phaseStatuses[i] === 'pending'" text="Not attended" status="basic"></nb-badge>
                </div>
              </div>
            </nb-step>
          </nb-stepper>
        </div>
        <div *ngIf="cycleLife === null" style="opacity:0.7;">Select project and enter serial to view phase.</div>
      </nb-card-body>
    </nb-card>
  `,
})
export class ProductTrackerComponent implements OnInit, OnDestroy {
  private alive = true;

  projects: string[] = [];
  selectedProject: string = null;
  serialInput: string = '';
  availableTesters: string[] = [];
  cycleLife: number = null;
  currentPhaseIndex: number = 0;
  phaseStatuses: ('passed' | 'failed' | 'pending')[] = [];

  constructor(private mapping: SettingsMappingService) {}

  ngOnInit(): void {
    this.mapping.projects$.subscribe(list => {
      this.projects = list || [];
      if (!this.selectedProject && this.projects.length) {
        this.onProjectChange(this.projects[0]);
      }
    });
  }

  ngOnDestroy(): void {
    this.alive = false;
  }

  onProjectChange(project: string): void {
    this.selectedProject = project;
    this.availableTesters = this.mapping.getTestersFor(project);
    this.serialInput = '';
    this.updateCycleLife();
  }

  onSerialChange(sn: string): void {
    this.serialInput = sn || '';
    this.updateCycleLife();
  }

  updateCycleLife(): void {
    const testers = this.mapping.getTestersFor(this.selectedProject) || [];
    if (this.selectedProject && this.serialInput && testers.length) {
      this.cycleLife = testers.length;
      this.currentPhaseIndex = this.lookupSerialPhaseIndex(this.selectedProject, this.serialInput, testers.length);
      this.phaseStatuses = testers.map((_, i) => {
        if (i < this.currentPhaseIndex) return 'passed';
        if (i === this.currentPhaseIndex) return 'failed';
        return 'pending';
      });
    } else {
      this.cycleLife = null;
      this.phaseStatuses = [];
    }
  }

  private lookupSerialPhaseIndex(project: string, sn: string, len: number): number {
    try {
      const raw = localStorage.getItem('pt_serial_phase_v1') || '{}';
      const store = JSON.parse(raw);
      store[project] = store[project] || {};
      const existing = store[project][sn];
      if (Number.isInteger(existing) && existing >= 0 && existing < len) return existing;
      const code = Array.from(String(sn)).reduce((s, c) => s + c.charCodeAt(0), 0);
      const idx = len ? (code % len) : 0;
      store[project][sn] = idx;
      localStorage.setItem('pt_serial_phase_v1', JSON.stringify(store));
      return idx;
    } catch {
      const code = Array.from(String(sn)).reduce((s, c) => s + c.charCodeAt(0), 0);
      return len ? (code % len) : 0;
    }
  }

}