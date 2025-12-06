import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';

export interface ProjectTesterMapping {
  [project: string]: string[];
}

@Injectable({ providedIn: 'root' })
export class SettingsMappingService {
  private mappingSubject = new BehaviorSubject<ProjectTesterMapping>({});
  private projectsSubject = new BehaviorSubject<string[]>([]);
  private testersSubject = new BehaviorSubject<string[]>([]);

  readonly mapping$: Observable<ProjectTesterMapping> = this.mappingSubject.asObservable();
  readonly projects$: Observable<string[]> = this.projectsSubject.asObservable();
  readonly testers$: Observable<string[]> = this.testersSubject.asObservable();

  // Keep API URL centralized for bootstrap loading (same endpoint used by SettingComponent)
  private readonly API_URL = 'http://127.0.0.1:5000/setting';

  constructor(private http: HttpClient) {}

  updateRows(rows: any[]): void {
    const map: ProjectTesterMapping = {};
    const allTestersSet = new Set<string>();

    rows.forEach(row => {
      const project = String(row?.project || '').trim();
      const tester = String(row?.tester || '').trim();
      if (!project || !tester) return;
      if (!map[project]) map[project] = [];
      if (!map[project].includes(tester)) map[project].push(tester);
      allTestersSet.add(tester);
    });

    const projects = Object.keys(map).sort((a, b) => a.localeCompare(b));
    const testers = Array.from(allTestersSet).sort((a, b) => a.localeCompare(b));

    this.mappingSubject.next(map);
    this.projectsSubject.next(projects);
    this.testersSubject.next(testers);
  }

  getTestersFor(project: string): string[] {
    const map = this.mappingSubject.getValue();
    return map[project] ? [...map[project]] : [];
  }

  initFromApi(): Promise<void> {
    return new Promise((resolve) => {
      this.http.get<any[]>(this.API_URL).subscribe({
        next: (rows) => {
          this.updateRows(Array.isArray(rows) ? rows : []);
          resolve();
        },
        error: () => {
          // Non-blocking: resolve even if API fails; mapping remains empty
          resolve();
        },
      });
    });
  }
}