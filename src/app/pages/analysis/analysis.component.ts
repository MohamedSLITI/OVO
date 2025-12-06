import { Component, OnInit, OnDestroy } from '@angular/core';
import { NbCalendarRange, NbThemeService } from '@nebular/theme';
import { SettingsMappingService } from '../../@core/services/settings-mapping.service';
import { takeWhile } from 'rxjs/operators';

@Component({
  selector: 'ngx-analysis',
  styleUrls: ['./analysis.component.scss'],
  templateUrl: './analysis.component.html',
})
export class AnalysisComponent implements OnInit, OnDestroy {
  private alive = true;

  projects: string[] = [];
  testers: string[] = [];
  variants: string[] = [];

  selectedProject: string = '';
  selectedTester: string = '';
  selectedVariants: string[] = [];

  dateRange: NbCalendarRange<Date> = { start: null, end: null };
  quickPreset: 'today' | 'yesterday' | '7d' | 'month' | 'custom' = 'today';

  selectedShift: 1 | 2 | 'full' | 'custom' = 'full';
  startTime: string = '00:00';
  endTime: string = '23:59';

  resultCount = 0;
  activeFilters: string[] = [];
  selectedView: 'cycle' | 'qualification' | 'pareto' | 'fpy' = 'pareto';
  cycleOptions: any = {};
  cyclePieOptions: any = {};
  private cycleScatterInstance: any;
  private cyclePieInstance: any;
  private cycleRawPoints: number[] = [];
  private cyclePoints: [number, number][] = [];
  private cycleLabels: string[] = [];
  private cycleCounts: number[] = [];
  private cycleBins: number[] = [];
  qualificationOptions: any = {};
  paretoOptions: any = {};
  fpyOptions: any = {};

  private themeColors: any;
  private themeEcharts: any;

  private storageKey = 'analysis_filters_v1';
  filterCollapsed = true;

  constructor(private theme: NbThemeService, private mapping: SettingsMappingService) {}

  ngOnInit(): void {
    this.theme.getJsTheme()
      .pipe(takeWhile(() => this.alive))
      .subscribe(config => {
        this.themeColors = config.variables;
        this.themeEcharts = config.variables.echarts;
        if (this.selectedView === 'cycle') {
          this.buildCycleDistribution();
        } else if (this.selectedView === 'qualification') {
          this.buildQualificationDistribution();
        } else if (this.selectedView === 'pareto') {
          this.buildParetoChart();
        } else if (this.selectedView === 'fpy') {
          this.buildFpyTrend();
        }
      });

    this.mapping.projects$
      .pipe(takeWhile(() => this.alive))
      .subscribe(list => {
        this.projects = list;
        this.loadPersisted();
        this.applyFilters();
      });

    this.mapping.testers$
      .pipe(takeWhile(() => this.alive))
      .subscribe(list => {
        this.testers = list;
        if (!this.variants.length) {
          this.variants = ['Variant A', 'Variant B', 'Variant C'];
          if (!this.selectedVariants.length) this.selectedVariants = [...this.variants];
        }
        this.loadPersisted();
        this.applyFilters();
      });
  }

