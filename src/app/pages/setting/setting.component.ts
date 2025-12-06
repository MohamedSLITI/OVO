import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NbToastrService } from '@nebular/theme';
import { LocalDataSource } from 'ng2-smart-table';
import { SettingsMappingService } from '../../@core/services/settings-mapping.service';
import { ProcessingService, ProcessJobStatus } from '../../@core/services/processing.service';

@Component({
  selector: 'ngx-setting',
  styleUrls: ['./setting.component.scss'],
  templateUrl: './setting.component.html',
})
export class SettingComponent implements OnInit, OnDestroy {
  settings = {
    actions: {
      add: true,
      edit: true,
      delete: true,
    },
    add: {
      addButtonContent: '<i class="nb-plus"></i>',
      createButtonContent: '<i class="nb-checkmark"></i>',
      cancelButtonContent: '<i class="nb-close"></i>',
      confirmCreate: true,
    },
    edit: {
      editButtonContent: '<i class="nb-edit"></i>',
      saveButtonContent: '<i class="nb-checkmark"></i>',
      cancelButtonContent: '<i class="nb-close"></i>',
      confirmSave: true,
    },
    delete: {
      deleteButtonContent: '<i class="nb-trash"></i>',
      confirmDelete: true,
    },
    columns: {
      id: {
        title: 'ID',
        type: 'number',
        editable: false,
        addable: false,
        sort: true,
        sortDirection: 'asc',
      },
      productionSite: {
        title: 'Production Site',
        type: 'string',
      },
      client: {
        title: 'Client',
        type: 'string',
      },
      project: {
        title: 'Project *',
        type: 'string',
      },
      tester: {
        title: 'Tester *',
        type: 'string',
      },
      fileRepository: {
        title: 'Log File Repository *',
        type: 'string',
      },
      flow: {
        title: 'Flow',
        type: 'string',
      },
    },
  };

  source: LocalDataSource = new LocalDataSource([]);
  // Processing controls
  projects: string[] = [];
  testers: string[] = [];
  selectedProject: string | null = null;
  selectedTester: string | null = null;
  // Week-of-year controls
  startWeek: number = 1; // 1–53
  startYear: number = new Date().getFullYear();
  processAll = false;
  isProcessing = false;
  // Batch processing state
  isBatch = false;
  batchQueue: any[] = [];
  currentBatchIndex = 0;
  jobStatuses: ProcessJobStatus[] = [];
  progressMessages: string[] = [];
  progressPercent: number = 0;
  progressLabel: string = '';
  progressStatus: string = 'primary';
  processStartAt?: number;
  elapsedLabel: string = '';
  private elapsedTimer?: any;
  private statusTimer: any;
  hasSettingsData: boolean = false;
  etaLabel: string = '';
  private processEndAt?: number;
  apiBase: string = localStorage.getItem('apiBase') || 'http://127.0.0.1:5000';

  private API_URL = 'http://127.0.0.1:5000/setting';

  constructor(
    private http: HttpClient,
    private toastr: NbToastrService,
    private mapping: SettingsMappingService,
    private processing: ProcessingService,
  ) {}

  ngOnInit(): void {
    this.loadInitialData();
    // Subscribe to mapping to populate selectors
    this.mapping.projects$.subscribe((p) => {
      this.projects = p;
      this.hasSettingsData = Array.isArray(p) && p.length > 0;
    });
    this.mapping.testers$.subscribe((t) => (this.testers = t));
    const now = new Date();
    const { week, year } = this.computeIsoWeekNumber(now);
    this.startWeek = week;
    this.startYear = year;
  }

  saveApiBase(): void {
    const v = String(this.apiBase || '').trim();
    if (!v) {
      this.toastr.warning('API Base cannot be empty', 'Warning');
      return;
    }
    localStorage.setItem('apiBase', v);
    this.toastr.success('API Base saved', 'Success');
  }

  ngOnDestroy(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.stopElapsedTimer();
  }

