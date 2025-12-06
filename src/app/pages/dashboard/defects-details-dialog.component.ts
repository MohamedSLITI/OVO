import { Component, Input } from '@angular/core';
import { NbDialogRef } from '@nebular/theme';

@Component({
  selector: 'ngx-defects-details-dialog',
  template: `
    <nb-card>
      <nb-card-header>
        Defect Details • {{ projectName }}
      </nb-card-header>
      <nb-card-body>
        <div class="summary-row">
          <div class="metric">
            <div class="label">Avg FPY</div>
            <div class="value success">{{ avgFpy | number: '1.0-1' }}%</div>
          </div>
          <div class="metric">
            <div class="label">Defects</div>
            <div class="value danger">{{ defectRate | number: '1.0-1' }}%</div>
          </div>
        </div>

        <div class="section-title">Tester Breakdown</div>
        <nb-list>
          <nb-list-item *ngFor="let t of riskyTesters">
            <div class="tester-row">
              <div class="tester-name">{{ t.tester }}</div>
              <div class="tester-metrics">
                <span class="fpy">FPY: {{ t.avgFpy | number: '1.0-1' }}%</span>
                <span class="defects">Defects: {{ t.defectShare | number: '1.0-1' }}%</span>
              </div>
            </div>
          </nb-list-item>
        </nb-list>
      </nb-card-body>
      <nb-card-footer>
        <button nbButton status="primary" fullWidth (click)="close()">Close</button>
      </nb-card-footer>
    </nb-card>
  `,
  styleUrls: ['./defects-details-dialog.component.scss'],
})
export class DefectsDetailsDialogComponent {
  @Input() projectName: string = '';
  @Input() avgFpy: number = 0;
  @Input() testers: { tester: string; avgFpy: number }[] = [];

  constructor(private dialogRef: NbDialogRef<DefectsDetailsDialogComponent>) {}

  get defectRate(): number {
    return Math.max(0, 100 - Number(this.avgFpy || 0));
  }

  get riskyTesters(): { tester: string; defectShare: number; avgFpy: number }[] {
    const items = (this.testers || []).map(t => ({
      tester: t.tester,
      avgFpy: t.avgFpy,
      defectShare: Math.max(0, 100 - t.avgFpy),
    }));
    return items.sort((a, b) => b.defectShare - a.defectShare);
  }

  close(): void {
    this.dialogRef.close();
  }
}