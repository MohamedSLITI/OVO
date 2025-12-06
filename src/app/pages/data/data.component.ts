import { Component, OnDestroy, OnInit } from '@angular/core';
import { NbThemeService } from '@nebular/theme';
import { Router } from '@angular/router';
import { takeWhile } from 'rxjs/operators';
import { SettingsMappingService, ProjectTesterMapping } from '../../@core/services/settings-mapping.service';

type ScopeOption = 'all' | 'top3' | 'top5';

@Component({
  selector: 'ngx-data',
  styleUrls: ['./data.component.scss'],
  templateUrl: './data.component.html',
})
export class DataComponent implements OnInit, OnDestroy {
  private alive = true;
  scope: ScopeOption = 'top3';
  projects: string[] = [];
  testers: string[] = [];
  hasData = false;
  testerFpyOptions: any = {};
  projectFpyOptions: any = {};
  projectDetailOptions: any = {};
  selectedProjectName: string = '';
  private projectChartRef: any;
  sortAscending: boolean = true;
  cumulativeMode: boolean = true;
  detailSummary: { avg: number; min: number; max: number } | null = null;
  highlightLow: boolean = true;
  overallAvg: number = 0;
  projectCount: number = 0;
  testerCount: number = 0;
  lowTesters: string[] = [];
  lowProjects: { name: string; fpy: number }[] = [];
  private themeColors: any;
  private themeEcharts: any;
  private overview: { project: string; testers: { name: string; fpy: number; total: number; passed: number; failed: number }[] }[] = [];

  constructor(
    private theme: NbThemeService,
    private mapping: SettingsMappingService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.theme.getJsTheme()
      .pipe(takeWhile(() => this.alive))
      .subscribe(cfg => {
        this.themeColors = cfg.variables;
        this.themeEcharts = cfg.variables.echarts;
        this.buildCharts();
      });
    this.mapping.projects$
      .pipe(takeWhile(() => this.alive))
      .subscribe(p => {
        this.projects = p;
      });
    this.mapping.testers$
      .pipe(takeWhile(() => this.alive))
      .subscribe(t => {
        this.testers = t;
      });
    this.mapping.mapping$
      .pipe(takeWhile(() => this.alive))
      .subscribe((map: ProjectTesterMapping) => {
        this.buildOverviewFromMapping(map);
        this.hasData = this.overview.length > 0;
        this.buildCharts();
      });
  }

  thresholdColor(v: number): string {
    return v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
  }

  private gradientFor(v: number): any {
    const top = v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
    const bottom = v >= 97 ? '#009c43' : v >= 90 ? '#e6c200' : '#a70000';
    return {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
      colorStops: [
        { offset: 0, color: top },
        { offset: 1, color: bottom },
      ],
    };
  }

  onScopeChange(v: ScopeOption): void {
    this.scope = v;
    this.buildCharts();
  }

  resetView(): void {
    this.selectedProjectName = '';
    this.scope = 'all';
    this.buildCharts();
  }

  toggleSort(): void {
    this.sortAscending = !this.sortAscending;
    this.buildCharts();
  }

  toggleCumulative(): void {
    this.cumulativeMode = !this.cumulativeMode;
    if (this.selectedProjectName) this.showProjectDetail(this.selectedProjectName);
  }

  private buildCharts(): void {
    if (!this.themeColors || !this.themeEcharts) return;
    const selectedProjects = this.selectProjectsByScope();
    const projectAggAll = this.aggregateProjectMetrics(this.overview.map(o => o.project));
    this.testerFpyOptions = this.makeProjectPie(projectAggAll, true);
    this.projectFpyOptions = this.makeProjectPie(projectAggAll);
    this.lowProjects = [...projectAggAll].sort((a, b) => a.fpy - b.fpy).slice(0, 3);
    if (this.selectedProjectName) this.showProjectDetail(this.selectedProjectName);
  }