  async onProcessFiles(): Promise<void> {
    if (this.isProcessing) return;
    if (this.processAll) {
      // Build a queue of jobs from table rows
      try {
        const rows = await this.source.getAll();
        this.batchQueue = rows
          .map(r => ({
            project: String(r.project || '').trim(),
            tester: String(r.tester || '').trim(),
            fileRepository: String(r.fileRepository || '').trim(),
            startWeek: this.startWeek,
            startYear: this.startYear,
          }))
          .filter(x => !!x.project && !!x.tester);
      } catch (_) {
        this.batchQueue = [];
      }
      if (!this.batchQueue.length) {
        this.toastr.warning('No valid rows to process', 'Warning');
        return;
      }
      this.isBatch = true;
      this.isProcessing = true;
      this.currentBatchIndex = 0;
      this.progressMessages = [];
      this.progressPercent = 0;
      this.progressLabel = '';
      this.progressStatus = 'primary';
      this.processStartAt = Date.now();
      this.startElapsedTimer();
      this.startStatusPolling();
      this.runNextBatchJob();
      return;
    }

    // Single job payload
    const payload: any = {};
    if (this.selectedProject) payload.project = this.selectedProject;
    if (this.selectedTester) payload.tester = this.selectedTester;
    // Resolve corresponding log repository for selected tester
    try {
      const rows = await this.source.getAll();
      const match = rows.find(r => String(r.project || '').trim() === String(this.selectedProject || '').trim()
        && String(r.tester || '').trim() === String(this.selectedTester || '').trim());
      const repo = match?.fileRepository ? String(match.fileRepository).trim() : '';
      if (repo) payload.fileRepository = repo;
    } catch (_) {
      // Non-blocking; if source fails, skip repository
    }
    payload.startWeek = this.startWeek;
    payload.startYear = this.startYear;
    this.isBatch = false;
    this.isProcessing = true;
    this.progressMessages = [];
    this.progressPercent = 0;
    this.progressLabel = '';
    this.progressStatus = 'primary';
    this.processStartAt = Date.now();
    this.startElapsedTimer();
    this.startStatusPolling();
    this.startSingleJob(payload);
  }

  async onProcessSingle(): Promise<void> {
    if (this.isProcessing) return;
    this.processAll = false;
    await this.onProcessFiles();
  }

  async onProcessBatch(): Promise<void> {
    if (this.isProcessing) return;
    this.processAll = true;
    await this.onProcessFiles();
  }