  private loadPersisted(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.selectedProject === 'string') this.selectedProject = s.selectedProject;
      else if (Array.isArray(s.selectedProjects) && s.selectedProjects.length) this.selectedProject = s.selectedProjects[0];
      if (typeof s.selectedTester === 'string') this.selectedTester = s.selectedTester;
      else if (Array.isArray(s.selectedTesters) && s.selectedTesters.length) this.selectedTester = s.selectedTesters[0];
      if (Array.isArray(s.selectedVariants)) this.selectedVariants = s.selectedVariants;
      this.selectedShift = s.selectedShift || 'full';
      this.startTime = s.startTime || '00:00';
      this.endTime = s.endTime || '23:59';
      if (s.dateRange && s.dateRange.start && s.dateRange.end) {
        this.dateRange = { start: new Date(s.dateRange.start), end: new Date(s.dateRange.end) };
      }
      this.quickPreset = s.quickPreset || 'today';
      this.filterCollapsed = !!s.filterCollapsed;
    } catch {}
  }

  private persist(): void {
    const payload = {
      selectedProject: this.selectedProject,
      selectedTester: this.selectedTester,
      selectedVariants: this.selectedVariants,
      // keep compatibility for external navigation
      selectedProjects: this.selectedProject ? [this.selectedProject] : [],
      selectedTesters: this.selectedTester ? [this.selectedTester] : [],
      selectedShift: this.selectedShift,
      startTime: this.startTime,
      endTime: this.endTime,
      dateRange: this.dateRange,
      quickPreset: this.quickPreset,
      filterCollapsed: this.filterCollapsed,
    };
    try { localStorage.setItem(this.storageKey, JSON.stringify(payload)); } catch {}
  }

  toggleCollapsed(): void {
    this.filterCollapsed = !this.filterCollapsed;
    this.persist();
  }

  setQuickDate(preset: 'today' | 'yesterday' | '7d' | 'month' | 'custom'): void {
    this.quickPreset = preset;
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    switch (preset) {
      case 'today':
        start.setHours(0,0,0,0);
        end.setHours(23,59,59,999);
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        start.setHours(0,0,0,0);
        end.setHours(23,59,59,999);
        break;
      case '7d':
        start.setDate(start.getDate() - 6);
        start.setHours(0,0,0,0);
        end.setHours(23,59,59,999);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth()+1, 0);
        end.setHours(23,59,59,999);
        break;
      case 'custom':
        start = this.dateRange.start || start;
        end = this.dateRange.end || end;
        break;
    }
    this.dateRange = { start, end };
    this.applyFilters();
  }

  

  applyFilters(): void {
    this.validateDateAndTime();
    const projCount = this.selectedProject ? 1 : this.projects.length;
    const testers = this.selectedTester ? [this.selectedTester] : this.testers;
    this.resultCount = projCount * testers.length;
    this.activeFilters = [];
    if (this.selectedProject) this.activeFilters.push(`Project: ${this.selectedProject}`);
    if (this.selectedTester) this.activeFilters.push(`Tester: ${this.selectedTester}`);
    if (this.selectedVariants && this.selectedVariants.length) {
      if (this.selectedVariants.length === this.variants.length) this.activeFilters.push('Variant: All');
      else this.activeFilters.push(`Variant: ${this.selectedVariants.join(', ')}`);
    }
    this.activeFilters.push(`Shift: ${this.selectedShift}`);
    if (this.dateRange.start && this.dateRange.end) {
      this.activeFilters.push(`Date: ${this.dateRange.start.toLocaleDateString()}–${this.dateRange.end.toLocaleDateString()}`);
    }
    if (this.selectedShift === 'custom') this.activeFilters.push(`Time: ${this.startTime}–${this.endTime}`);
    this.persist();
  }

  applyAndCollapse(): void {
    this.applyFilters();
    this.filterCollapsed = true;
    this.persist();
  }


  onViewChange(v: 'cycle' | 'qualification' | 'pareto' | 'fpy'): void {
    this.selectedView = v;
    if (v === 'cycle') this.buildCycleDistribution();
    if (v === 'qualification') this.buildQualificationDistribution();
    if (v === 'pareto') this.buildParetoChart();
    if (v === 'fpy') this.buildFpyTrend();
  }

  private validateDateAndTime(): void {
    if (this.dateRange.start && this.dateRange.end && this.dateRange.end < this.dateRange.start) {
      this.dateRange.end = this.dateRange.start;
    }
    if (this.selectedShift === 'custom') {
      if (!this.startTime) this.startTime = '00:00';
      if (!this.endTime) this.endTime = '23:59';
      const [sh, sm] = this.startTime.split(':').map(Number);
      const [eh, em] = this.endTime.split(':').map(Number);
      const sv = sh*60 + sm;
      const ev = eh*60 + em;
      if (ev < sv) this.endTime = this.startTime;
    }
  }

  clearFilters(): void {
    this.selectedProject = '';
    this.selectedTester = '';
    this.selectedShift = 'full';
    this.startTime = '00:00';
    this.endTime = '23:59';
    this.setQuickDate('today');
    this.applyFilters();
  }

  

  ngOnDestroy(): void { this.alive = false; }

  onCycleScatterInit(ec: any): void {
    this.cycleScatterInstance = ec;
  }

  onCyclePieInit(ec: any): void {
    this.cyclePieInstance = ec;
    try { ec.off('click'); } catch {}
    ec.on('click', (params: any) => {
      if (!params || typeof params.name !== 'string') return;
      const idx = this.cycleLabels.indexOf(params.name);
      if (idx < 0) return;
      this.filterScatterByCategory(idx);
    });
  }

  private filterScatterByCategory(categoryIndex: number | null): void {
    if (!this.cycleScatterInstance) return;
    const data = categoryIndex === null
      ? this.cyclePoints
      : this.cyclePoints.filter(p => this.getCategoryIndex(p[1]) === categoryIndex);
    this.cycleScatterInstance.setOption({ series: [{ data }] });
  }

  private getCategoryIndex(sec: number): number {
    for (let b = 0; b < this.cycleBins.length - 1; b++) {
      if (sec >= this.cycleBins[b] && sec < this.cycleBins[b + 1]) return b;
    }
    return this.cycleLabels.length - 1;
  }

  private buildCycleDistribution(): void {
    const echarts: any = this.themeEcharts || {};
    const colors: any = this.themeColors || {};
    const bg = echarts.bg || '#fff';
    const textColor = echarts.textColor || '#333';
    const axisLineColor = echarts.axisLineColor || '#ccc';
    const splitLineColor = echarts.splitLineColor || '#eee';

    const rawPoints: number[] = [];
    const N = 1000;
    const mean = 120;
    const std = 30;
    for (let i = 0; i < N; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const sec = Math.max(0, Math.round(mean + std * z));
      rawPoints.push(sec);
    }

    const times = [...rawPoints].sort((a, b) => a - b);
    const avg = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
    const p95 = times[Math.floor(0.95 * times.length)];

    const points: [number, number][] = rawPoints.map((sec, i) => [i + 1, sec]);

    const bins = [0, 90, 150, Infinity];
    const labels = ['0–90s', '90–150s', '>150s'];
    const counts = new Array(labels.length).fill(0);
    rawPoints.forEach(sec => {
      for (let b = 0; b < bins.length - 1; b++) {
        if (sec >= bins[b] && sec < bins[b + 1]) { counts[b]++; break; }
      }
    });

    this.cycleBins = bins;
    this.cycleLabels = labels;
    this.cycleCounts = counts;
    this.cycleRawPoints = rawPoints;
    this.cyclePoints = points;

    this.cycleOptions = {
      backgroundColor: bg,
      tooltip: {
        trigger: 'item',
        formatter: (p) => `Index ${p.value[0]}<br/>Time: ${p.value[1]} s`,
      },
      grid: { left: '10%', right: '4%', top: '8%', bottom: '12%', containLabel: true },
      toolbox: { feature: { saveAsImage: {}, restore: {} } },
      visualMap: {
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        min: Math.max(0, avg - 2 * std),
        max: avg + 2 * std,
        inRange: { color: [colors.successLight || '#7bd389', colors.warningLight || '#ffd66b', colors.dangerLight || '#ff7b8a'] },
        textStyle: { color: textColor },
      },
      xAxis: {
        type: 'value',
        name: 'Index',
        nameTextStyle: { color: textColor },
        nameLocation: 'middle',
        nameGap: 28,
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, margin: 12 },
        min: 1,
        max: N,
      },
      yAxis: {
        type: 'value',
        name: 'Seconds',
        nameTextStyle: { color: textColor },
        nameLocation: 'end',
        nameGap: 30,
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, margin: 12 },
        min: 0,
      },
      series: [
        {
          type: 'scatter',
          name: 'Cycle Time',
          symbolSize: 5,
          large: true,
          itemStyle: {
            color: colors.primaryLight || '#6ba8ff',
            shadowBlur: 6,
            shadowColor: (colors.primary || '#3366ff') + '55',
          },
          data: points,
          emphasis: { focus: 'series', itemStyle: { color: colors.primary || '#3366ff' }, symbolSize: 7 },
          markLine: {
            symbol: 'none',
            label: { color: textColor },
            lineStyle: { color: colors.info || '#00bcd4', type: 'dashed' },
            data: [
              { yAxis: avg, name: 'Average' },
              { yAxis: p95, name: '95th %' },
            ],
          },
        },
        {
          type: 'effectScatter',
          name: 'Outliers',
          symbolSize: 6,
          rippleEffect: { brushType: 'stroke' },
          itemStyle: { color: colors.danger || '#ff3d71' },
          data: points.filter(p => p[1] >= p95),
        },
      ],
    };

    this.cyclePieOptions = {
      backgroundColor: bg,
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { color: textColor } },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: bg, borderWidth: 2 },
          label: { show: true, formatter: '{b}: {d}%', color: textColor },
          labelLine: { show: true },
          data: labels.map((name, i) => ({ name, value: counts[i] })),
        },
      ],
    };
  }

  private buildQualificationDistribution(): void {
    const echarts: any = this.themeEcharts || {};
    const colors: any = this.themeColors || {};
    const bg = echarts.bg || '#fff';
    const textColor = echarts.textColor || '#333';
    const axisLineColor = echarts.axisLineColor || '#ccc';
    const splitLineColor = echarts.splitLineColor || '#eee';

    const N = 1000;
    const mean = 100;
    const std = 10;
    const values: number[] = [];
    for (let i = 0; i < N; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      values.push(Math.max(0, Math.round(mean + std * z)));
    }

    const minX = mean - 3 * std;
    const maxX = mean + 3 * std;
    const bins = 24;
    const step = (maxX - minX) / bins;
    const centers: number[] = [];
    const counts: number[] = new Array(bins).fill(0);
    for (let i = 0; i < bins; i++) centers.push(Math.round(minX + i * step + step / 2));
    values.forEach(v => {
      if (v < minX || v > maxX) return;
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - minX) / step)));
      counts[idx]++;
    });

    const gaussian = (x: number) => Math.exp(-Math.pow(x - mean, 2) / (2 * std * std)) / (std * Math.sqrt(2 * Math.PI));
    const maxCount = counts.reduce((m, c) => Math.max(m, c), 0);
    const maxPdf = Math.max(...centers.map(c => gaussian(c)));
    const scale = maxCount / maxPdf;
    const curveData = centers.map(c => [c, gaussian(c) * scale]);

    const lines = [
      { xAxis: mean - 3 * std, name: '-3σ' },
      { xAxis: mean - 2 * std, name: '-2σ' },
      { xAxis: mean - 1 * std, name: '-1σ' },
      { xAxis: mean, name: 'μ' },
      { xAxis: mean + 1 * std, name: '+1σ' },
      { xAxis: mean + 2 * std, name: '+2σ' },
      { xAxis: mean + 3 * std, name: '+3σ' },
    ];

    const areas = [
      [{ xAxis: mean - 3 * std }, { xAxis: mean - 2 * std, itemStyle: { color: (colors.danger || '#ff3d71') + '22' } }],
      [{ xAxis: mean - 2 * std }, { xAxis: mean - 1 * std, itemStyle: { color: (colors.warning || '#ffaa00') + '22' } }],
      [{ xAxis: mean - 1 * std }, { xAxis: mean, itemStyle: { color: (colors.info || '#0095ff') + '22' } }],
      [{ xAxis: mean }, { xAxis: mean + 1 * std, itemStyle: { color: (colors.info || '#0095ff') + '22' } }],
      [{ xAxis: mean + 1 * std }, { xAxis: mean + 2 * std, itemStyle: { color: (colors.warning || '#ffaa00') + '22' } }],
      [{ xAxis: mean + 2 * std }, { xAxis: mean + 3 * std, itemStyle: { color: (colors.danger || '#ff3d71') + '22' } }],
    ];

    this.qualificationOptions = {
      backgroundColor: bg,
      tooltip: { trigger: 'axis' },
      grid: { left: '10%', right: '4%', top: '8%', bottom: '12%', containLabel: true },
      toolbox: { feature: { saveAsImage: {}, restore: {} } },
      xAxis: {
        type: 'value',
        name: 'Value',
        nameTextStyle: { color: textColor },
        nameLocation: 'middle',
        nameGap: 28,
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, margin: 12 },
        min: minX,
        max: maxX,
      },
      yAxis: {
        type: 'value',
        name: 'Count',
        nameTextStyle: { color: textColor },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, margin: 12 },
        min: 0,
      },
      series: [
        {
          type: 'bar',
          name: 'Histogram',
          itemStyle: { color: colors.primaryLight || '#6ba8ff' },
          data: centers.map((c, i) => ({ value: [c, counts[i]] })),
          barWidth: '80%',
          markLine: { symbol: 'none', label: { color: textColor }, lineStyle: { color: colors.basic || '#8f9bb3' }, data: lines },
          markArea: { data: areas },
        },
        {
          type: 'line',
          name: 'Normal',
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, color: colors.success || '#00d68f' },
          data: curveData,
        },
      ],
    };
  }

  private buildParetoChart(): void {
    const echarts: any = this.themeEcharts || {};
    const colors: any = this.themeColors || {};
    const bg = echarts.bg || '#fff';
    const textColor = echarts.textColor || '#333';
    const axisLineColor = echarts.axisLineColor || '#ccc';
    const splitLineColor = echarts.splitLineColor || '#eee';

    const defects = ['Defaut 1', 'Defaut 2', 'Defaut 3'];
    const countsBase = [180, 150, 120];
    const counts = countsBase.slice();
    const total = counts.reduce((s, v) => s + v, 0);
    const cum = [] as number[];
    let acc = 0;
    for (let i = 0; i < counts.length; i++) { acc += counts[i]; cum.push(Math.round(acc / total * 100)); }
    const percents = counts.map(c => Math.round(c / total * 100));
    const topKIndex = cum.findIndex(v => v >= 80);
    const topK = topKIndex === -1 ? counts.length : topKIndex + 1;

    this.paretoOptions = {
      backgroundColor: bg,
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const i = (params[0] || params[1])?.dataIndex ?? 0;
          const name = defects[i];
          const c = counts[i];
          const p = percents[i];
          const cp = cum[i];
          return `${name}<br/>Count: ${c}<br/>Percent: ${p}%<br/>Cumulative: ${cp}%`;
        },
      },
      grid: { left: '10%', right: '4%', top: '8%', bottom: '12%', containLabel: true },
      toolbox: { feature: { saveAsImage: {}, restore: {} } },
      xAxis: {
        type: 'category',
        data: defects,
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: textColor },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Count',
          axisLine: { lineStyle: { color: axisLineColor } },
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: { color: textColor },
        },
        {
          type: 'value',
          name: 'Cumulative %',
          min: 0,
          max: 100,
          axisLine: { lineStyle: { color: axisLineColor } },
          splitLine: { show: false },
          axisLabel: { color: textColor, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: 'Count',
          type: 'bar',
          barWidth: '50%',
          label: { show: true, position: 'top', color: textColor },
          itemStyle: {
            color: (p: any) => p.dataIndex < topK ? (colors.success || '#00d68f') : (colors.primaryLight || '#6ba8ff'),
          },
          data: counts,
        },
        {
          name: 'Cumulative',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: colors.info || '#0095ff', width: 2 },
          itemStyle: { color: colors.info || '#0095ff' },
          label: { show: true, formatter: '{c}%' },
          data: cum,
          markLine: {
            symbol: 'none',
            label: { color: textColor },
            lineStyle: { color: colors.warning || '#ffaa00', type: 'dashed' },
            data: [
              { yAxis: 80, name: '80%' },
              { yAxis: 95, name: '95%' },
            ],
          },
        },
      ],
    };
  }

  private buildFpyTrend(): void {
    const echarts: any = this.themeEcharts || {};
    const colors: any = this.themeColors || {};
    const bg = echarts.bg || '#fff';
    const textColor = echarts.textColor || '#333';
    const axisLineColor = echarts.axisLineColor || '#ccc';
    const splitLineColor = echarts.splitLineColor || '#eee';

    const days = 14;
    const labels: string[] = [];
    const values: number[] = [];
    const now = new Date();
    let base = 92;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      labels.push(`${d.getMonth()+1}/${d.getDate()}`);
      base += (Math.random() - 0.5) * 2;
      const v = Math.max(80, Math.min(99, Math.round(base + (Math.random() - 0.5) * 3)));
      values.push(v);
    }

    this.fpyOptions = {
      backgroundColor: bg,
      tooltip: { trigger: 'axis', formatter: (p) => `${p[0].axisValueLabel}<br/>FPY: ${p[0].data}%` },
      grid: { left: '10%', right: '4%', top: '8%', bottom: '12%', containLabel: true },
      toolbox: { feature: { saveAsImage: {}, restore: {} } },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { show: false },
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: 'value',
        name: 'FPY %',
        min: 0,
        max: 100,
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, formatter: '{value}%' },
      },
      series: [
        {
          type: 'line',
          name: 'FPY',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          areaStyle: { color: (colors.success || '#00d68f') + '22' },
          lineStyle: { width: 2, color: colors.success || '#00d68f' },
          itemStyle: { color: colors.success || '#00d68f' },
          label: { show: true, formatter: '{c}%' },
          data: values,
          markLine: {
            symbol: 'none',
            label: { color: textColor },
            lineStyle: { color: colors.warning || '#ffaa00', type: 'dashed' },
            data: [ { yAxis: 95, name: 'Target 95%' } ],
          },
        },
      ],
    };
  }
}