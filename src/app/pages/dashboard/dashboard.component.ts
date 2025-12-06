import {Component, OnDestroy} from '@angular/core';
import { NbThemeService, NbDialogService } from '@nebular/theme';
import { takeWhile } from 'rxjs/operators' ;
import { interval } from 'rxjs';
import { SolarData } from '../../@core/data/solar';
import { Router } from '@angular/router';
import { DefectsDetailsDialogComponent } from './defects-details-dialog.component';
import { SettingsMappingService, ProjectTesterMapping } from '../../@core/services/settings-mapping.service';
import { ProcessingService, ProjectOverviewMetric, TesterMetric } from '../../@core/services/processing.service';

interface CardSettings {
  title: string;
  iconClass: string;
  type: string;
}

@Component({
  selector: 'ngx-dashboard',
  styleUrls: ['./dashboard.component.scss'],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnDestroy {

  private alive = true;

  solarValue: number;
  lightCard: CardSettings = {
    title: 'Light',
    iconClass: 'nb-lightbulb',
    type: 'primary',
  };
  rollerShadesCard: CardSettings = {
    title: 'Roller Shades',
    iconClass: 'nb-roller-shades',
    type: 'success',
  };
  wirelessAudioCard: CardSettings = {
    title: 'Wireless Audio',
    iconClass: 'nb-audio',
    type: 'info',
  };
  coffeeMakerCard: CardSettings = {
    title: 'Coffee Maker',
    iconClass: 'nb-coffee-maker',
    type: 'warning',
  };

  statusCards: string;

  commonStatusCardsSet: CardSettings[] = [
    this.lightCard,
    this.rollerShadesCard,
    this.wirelessAudioCard,
    this.coffeeMakerCard,
  ];

  statusCardsByThemes: {
    default: CardSettings[];
    cosmic: CardSettings[];
    corporate: CardSettings[];
    dark: CardSettings[];
  } = {
    default: this.commonStatusCardsSet,
    cosmic: this.commonStatusCardsSet,
    corporate: [
      {
        ...this.lightCard,
        type: 'warning',
      },
      {
        ...this.rollerShadesCard,
        type: 'primary',
      },
      {
        ...this.wirelessAudioCard,
        type: 'danger',
      },
      {
        ...this.coffeeMakerCard,
        type: 'info',
      },
    ],
    dark: this.commonStatusCardsSet,
  };

  // KPI values duplicated from iOverview
  kpis = [
    { title: 'Active Projects', value: 12450, icon: 'checkmark-circle-2-outline' },
    { title: 'Active Testers', value: '0.7%', icon: 'checkmark-circle-2-outline' },
    { title: 'Overall FPY', value: '212 ms', icon: 'checkmark-circle-2-outline' },
    { title: 'Uptime', value: '99.97%', icon: 'checkmark-circle-2-outline' },
  ];

  // Charts options duplicated from iOverview
  throughputOptions: any = {};
  private throughputSeries: { value: [number, number] }[] = [];
  private throughputMin = 0; // timestamp for 06:30
  private throughputMax = 0; // timestamp for 22:30
  private throughputIntervalMs = 5 * 60 * 1000; // 5 minutes
  private hourStart = 6; // Start window at 06:30 (bucketed hourly from 06:30)
  private hourEnd = 22; // Kept for reference, end window at 22:30
  private hourBucketLabels: string[] = [];
  private hourBucketSums: number[] = [];
  private hourBucketCounts: number[] = [];
  private hourBucketValues: number[] = [];
  categoryBarOptions: any = {};
  distributionPieOptions: any = {};
  // Theme references for rebuilding charts dynamically
  private themeColors: any;
  private themeEcharts: any;
  // Top N selector state
  selectedTopLabel: 'All' | 'Top 3' | 'Top 5' = 'Top 3';
  // Dynamic height for category chart container
  categoryChartHeight: number = 420;
  projectAvgOptions: any = {};
  testerBarOptions: any = {};
  selectedProjectName: string = '';
  availableProjectNames: string[] = [];
  projectRowOptions: {
    name: string;
    avg: number;
    accent: 'success' | 'warning' | 'danger' | 'info' | 'primary';
    avgColor: string;
    pie: any;
    bar: any;
  }[] = [];
  private fpyDisplayData: { name: string; avg: number; pairs: { tester: string; value: number }[] }[] = [];
  // Source data for projects and testers FPY used by the category chart
  private projectsWithAvgFpy: {
    projectName: string;
    avgFpy: number;
    testers: { tester: string; avgFpy: number }[];
  }[] = [
    {
      projectName: 'Project A',
      testers: [
        { tester: 'A_T1', avgFpy: 96.2 },
        { tester: 'A_T2', avgFpy: 93.8 },
        { tester: 'A_T3', avgFpy: 91.4 },
      ],
      avgFpy: 0,
    },
    {
      projectName: 'Project B',
      testers: [
        { tester: 'B_T1', avgFpy: 97.1 },
        { tester: 'B_T2', avgFpy: 94.9 },
        { tester: 'B_T3', avgFpy: 92.7 },
        { tester: 'B_T4', avgFpy: 90.2 },
      ],
      avgFpy: 0,
    },
    {
      projectName: 'Project C',
      testers: [
        { tester: 'C_T1', avgFpy: 88.5 },
        { tester: 'C_T2', avgFpy: 86.2 },
      ],
      avgFpy: 0,
    },
    {
      projectName: 'Project D',
      testers: [
        { tester: 'D_T1', avgFpy: 98.0 },
        { tester: 'D_T2', avgFpy: 96.4 },
        { tester: 'D_T3', avgFpy: 95.1 },
        { tester: 'D_T4', avgFpy: 93.6 },
        { tester: 'D_T5', avgFpy: 92.4 },
      ],
      avgFpy: 0,
    },
  ];

  constructor(private themeService: NbThemeService,
              private solarService: SolarData,
              private router: Router,
              private dialogService: NbDialogService,
              private mapping: SettingsMappingService,
              private processing: ProcessingService) {
    this.themeService.getJsTheme()
      .pipe(takeWhile(() => this.alive))
      .subscribe(theme => {
        this.statusCards = this.statusCardsByThemes[theme.name];

        const colors: any = theme.variables;
        const echarts: any = theme.variables.echarts;
        this.themeColors = colors;
        this.themeEcharts = echarts;

        // initialize real-time throughput chart options
        // set fixed time window: 06:30 to 22:30 for today
        this.initThroughputTimeWindow();
        this.throughputOptions = {
          backgroundColor: echarts.bg,
          color: [colors.primary],
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
              const p = Array.isArray(params) ? params[0] : params;
              const idx = p?.dataIndex ?? 0;
              const label = this.hourBucketLabels[idx] || '';
              const v = Number(p?.value ?? 0);
              const color = v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
              return `${label}<br/>`
                + `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:8px;height:8px;background:${color}"></span>`
                + `FPY: ${v.toFixed(2)}%`;
            },
          },
          grid: { left: '3%', right: '3%', top: '8%', bottom: '6%', containLabel: true },
          xAxis: {
            type: 'category',
            boundaryGap: true,
            data: this.hourBucketLabels,
            axisLine: { lineStyle: { color: echarts.axisLineColor } },
            axisLabel: { color: echarts.textColor },
            axisTick: { show: false },
            splitLine: { show: true, lineStyle: { color: echarts.splitLineColor, type: 'dashed' } },
          },
          yAxis: {
            type: 'value',
            min: 0,
            max: 100,
            axisLine: { lineStyle: { color: echarts.axisLineColor } },
            splitLine: { lineStyle: { color: echarts.splitLineColor } },
            axisLabel: { 
              color: echarts.textColor,
              formatter: (val: number) => `${Math.round(val)}%`,
            },
          },
          series: [
            {
              name: 'FPY',
              type: 'bar',
              barWidth: '60%',
              barCategoryGap: '35%',
              animation: true,
              animationDurationUpdate: 600,
              animationEasingUpdate: 'cubicOut',
              label: {
                show: true,
                position: 'top',
                formatter: (p) => `${Number(p.value as number).toFixed(2)}%`,
                color: echarts.textColor,
                fontSize: 12,
                offset: [0, -4],
              },
              itemStyle: {
                shadowColor: 'rgba(0, 0, 0, 0.15)',
                shadowBlur: 6,
                borderRadius: [6, 6, 0, 0],
                color: (params) => {
                  const v = params.value as number;
                  if (v >= 97) return '#00C853';
                  if (v >= 90) return '#FFD600';
                  return '#D50000';
                },
              },
              emphasis: {
                focus: 'series',
                itemStyle: {
                  shadowColor: 'rgba(0, 0, 0, 0.3)',
                  shadowBlur: 8,
                },
              },
              markLine: {
                symbol: ['none', 'none'],
                label: { color: echarts.textColor },
                data: [
                  { yAxis: 97, name: 'Target 97%', lineStyle: { color: '#00C853', width: 2 } },
                  { yAxis: 90, name: 'Floor 90%', lineStyle: { color: '#D50000', type: 'dashed' } },
                  { type: 'average', name: 'Avg' },
                ],
              },
              markArea: {
                silent: true,
                data: [
                  [
                    { yAxis: 90, itemStyle: { color: 'rgba(213, 0, 0, 0.10)' } },
                    { yAxis: 90 },
                  ],
                  [
                    { yAxis: 90, itemStyle: { color: 'rgba(255, 214, 0, 0.12)' } },
                    { yAxis: 97 },
                  ],
                ],
              },
              data: this.hourBucketValues,
            },
          ],
        };

        // seed initial points based on a baseline and start live updates every 5 minutes
        this.seedInitialThroughput();
        this.startThroughputLiveUpdates();

        // Build category chart based on Top N selection
        this.rebuildCategoryChart();

        this.distributionPieOptions = {
          backgroundColor: echarts.bg,
          tooltip: { trigger: 'item' },
          color: [colors.primary, colors.info, colors.success, colors.warning, colors.danger],
          series: [
            {
              name: 'Share',
              type: 'pie',
              radius: ['40%', '70%'],
              avoidLabelOverlap: false,
              itemStyle: { borderColor: echarts.bg, borderWidth: 2 },
              label: { show: false },
              emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
              labelLine: { show: false },
              data: [
                { value: 35, name: 'API' },
                { value: 20, name: 'DB' },
                { value: 25, name: 'Cache' },
                { value: 10, name: 'Queue' },
                { value: 10, name: 'UI' },
              ],
            },
          ],
        };
    });

    // Subscribe to Settings mapping and populate projects/testers for overview charts
    this.mapping.mapping$
      .pipe(takeWhile(() => this.alive))
      .subscribe((map: ProjectTesterMapping) => {
        this.buildProjectsFromMapping(map);
      });

    this.solarService.getSolarData()
      .pipe(takeWhile(() => this.alive))
      .subscribe((data) => {
        this.solarValue = data;
      });

    // Try to load real overview metrics from API (fallback to synthetic if unavailable)
    this.loadOverviewMetrics();
  }

  private computeTesterFpy(tester: string): number {
    // Deterministic pseudo FPY based on tester name for demo purposes
    let sum = 0;
    for (let i = 0; i < tester.length; i++) sum += tester.charCodeAt(i);
    const delta = (sum % 12) - 6; // -6..5
    let val = 95 + delta;
    if (val < 85) val = 85;
    if (val > 99) val = 99;
    return Math.round(val * 10) / 10;
  }

  private buildProjectsFromMapping(map: ProjectTesterMapping): void {
    if (!map) return;
    const items = Object.entries(map).map(([projectName, testers]) => {
      const testerObjs = (testers || []).map(t => ({ tester: t, avgFpy: this.computeTesterFpy(t) }));
      const avg = testerObjs.length
        ? Math.round((testerObjs.reduce((s, x) => s + x.avgFpy, 0) / testerObjs.length) * 10) / 10
        : 0;
      return { projectName, testers: testerObjs, avgFpy: avg };
    });
    this.projectsWithAvgFpy = items;
    this.rebuildCategoryChart();
  }

  private loadOverviewMetrics(): void {
    this.processing.getOverviewMetrics()
      .pipe(takeWhile(() => this.alive))
      .subscribe({
        next: (metrics: ProjectOverviewMetric[]) => {
          if (Array.isArray(metrics) && metrics.length) {
            this.applyOverviewMetrics(metrics);
          }
        },
        error: () => {
          // Silent fallback: keep synthetic data built from Settings mapping
        },
      });
  }

  private applyOverviewMetrics(metrics: ProjectOverviewMetric[]): void {
    // Transform API metrics into local structure used by charts
    const items = (metrics || []).map(m => {
      const testerObjs = (m.testers || [])
        .map((t: TesterMetric) => ({ tester: String(t.name), avgFpy: Number(t.fpy || 0) }));
      const avg = testerObjs.length
        ? Math.round((testerObjs.reduce((s, x) => s + x.avgFpy, 0) / testerObjs.length) * 10) / 10
        : 0;
      return { projectName: String(m.project), testers: testerObjs, avgFpy: avg };
    });

    this.projectsWithAvgFpy = items;
    this.rebuildCategoryChart();

    // Update KPI values from metrics
    const projectCount = items.length;
    const testerCount = items.reduce((s, p) => s + (p.testers?.length || 0), 0);
    const allTesterFpys = items
      .map(p => (p.testers || []).map(t => t.avgFpy))
      .reduce((acc, arr) => acc.concat(arr), [] as number[]);
    const overallAvg = allTesterFpys.length
      ? Math.round((allTesterFpys.reduce((s, v) => s + v, 0) / allTesterFpys.length) * 10) / 10
      : 0;

    this.kpis = [
      { title: 'Active Projects', value: projectCount, icon: 'checkmark-circle-2-outline' },
      { title: 'Active Testers', value: testerCount, icon: 'checkmark-circle-2-outline' },
      { title: 'Overall FPY', value: `${overallAvg.toFixed(1)}%`, icon: 'checkmark-circle-2-outline' },
      { title: 'Uptime', value: '99.97%', icon: 'checkmark-circle-2-outline' },
    ];
  }

  ngOnDestroy() {
    this.alive = false;
  }

  private initThroughputTimeWindow() {
    // Set fixed window: 06:30 to 22:30 and initialize hourly buckets
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 6, 30, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 22, 30, 0, 0);
    this.throughputMin = start.getTime();
    this.throughputMax = end.getTime();

    // Initialize hourly bucket labels and storage for FPY values
    this.hourBucketLabels = [];
    this.hourBucketSums = [];
    this.hourBucketCounts = [];
    this.hourBucketValues = [];

    // Build labels every hour starting from 06:30 to 22:30 (16 buckets)
    const bucketCount = 16;
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = new Date(this.throughputMin + i * 60 * 60 * 1000);
      const bucketEnd = new Date(this.throughputMin + (i + 1) * 60 * 60 * 1000);
      const label = `${String(bucketStart.getHours()).padStart(2, '0')}:${String(bucketStart.getMinutes()).padStart(2, '0')}` +
                    `-${String(bucketEnd.getHours()).padStart(2, '0')}:${String(bucketEnd.getMinutes()).padStart(2, '0')}`;
      this.hourBucketLabels.push(label);
      this.hourBucketSums.push(0);
      this.hourBucketCounts.push(0);
      this.hourBucketValues.push(0);
    }
  }

  private seedInitialThroughput() {
    // Seed values from 06:30 to now in 5-minute steps, accumulate hourly bucket averages
    const now = Date.now();
    const base = 95; // baseline FPY percentage
    const jitter = () => (Math.random() - 0.5) * 2.5; // +/- ~1.25

    let last = base;
    for (let t = this.throughputMin; t <= Math.min(now, this.throughputMax); t += this.throughputIntervalMs) {
      last = Math.min(100, Math.max(60, last + jitter()));
      const idx = Math.floor((t - this.throughputMin) / (60 * 60 * 1000));
      if (idx >= 0 && idx < this.hourBucketLabels.length) {
        this.hourBucketCounts[idx] += 1;
        this.hourBucketSums[idx] += last;
        this.hourBucketValues[idx] = Math.round((this.hourBucketSums[idx] / this.hourBucketCounts[idx]) * 100) / 100;
      }
    }
    this.applyThroughputUpdate();
  }

  private startThroughputLiveUpdates() {
    interval(this.throughputIntervalMs)
      .pipe(takeWhile(() => this.alive))
      .subscribe(() => {
        const now = Date.now();
        if (now > this.throughputMax) {
          // stop updates after 22:30
          this.alive = false;
          return;
        }
        if (now < this.throughputMin) {
          return; // outside of visualization window
        }
        const idx = Math.floor((now - this.throughputMin) / (60 * 60 * 1000));
        const prev = this.hourBucketValues[idx] || 95;
        const next = Math.min(100, Math.max(60, prev + (Math.random() - 0.5) * 2.0));
        this.hourBucketCounts[idx] += 1;
        this.hourBucketSums[idx] += next;
        this.hourBucketValues[idx] = Math.round((this.hourBucketSums[idx] / this.hourBucketCounts[idx]) * 100) / 100;
        this.applyThroughputUpdate();
      });
  }

  private applyThroughputUpdate() {
    // Reassign options object to trigger change detection in ngx-echarts
    if (!this.throughputOptions) return;
    this.throughputOptions = {
      ...this.throughputOptions,
      xAxis: {
        ...this.throughputOptions.xAxis,
        data: [...this.hourBucketLabels],
      },
      series: [
        {
          ...this.throughputOptions.series[0],
          data: [...this.hourBucketValues],
        },
      ],
    };
  }

  private formatTimeLabel(d: Date): string {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  onTopChange(val: 'All' | 'Top 3' | 'Top 5') {
    this.selectedTopLabel = val;
    this.rebuildCategoryChart();
  }

  private rebuildCategoryChart() {
    const echarts: any = this.themeEcharts;
    const colors: any = this.themeColors;
    if (!echarts || !colors) return;

    // Use real data: projects with avg FPY and testers
    const raw = (this.projectsWithAvgFpy || [])
      .filter(p => p && p.projectName && Array.isArray(p.testers))
      .map(p => {
        const pairs = (p.testers || [])
          .filter(t => t && t.tester && typeof t.avgFpy === 'number')
          .map(t => ({ tester: String(t.tester), value: Number(t.avgFpy) }))
          .sort((a, b) => b.value - a.value);
        const avgVal = pairs.length ? Math.round((pairs.reduce((s, x) => s + x.value, 0) / pairs.length) * 100) / 100 : 0;
        return { name: p.projectName, avg: avgVal, pairs };
      })
      .sort((a, b) => a.avg - b.avg);

    // Apply Top N selection (lowest average first)
    const toCount = (label: string) => label === 'Top 3' ? 3 : label === 'Top 5' ? 5 : null;
    const limit = toCount(this.selectedTopLabel);
    const display = limit ? raw.slice(0, limit) : raw;
    const rowCount = display.length || 1;

    // Layout proportions
    const topTitlePct = 4;
    const bottomPct = 4;
    const perRowPct = (100 - topTitlePct - bottomPct) / rowCount;

    // Save processed display data for drilldown
    this.fpyDisplayData = display;

    // Build per-project row charts: pie (FPY vs Non-FPY) + bar (tester FPY)
    this.projectRowOptions = display.map(d => {
      const testerLabels = d.pairs.map(p => p.tester);
      const testerVals = d.pairs.map(p => p.value);
      const accent: 'success' | 'warning' | 'danger' = d.avg >= 97 ? 'success' : d.avg >= 90 ? 'warning' : 'danger';
      const avgColor = d.avg >= 97 ? '#00C853' : d.avg >= 90 ? '#FFD600' : '#D50000';

      const bar: any = {
        backgroundColor: echarts.bg,
        grid: { left: 40, right: 20, top: 30, bottom: 60 },
        xAxis: [{
          type: 'category',
          data: testerLabels,
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
        series: [{
          name: 'Tester FPY',
          type: 'bar',
          data: testerVals,
          barWidth: 30,
          barCategoryGap: '15%',
          itemStyle: {
            color: (p: any) => {
              const v = Array.isArray(p.value) ? p.value[0] : p.value;
              return v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
            },
            borderRadius: [6, 6, 0, 0],
            shadowBlur: 6,
            shadowColor: 'rgba(0,0,0,0.25)',
          },
          emphasis: {
            itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.35)' },
          },
          label: { show: true, position: 'top', formatter: ({ value }: any) => `${Number(value).toFixed(1)}%`, color: echarts.textColor, fontSize: 12, fontWeight: 600 },
          markLine: {
            symbol: ['none', 'none'],
            label: { color: echarts.textColor },
            data: [
              { yAxis: 97, name: 'Target 97%', lineStyle: { color: '#00C853', width: 2 } },
              { yAxis: 90, name: 'Floor 90%', lineStyle: { color: '#D50000', type: 'dashed' } },
            ],
          },
        }],
        tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${Number(p.value).toFixed(2)}% FPY` },
        legend: { show: true, type: 'scroll', top: 0, data: testerLabels, selectedMode: false, textStyle: { color: echarts.textColor, fontSize: 12 } },
        animationDuration: 500,
        animationEasing: 'cubicOut',
      };

      if (testerLabels.length > 6) {
        bar.dataZoom = [
          { type: 'slider', start: 0, end: 100, height: 16, bottom: 28 },
          { type: 'inside' },
        ];
      }

      const pie = {
        backgroundColor: echarts.bg,
        tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${Number(p.value).toFixed(2)}%` },
        legend: { show: true, bottom: 0, textStyle: { color: echarts.textColor } },
        series: [{
          name: 'FPY Share',
          type: 'pie',
          radius: ['50%', '70%'],
          avoidLabelOverlap: true,
          label: { show: true, formatter: '{b}: {d}%' },
          labelLine: { show: true },
          data: [
            { value: d.avg, name: 'FPY', itemStyle: { color: '#00C853' } },
            { value: Math.max(0, 100 - d.avg), name: 'Defects', itemStyle: { color: '#D50000' } },
          ],
        }],
        graphic: [{
          type: 'text',
          left: 'center',
          top: 'center',
          style: {
            text: `${d.avg.toFixed(1)}%`,
            fill: echarts.textColor,
            fontSize: 16,
            fontWeight: 600,
          },
        }],
      };

      return { name: d.name, avg: d.avg, accent, avgColor, pie, bar };
    });

    this.categoryChartHeight = 380;
  }

  private buildTesterChartFor(name: string, echarts: any) {
    const proj = this.fpyDisplayData.find(p => p.name === name);
    if (!proj || !echarts) return;
    const testerLabels = proj.pairs.map(p => p.tester);
    const testerVals = proj.pairs.map(p => p.value);
    const series = [{
      name: name,
      type: 'bar',
      data: testerVals,
      barWidth: 24,
      barCategoryGap: '25%',
      itemStyle: {
        color: (p: any) => {
          const v = Array.isArray(p.value) ? p.value[0] : p.value;
          return v >= 97 ? '#00C853' : v >= 90 ? '#FFD600' : '#D50000';
        },
        borderRadius: [6, 6, 0, 0],
      },
      label: {
        show: true,
        position: 'top',
        formatter: ({ value }: any) => `${Number(value).toFixed(1)}%`,
        color: echarts.textColor,
        fontSize: 11,
      },
    }];
    this.testerBarOptions = {
      backgroundColor: echarts.bg,
      grid: { left: 40, right: 24, top: 40, bottom: 60 },
      xAxis: [{
        type: 'category',
        data: testerLabels,
        axisLabel: { interval: 0, rotate: 30, color: echarts.textColor, margin: 8 },
        axisLine: { lineStyle: { color: echarts.axisLineColor } },
        axisTick: { show: false },
      }],
      yAxis: [{
        type: 'value', min: 0, max: 100,
        axisLabel: { formatter: '{value}%', color: echarts.textColor },
        axisLine: { lineStyle: { color: echarts.axisLineColor } },
        splitLine: { show: true, lineStyle: { color: echarts.splitLineColor } },
      }],
      series,
      title: [{ text: `${name} • Tester FPY`, left: 'center', top: 8, textStyle: { color: echarts.textColor } }],
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${Number(p.value).toFixed(2)}% FPY` },
      legend: { show: false },
      animationDuration: 500,
      animationEasing: 'cubicOut',
    };
  }

  onProjectBarClick(evt: any) {
    const name = evt?.name;
    if (!name) return;
    this.selectedProjectName = name;
    this.buildTesterChartFor(name, this.themeEcharts);
  }

  onProjectSelect(name: string) {
    if (!name) return;
    this.selectedProjectName = name;
    this.buildTesterChartFor(name, this.themeEcharts);
  }

  attachBarClick(projectName: string, chart: any) {
    if (!chart || !projectName) return;
    try {
      chart.off('click');
    } catch {}
    chart.on('click', (params: any) => {
      if (params && params.seriesType === 'bar') {
        const tester = params.name;
        if (tester) {
          this.router.navigate(['/pages/analysis'], {
            queryParams: { project: projectName, tester },
          });
        }
      }
    });
  }

  attachPieClick(projectName: string, chart: any) {
    if (!chart || !projectName) return;
    try {
      chart.off('click');
    } catch {}
    chart.on('click', (params: any) => {
      if (params && params.seriesType === 'pie') {
        const slice = params.name;
        if (slice === 'Defects') {
          const proj = this.projectsWithAvgFpy.find(p => p.projectName === projectName);
          const avg = proj?.avgFpy ?? 0;
          const testers = proj?.testers ?? [];
          this.dialogService.open(DefectsDetailsDialogComponent, {
            context: {
              projectName,
              avgFpy: avg,
              testers,
            },
            closeOnEsc: true,
            closeOnBackdropClick: true,
            autoFocus: true,
          });
        }
      }
    });
  }
}