  private computeTesterFpy(tester: string): number {
    let sum = 0;
    for (let i = 0; i < tester.length; i++) sum += tester.charCodeAt(i);
    const delta = (sum % 12) - 6;
    let val = 95 + delta;
    if (val < 85) val = 85;
    if (val > 99) val = 99;
    return Math.round(val * 10) / 10;
  }

  private buildOverviewFromMapping(map: ProjectTesterMapping): void {
    const entries = Object.entries(map || {});
    this.overview = entries.map(([project, testers]) => {
      const list = (testers || []).map(name => {
        const fpy = this.computeTesterFpy(String(name));
        const total = 100;
        const passed = Math.round((fpy / 100) * total);
        const failed = Math.max(0, total - passed);
        return { name: String(name), fpy, total, passed, failed };
      });
      return { project: String(project), testers: list };
    });
    this.projectCount = this.overview.length;
    this.testerCount = this.overview.reduce((s, p) => s + (p.testers?.length || 0), 0);
    const allFpys = this.overview
      .map(p => (p.testers || []).map(t => t.fpy))
      .reduce((acc, arr) => acc.concat(arr), [] as number[]);
    this.overallAvg = allFpys.length ? +(allFpys.reduce((s, v) => s + v, 0) / allFpys.length).toFixed(2) : 0;
  }

  private selectProjectsByScope(): string[] {
    const all = this.overview.map(o => o.project);
    if (this.scope === 'all') return all;
    const scored = this.overview.map(o => ({
      project: o.project,
      total: o.testers.reduce((a, t) => a + (t.total || 0), 0),
      passed: o.testers.reduce((a, t) => a + (t.passed || 0), 0),
    }));
    const withFpy = scored.map(s => ({ project: s.project, fpy: s.total ? s.passed / s.total : 0 }));
    const sorted = withFpy.sort((a, b) => a.fpy - b.fpy);
    const n = this.scope === 'top3' ? 3 : 5;
    return sorted.slice(0, n).map(x => x.project);
  }


  private aggregateTesterMetrics(projects: string[]): { name: string; total: number; passed: number; failed: number; fpy: number }[] {
    const map = new Map<string, { total: number; passed: number; failed: number }>();
    this.overview.filter(o => projects.includes(o.project)).forEach(o => {
      o.testers.forEach(t => {
        const v = map.get(t.name) || { total: 0, passed: 0, failed: 0 };
        v.total += t.total || 0;
        v.passed += t.passed || 0;
        v.failed += t.failed || 0;
        map.set(t.name, v);
      });
    });
    return Array.from(map.entries()).map(([name, v]) => ({
      name,
      total: v.total,
      passed: v.passed,
      failed: v.failed,
      fpy: v.total ? +(100 * v.passed / v.total).toFixed(2) : 0,
    })).sort((a, b) => a.fpy - b.fpy);
  }

  private aggregateProjectMetrics(projects: string[]): { name: string; fpy: number; total: number; passed: number }[] {
    const entries = this.overview.filter(o => projects.includes(o.project)).map(o => {
      const total = o.testers.reduce((a, t) => a + (t.total || 0), 0);
      const passed = o.testers.reduce((a, t) => a + (t.passed || 0), 0);
      const fpy = total ? +(100 * passed / total).toFixed(2) : 0;
      return { name: o.project, fpy, total, passed };
    });
    return entries.sort((a, b) => a.fpy - b.fpy);
  }