  private startSingleJob(payload: any): void {
    this.processing.triggerProcessStream(payload).subscribe({
      next: (msg: string) => {
        this.progressMessages.push(msg);
        this.updateProgressFromMessage(msg);
        this.updateElapsedLabel();
        this.updateEtaFromProgress();
      },
      error: (err) => {
        const status = err?.status;
        const message = err?.message || err?.error?.message || err?.error || 'Failed to start processing';
        if (status === 404 && /no folders/i.test(String(message))) {
          this.toastr.warning(message, 'No Folders');
          this.progressStatus = 'warning';
          this.progressLabel = 'No folders found';
        } else {
          this.toastr.danger(message, 'Error');
          this.progressStatus = 'danger';
        }
        if (this.isBatch) {
          this.currentBatchIndex += 1;
          this.runNextBatchJob();
        } else {
          this.isProcessing = false;
        }
        this.stopElapsedTimer();
      },
      complete: () => {
        this.progressPercent = 100;
        this.progressLabel = 'Completed';
        this.progressStatus = 'success';
        this.processEndAt = Date.now();
        this.stopElapsedTimer();
        if (this.isBatch) {
          // Move to the next queued job
          const label = `${payload.project || ''}/${payload.tester || ''}`.replace(/^\//, '');
          this.toastr.success(`Completed ${label}`, 'Done');
          this.currentBatchIndex += 1;
          this.runNextBatchJob();
        } else {
          this.isProcessing = false;
          this.toastr.success('Processing completed', 'Done');
          this.loadInitialData();
        }
      },
    });
  }

  private runNextBatchJob(): void {
    if (!this.isBatch) return;
    if (this.currentBatchIndex >= this.batchQueue.length) {
      // All done
      this.isProcessing = false;
      this.toastr.success('All repositories processed', 'Done');
      this.loadInitialData();
      return;
    }
    const nextPayload = { ...this.batchQueue[this.currentBatchIndex] };
    // Reset UI progress for the current job
    this.progressMessages = [];
    this.progressPercent = 0;
    this.progressLabel = '';
    this.progressStatus = 'primary';
    this.processStartAt = Date.now();
    this.startElapsedTimer();
    this.startSingleJob(nextPayload);
  }

  private updateProgressFromMessage(msg: string): void {
    // Try JSON first
    try {
      const obj = JSON.parse(msg);
      const total = Number((obj.total ?? obj.filesTotal ?? obj.countTotal));
      const processed = Number((obj.processed ?? obj.filesProcessed ?? obj.countProcessed ?? obj.progress));
      if (Number.isFinite(total) && total > 0 && Number.isFinite(processed) && processed >= 0) {
        const pct = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
        this.progressPercent = pct;
        this.progressLabel = `${processed}/${total}`;
        return;
      }
      if (Number.isFinite(processed)) {
        const pct = Math.max(0, Math.min(100, Math.round(processed)));
        this.progressPercent = pct;
        this.progressLabel = `${pct}%`;
        return;
      }
    } catch (_) {
      // Not JSON, try text patterns
    }
    // 1) Pattern "x/y"
    const frac = msg.match(/(\d+)\s*\/\s*(\d+)/);
    if (frac) {
      const processed = Number(frac[1]);
      const total = Number(frac[2]);
      if (Number.isFinite(total) && total > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
        this.progressPercent = pct;
        this.progressLabel = `${processed}/${total}`;
        return;
      }
    }
    // 2) Pattern "nn%"
    const perc = msg.match(/(\d{1,3})\s*%/);
    if (perc) {
      const pct = Math.max(0, Math.min(100, Number(perc[1])));
      this.progressPercent = pct;
      this.progressLabel = `${pct}%`;
      return;
    }
    // 3) Completion markers
    if (/excel saved/i.test(msg) || /completed/i.test(msg) || /done/i.test(msg)) {
      this.progressPercent = 100;
      this.progressLabel = 'Completed';
      this.isProcessing = false;
      this.progressStatus = 'success';
      this.stopElapsedTimer();
    }
  }

  // Helpers to render per-job progress bars from status polling
  computeJobPercent(j: any): number {
    const total = Number(j?.total ?? j?.filesTotal ?? j?.countTotal ?? j?.totalFiles);
    const processed = Number(j?.processedCount ?? j?.processed ?? j?.filesProcessed ?? j?.countProcessed ?? j?.progress);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(processed) && processed >= 0) {
      return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
    }
    if (Number.isFinite(processed) && processed >= 0) {
      return Math.max(0, Math.min(100, Math.round(processed)));
    }
    return j?.status === 'done' ? 100 : 0;
  }

