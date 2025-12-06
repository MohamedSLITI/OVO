import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ProcessRequest {
  project?: string;
  tester?: string;
  // Start from a specific week-of-year (ISO-ish), with optional year
  startWeek?: number; // 1–53
  startYear?: number; // e.g., 2025
  // Optional repository path resolved from settings for selected tester
  fileRepository?: string;
}

export interface ProcessJobStatus {
  id: string;
  project: string;
  tester: string;
  repo: string;
  status: 'queued' | 'running' | 'done' | 'error';
  processedCount?: number;
  lastProcessedFileTime?: string;
  error?: string;
}

export interface TesterMetric {
  name: string;
  total: number;
  passed: number;
  failed: number;
  fpy: number;
}

export interface ProjectOverviewMetric {
  project: string;
  testers: TesterMetric[];
}

@Injectable({ providedIn: 'root' })
export class ProcessingService {
  private get BASE(): string {
    const v = localStorage.getItem('apiBase');
    return (v && v.trim()) || 'http://127.0.0.1:5000';
  }
  private get STATUS_URL(): string { return `${this.BASE}/process/status`; }
  private get OVERVIEW_URL(): string { return `${this.BASE}/metrics/overview`; }
  private candidateProcessUrls(): string[] {
    const b = this.BASE.replace(/\/$/, '');
    return [
      `${b}/parse`,
      `${b}/process/parse`,
      `${b}/process/start`,
      `${b}/api/parse`,
    ];
  }

  constructor(private http: HttpClient) {}

  triggerProcess(req: ProcessRequest): Observable<{ queued: boolean } | any> {
    const urls = this.candidateProcessUrls();
    const tryPost = (idx: number): Observable<any> => {
      const url = urls[idx];
      return new Observable((observer) => {
        this.http.post(url, req).subscribe({
          next: (res) => observer.next(res),
          error: (err) => {
            const status = err?.status;
            if (status === 404 && idx + 1 < urls.length) {
              tryPost(idx + 1).subscribe(observer);
            } else {
              observer.error(err);
            }
          },
          complete: () => observer.complete(),
        });
      });
    };
    return tryPost(0);
  }

  // Consume SSE-like streaming response from POST /parse and emit each data line
  triggerProcessStream(req: ProcessRequest): Observable<string> {
    return new Observable<string>((observer) => {
      const controller = new AbortController();
      const urls = this.candidateProcessUrls();
      let currentIdx = 0;
      const tryFetch = (idx: number) => {
        const url = urls[idx];
        return fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(req),
          signal: controller.signal,
        })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            if (res.status === 404 && idx + 1 < urls.length) {
              currentIdx = idx + 1;
              return tryFetch(currentIdx);
            } else {
              try {
                const text = await res.text();
                let parsed: any;
                try { parsed = JSON.parse(text); } catch {}
                const msg = typeof parsed === 'string' ? parsed : parsed?.message;
                observer.error({ status: res.status, message: msg, error: parsed ?? text });
              } catch (e) {
                observer.error({ status: res.status, error: 'Request failed' });
              }
              return;
            }
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          const parseBuffer = () => {
            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
              const chunk = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 2);
              // Extract SSE data: lines starting with "data:"
              const lines = chunk.split('\n');
              const dataLine = lines.find((l) => l.startsWith('data:'));
              if (dataLine) {
                const payload = dataLine.replace(/^data:\s*/, '');
                observer.next(payload);
              }
              idx = buffer.indexOf('\n\n');
            }
          };

          const pump = (): Promise<void> => {
            return reader.read().then(({ done, value }) => {
              if (done) {
                observer.complete();
                return;
              }
              buffer += decoder.decode(value, { stream: true });
              parseBuffer();
              return pump();
            });
          };

          return pump();
        })
        .catch((err) => observer.error(err));
      };

      tryFetch(0);

      return () => controller.abort();
    });
  }

  getStatus(): Observable<ProcessJobStatus[]> {
    return this.http.get<ProcessJobStatus[]>(this.STATUS_URL);
  }

  getOverviewMetrics(): Observable<ProjectOverviewMetric[]> {
    return this.http.get<ProjectOverviewMetric[]>(this.OVERVIEW_URL);
  }
}