  private makeTesterPie(items: { name: string; total: number; passed: number; failed: number; fpy: number }[], showTotals: boolean = false): any {
    const colors = this.themeColors;
    const echarts = this.themeEcharts;
    const colorFor = (v: number) => v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
    const data = items.map(i => ({ value: showTotals ? i.total : i.fpy, name: i.name, fpy: i.fpy, total: i.total, itemStyle: { color: colorFor(i.fpy) } }));
    const avg = items.length ? +(items.reduce((s, i) => s + (showTotals ? i.total : i.fpy), 0) / items.length).toFixed(showTotals ? 0 : 1) : 0;
    return {
      backgroundColor: echarts.bg,
      color: [colors.primary, colors.info, colors.success, colors.warning, colors.danger],
      tooltip: { trigger: 'item', backgroundColor: 'rgba(34,34,34,0.92)', borderColor: '#1f2b3a', borderWidth: 1, textStyle: { color: '#fff' }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,0.3)', formatter: (p: any) => {
        const v = Number(p.value);
        const f = Number(p.data?.fpy ?? 0);
        const t = Number(p.data?.total ?? 0);
        return showTotals
          ? `${p.name}: <span style=\"color:${colorFor(f)}\">${t}</span>`
          : `${p.name}: <span style=\"color:${colorFor(v)}\">${v.toFixed(1)}%</span>`;
      } },
      legend: { show: true, type: 'scroll', orient: 'horizontal', top: 0, textStyle: { color: echarts.textColor, fontSize: 11 }, itemWidth: 12, itemHeight: 12 },
      