  jobProgressLabel(j: any): string {
    const total = Number(j?.total ?? j?.filesTotal ?? j?.countTotal ?? j?.totalFiles);
    const processed = Number(j?.processedCount ?? j?.processed ?? j?.filesProcessed ?? j?.countProcessed ?? j?.progress);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(processed) && processed >= 0) {
      return `${processed}/${total}`;
    }
    if (j?.status === 'done') return 'Completed';
    return '';
  }

  jobStatusColor(status: string): string {
    switch (status) {
      case 'queued': return 'info';
      case 'running': return 'primary';
      case 'done': return 'success';
      case 'error': return 'danger';
      default: return 'basic';
    }
  }

  private updateEtaFromProgress(): void {
    if (!this.processStartAt) {
      this.etaLabel = '';
      return;
    }
    const elapsedMs = Date.now() - this.processStartAt;
    const p = this.progressPercent;
    if (!Number.isFinite(p) || p <= 0 || p >= 100) {
      this.etaLabel = '';
      return;
    }
    const remainingFactor = (100 - p) / p;
    const etaMs = Math.max(0, Math.round(elapsedMs * remainingFactor));
    this.etaLabel = this.formatDuration(etaMs);
  }

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.elapsedTimer = setInterval(() => this.updateElapsedLabel(), 1000);
    this.updateElapsedLabel();
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = undefined;
    }
    this.updateElapsedLabel();
  }

  private updateElapsedLabel(): void {
    if (!this.processStartAt) {
      this.elapsedLabel = '';
      return;
    }
    const ms = Date.now() - this.processStartAt;
    this.elapsedLabel = this.formatDuration(ms);
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = hours.toString().padStart(2, '0');
    const mm = minutes.toString().padStart(2, '0');
    const ss = seconds.toString().padStart(2, '0');
    return hours > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  private startStatusPolling(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    const poll = () => {
      this.processing.getStatus().subscribe({
        next: (statuses) => {
          this.jobStatuses = Array.isArray(statuses) ? statuses : [];
          // Stop auto-processing state when all jobs are done or error
          const active = this.jobStatuses.some((j) => j.status === 'queued' || j.status === 'running');
          if (!active) {
            this.isProcessing = false;
            // Optional: refresh mapping from API after processing completes
            this.loadInitialData();
          }
        },
        error: () => {
          // Keep polling; show a lightweight warning if needed
        },
      });
    };
    poll();
    this.statusTimer = setInterval(poll, 3000);
  }

  private loadInitialData(): void {
    this.http.get<any[]>(this.API_URL).subscribe({
      next: (data) => {
        const rows = Array.isArray(data) ? data : [];
        this.source.load(rows);
        this.applyDefaultSort();
        this.mapping.updateRows(rows);
        this.hasSettingsData = rows.length > 0;
        this.updateActionVisibility(rows.length);
      },
      error: (err) => {
        const msg = err?.error?.error || 'Failed to load settings from API';
        this.toastr.warning(msg, 'Load Failed');
      },
    });
  }

  onDeleteConfirm(event): void {
    if (!window.confirm('Are you sure you want to delete?')) {
      event.confirm.reject();
      return;
    }
    const row = event.data || {};
    // Require keys for delete
    if (!row.project || !row.tester) {
      this.toastr.warning('Project and Tester are required to delete', 'Required');
      event.confirm.reject();
      return;
    }
    this.sendToApi(row, 'delete', () => {
      event.confirm.resolve();
      this.applyDefaultSort();
      this.refreshMappingFromSource();
    }, () => event.confirm.reject());
  }

  async onCreateConfirm(event): Promise<void> {
    const row = { ...(event.data || {}), ...(event.newData || {}) };
    if (!this.validateRequiredFields(row)) {
      event.confirm.reject();
      return;
    }
    const dupErrors = await this.checkDuplicateRow(row);
    if (dupErrors.length) {
      this.toastr.warning(dupErrors.join(' | '), 'Duplicate');
      event.confirm.reject();
      return;
    }
    // Auto-increment ID based on current max
    try {
      const all = await this.source.getAll();
      const maxId = all.reduce((max, cur) => {
        const val = Number(cur.id);
        return isNaN(val) ? max : Math.max(max, val);
      }, 0);
      row.id = maxId + 1;
    } catch (_) {
      // Fallback if source.getAll fails
      row.id = 1;
    }
    this.sendToApi(row, 'insert', () => {
      event.confirm.resolve(row);
      this.applyDefaultSort();
      this.refreshMappingFromSource();
    }, () => event.confirm.reject());
  }

  async onEditConfirm(event): Promise<void> {
    const row = { ...(event.data || {}), ...(event.newData || {}) };
    // Preserve ID as read-only
    row.id = event.data?.id;
    if (!this.validateRequiredFields(row)) {
      event.confirm.reject();
      return;
    }
    const dupErrors = await this.checkDuplicateRow(row, event.data);
    if (dupErrors.length) {
      this.toastr.warning(dupErrors.join(' | '), 'Duplicate');
      event.confirm.reject();
      return;
    }
    this.sendToApi(row, 'update', () => {
      event.confirm.resolve(row);
      this.applyDefaultSort();
      this.refreshMappingFromSource();
    }, () => event.confirm.reject());
  }

  private validateRequiredFields(row: any): boolean {
    const missing: string[] = [];
    const isEmpty = (v: any) => v === undefined || v === null || String(v).trim().length === 0;

    if (isEmpty(row.project)) missing.push('Project');
    if (isEmpty(row.tester)) missing.push('Tester');
    if (isEmpty(row.fileRepository)) missing.push('Log File Repository');

    if (missing.length) {
      this.toastr.warning(`Please fill: ${missing.join(', ')}`, 'Required');
      return false;
    }
    return true;
  }

  private sendToApi(row: any, action: 'insert' | 'update' | 'delete', onSuccess: () => void, onError: () => void): void {
    // Build JSON payload with action and fields
    const payload = {
      action,
      id: row.id ?? null,
      productionSite: row.productionSite || '',
      client: row.client || '',
      project: row.project || '',
      tester: row.tester || '',
      fileRepository: row.fileRepository || '',
      flow: row.flow || '',
    };

    this.http.post(this.API_URL, payload).subscribe({
      next: (res: any) => {
        const verb = action === 'insert' ? 'created' : action === 'update' ? 'updated' : 'deleted';
        this.toastr.success(`Row ${verb} successfully`, 'Success');
        onSuccess();
      },
      error: (err) => {
        const msg = err?.error?.error || 'Failed to send settings';
        this.toastr.danger(msg, 'Error');
        onError();
      },
    });
  }

  private async checkDuplicateRow(row: any, excludeItem?: any): Promise<string[]> {
    const errors: string[] = [];
    const norm = (v: any) => String(v || '').trim().toLowerCase();
    const targetProject = norm(row.project);
    const targetTester = norm(row.tester);
    const targetRepo = norm(row.fileRepository);

    try {
      const all = await this.source.getAll();
      for (const item of all) {
        if (excludeItem && item === excludeItem) continue;
        if (norm(item.project) !== targetProject) continue;
        if (norm(item.tester) === targetTester) {
          if (!errors.includes('Tester already exists in this project')) {
            errors.push('Tester already exists in this project');
          }
        }
        if (norm(item.fileRepository) === targetRepo) {
          if (!errors.includes('Log File Repository already exists in this project')) {
            errors.push('Log File Repository already exists in this project');
          }
        }
      }
    } catch (e) {
      // If source.getAll fails, don't block but log a warning toast
      // This should not normally happen
      this.toastr.warning('Could not verify duplicates', 'Warning');
    }
    return errors;
  }

  private refreshMappingFromSource(): void {
    // Debounce to allow table source to settle
    setTimeout(async () => {
      try {
        const all = await this.source.getAll();
        this.mapping.updateRows(all);
        this.hasSettingsData = all.length > 0;
        this.updateActionVisibility(all.length);
      } catch (e) {
        // Non-blocking: ignore
      }
    }, 0);
  }

  private applyDefaultSort(): void {
    try {
      this.source.setSort([{ field: 'id', direction: 'asc' }], true);
    } catch (_) {
      // If setSort is unavailable, silently ignore.
    }
  }

  private computeIsoWeekNumber(date: Date): { week: number; year: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { week: weekNo, year: d.getUTCFullYear() };
  }

  private updateActionVisibility(rowCount: number): void {
    const allowActions = rowCount < 2;
    // Replace settings object reference to trigger table change detection
    this.settings = {
      ...this.settings,
      actions: {
        add: allowActions,
        edit: allowActions,
        delete: true,
      },
    };
  }
}