      series: [{
        name: 'Tester FPY', type: 'pie', radius: ['36%', '60%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: echarts.bg, borderWidth: 3, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.28)' },
        label: {
          show: true,
          position: 'outside',
          formatter: (p: any) => {
            const v = Number(p.value);
            const f = Number(p.data?.fpy ?? 0);
            const t = Number(p.data?.total ?? 0);
            if (showTotals) {
              const key = f >= 97 ? 'valueHigh' : f >= 90 ? 'valueMid' : 'valueLow';
              return `{name|${p.name}} {${key}|${t}}`;
            } else {
              const key = v >= 97 ? 'valueHigh' : v >= 90 ? 'valueMid' : 'valueLow';
              return `{name|${p.name}} {${key}|${v.toFixed(1)}%}`;
            }
          },
          fontSize: 11,
          rich: {
            name: { color: '#1a1a1a', fontWeight: 400 },
            valueHigh: { color: '#00C853' },
            valueMid: { color: '#FFD600' },
            valueLow: { color: '#D50000' },
          },
        },
        emphasis: { scale: true, label: { show: true, fontSize: 12 }, itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.35)' } },
        labelLine: { show: true, length: 12, length2: 10, smooth: true },
        animationType: 'scale', animationDuration: 700, animationEasing: 'cubicOut', animationDurationUpdate: 500,
        data,
      }],
      graphic: [
        { type: 'text', left: 'center', top: '46%', style: { text: showTotals ? `${avg}` : `${avg}%`, fill: showTotals ? '#8f9bb3' : colorFor(avg), fontSize: 18, fontWeight: 600 } },
        { type: 'text', left: 'center', top: '58%', style: { text: showTotals ? 'Total / Tester' : 'Avg FPY', fill: echarts.textColor, fontSize: 11 } },
      ],
    };
  }

  private makeProjectPie(items: { name: string; fpy: number; total: number; passed: number }[], showTotals: boolean = false): any {
    const colors = this.themeColors;
    const echarts = this.themeEcharts;
    const sorted = [...items].sort((a, b) => this.sortAscending ? (a.fpy - b.fpy) : (b.fpy - a.fpy));
    const n = this.scope === 'top3' ? 3 : this.scope === 'top5' ? 5 : sorted.length;
    const top = sorted.slice(0, n);
    const rest = sorted.slice(n);
    let others = 0;
    if (rest.length) {
      const tot = rest.reduce((a, r) => a + r.total, 0);
      const pass = rest.reduce((a, r) => a + r.passed, 0);
      others = tot ? +(100 * pass / tot).toFixed(2) : 0;
    }
    const colorFor = (v: number) => v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
    const data = [
      ...top.map(i => ({ value: showTotals ? i.total : i.fpy, name: i.name, total: i.total, fpy: i.fpy, itemStyle: { color: colorFor(i.fpy) } })),
      ...(rest.length ? [{ value: showTotals ? rest.reduce((a, r) => a + r.total, 0) : others, name: 'Others', total: rest.reduce((a, r) => a + r.total, 0), itemStyle: { color: '#8f9bb3' } }] : []),
    ];
    const avgSel = !showTotals && data.length ? +(data.reduce((s: number, d: any) => s + Number(d.value), 0) / data.length).toFixed(1) : 0;
    const sumTotals = showTotals ? data.reduce((s: number, d: any) => s + Number(d.value), 0) : 0;
    return {
      backgroundColor: echarts.bg,
      color: [colors.primary, colors.info, colors.success, colors.warning, colors.danger],
      tooltip: { trigger: 'item', backgroundColor: 'rgba(34,34,34,0.92)', borderColor: '#1f2b3a', borderWidth: 1, textStyle: { color: '#fff' }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,0.3)', formatter: (p: any) => {
        if (showTotals) {
          const f = Number(p.data?.fpy ?? 0);
          return `${p.name}: <span style="color:${colorFor(f)}">${Number(p.value)}</span>`;
        }
        return `${p.name}: <span style="color:${colorFor(Number(p.value))}">${Number(p.value).toFixed(1)}%</span>`;
      } },
      legend: { show: true, type: 'scroll', orient: 'horizontal', top: 0, textStyle: { color: echarts.textColor, fontSize: 11 }, itemWidth: 12, itemHeight: 12 },
      
      series: [{
        name: showTotals ? 'Project Totals' : 'Project FPY', type: 'pie', radius: ['36%', '60%'], roseType: showTotals ? undefined : 'radius', avoidLabelOverlap: true,
        itemStyle: { borderColor: echarts.bg, borderWidth: 3, shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.28)' },
        label: {
          show: true,
          position: 'outside',
          formatter: (p: any) => {
            if (showTotals) {
              const f = Number(p.data?.fpy ?? 0);
              const key = f >= 97 ? 'valueHigh' : f >= 90 ? 'valueMid' : 'valueLow';
              return `{name|${p.name}} {${key}|${Number(p.value)}}`;
            } else {
              const v = Number(p.value);
              const key = v >= 97 ? 'valueHigh' : v >= 90 ? 'valueMid' : 'valueLow';
              return `{name|${p.name}} {${key}|${v.toFixed(1)}%}`;
            }
          },
          fontSize: 11,
          rich: {
            name: { color: '#1a1a1a', fontWeight: 400 },
            valueHigh: { color: '#00C853' },
            valueMid: { color: '#FFD600' },
            valueLow: { color: '#D50000' },
          },
        },
        emphasis: { scale: true, label: { show: true, fontSize: 12 } },
        labelLine: { show: true, length: 12, length2: 10, smooth: true },
        animationType: 'scale', animationDuration: 700, animationEasing: 'cubicOut', animationDurationUpdate: 500,
        data,
      }],
      graphic: [
        { type: 'text', left: 'center', top: '44%', style: { text: showTotals ? `${sumTotals}` : `${avgSel}%`, fill: showTotals ? '#8f9bb3' : colorFor(avgSel), fontSize: 18, fontWeight: 600 } },
        { type: 'text', left: 'center', top: '57%', style: { text: showTotals ? 'Total / Project' : (this.scope === 'all' ? 'All Projects' : (this.scope === 'top3' ? 'Top 3' : 'Top 5')), fill: echarts.textColor, fontSize: 11 } },
      ],
    };
  }

  onProjectChartInit(chart: any): void {
    this.projectChartRef = chart;
    try { chart.off('click'); } catch {}
    chart.on('click', (params: any) => {
      if (params && params.seriesType === 'pie') {
        const name = params.name;
        if (name) this.showProjectDetail(name);
      }
    });
  }

  private showProjectDetail(projectName: string): void {
    this.selectedProjectName = projectName;
    const echarts = this.themeEcharts;
    const colors = this.themeColors;
    const proj = this.overview.find(o => o.project === projectName);
    if (!proj || !echarts || !colors) return;
    const testers = [...proj.testers].sort((a, b) => a.fpy - b.fpy);
    const labels = testers.map(t => t.name);
    const barVals = testers.map(t => +(t.fpy).toFixed(2));
    const cumVals: number[] = [];
    let cumPassed = 0;
    let cumTotal = 0;
    testers.forEach(t => {
      cumPassed += t.passed || 0;
      cumTotal += t.total || 0;
      const v = cumTotal ? +(100 * cumPassed / cumTotal).toFixed(2) : 0;
      cumVals.push(v);
    });
    const avg = barVals.length ? +(barVals.reduce((s, v) => s + v, 0) / barVals.length).toFixed(2) : 0;
    const min = barVals.length ? Math.min(...barVals) : 0;
    const max = barVals.length ? Math.max(...barVals) : 0;
    this.detailSummary = { avg, min, max };
    this.lowTesters = testers.filter(t => t.fpy < 90).map(t => t.name);
    this.testerFpyOptions = this.makeTesterPie(testers, true);
    const thresholdColor = (v: number) => v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
    this.projectDetailOptions = {
      backgroundColor: echarts.bg,
      grid: { left: 40, right: 24, top: 32, bottom: 48 },
      xAxis: [{
        type: 'category',
        data: labels,
        axisLabel: { interval: 0, rotate: 30, color: echarts.textColor, margin: 8, fontSize: 12, fontWeight: 500 },
        axisLine: { lineStyle: { color: echarts.axisLineColor } },
        axisTick: { show: false },
      }],
      yAxis: [{
        type: 'value', min: 0, max: 100,
        axisLabel: { formatter: '{value}%', color: echarts.textColor, fontSize: 12 },
        axisLine: { lineStyle: { color: echarts.axisLineColor } },
        splitLine: { show: true, lineStyle: { color: echarts.splitLineColor } },
      }],
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${Number(p.value).toFixed(2)}% FPY` },
      legend: { show: true, top: 4, textStyle: { color: echarts.textColor, fontSize: 11 } },
      series: [
        {
          name: 'Tester FPY', type: 'bar', data: barVals, barWidth: 30, barCategoryGap: '15%',
          itemStyle: { color: (p: any) => this.gradientFor(Number(p.value)), borderRadius: [6, 6, 0, 0], shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.25)' },
          label: { show: true, position: 'top', formatter: ({ value }: any) => `${Number(value).toFixed(1)}%`, color: echarts.textColor, fontSize: 12, fontWeight: 600 },
          markLine: {
            symbol: ['none', 'none'],
            label: { color: echarts.textColor },
            data: [
              { yAxis: 97, name: 'Target 97%', lineStyle: { color: '#00C853', width: 2, type: 'dashed' } },
              { yAxis: 90, name: 'Floor 90%', lineStyle: { color: '#D50000', type: 'dashed' } },
            ],
          },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.3)' } },
          animationDuration: 500,
          animationEasing: 'cubicOut',
        },
      ],
      dataZoom: labels.length > 12 ? [{ type: 'slider', start: 0, end: 100, height: 14, bottom: 24 }, { type: 'inside' }] : undefined,
      
    };

  }

  onDetailChartInit(chart: any): void {
    try { chart.off('click'); } catch {}
    chart.on('click', (params: any) => {
      if (params && params.seriesType === 'bar') {
        const tester = params.name;
        if (this.selectedProjectName && tester) {
          const now = new Date();
          const start = new Date(now); start.setHours(0,0,0,0);
          const end = new Date(now); end.setHours(23,59,59,999);
          const payload = {
            selectedProjects: [this.selectedProjectName],
            selectedTesters: [tester],
            selectedShift: 'full',
            startTime: '00:00',
            endTime: '23:59',
            dateRange: { start, end },
            quickPreset: 'today',
            filterCollapsed: false,
          };
          try { localStorage.setItem('analysis_filters_v1', JSON.stringify(payload)); } catch {}
          this.router.navigate(['/pages/analysis']);
        }
      }
    });
  }

  

  ngOnDestroy(): void {
    this.alive = false;
  }
}