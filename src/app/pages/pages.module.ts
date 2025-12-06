import { NgModule } from '@angular/core';
import { NbCardModule, NbMenuModule, NbIconModule, NbSelectModule, NbInputModule, NbDatepickerModule, NbCalendarModule, NbAccordionModule, NbButtonModule, NbButtonGroupModule, NbBadgeModule, NbSpinnerModule, NbProgressBarModule, NbRadioModule, NbStepperModule } from '@nebular/theme';
import { FormsModule } from '@angular/forms';
import { NgxEchartsModule } from 'ngx-echarts';

import { ThemeModule } from '../@theme/theme.module';
import { PagesComponent } from './pages.component';
import { Ng2SmartTableModule } from 'ng2-smart-table';
import { SettingComponent } from './setting/setting.component';
import { DataComponent } from './data/data.component';
import { PagesRoutingModule } from './pages-routing.module';
import { MiscellaneousModule } from './miscellaneous/miscellaneous.module';
import { ProductTrackerComponent } from './product-tracker/product-tracker.component';

@NgModule({
  imports: [
    PagesRoutingModule,
    ThemeModule,
    NbMenuModule,
    NbCardModule,
    NbIconModule,
    NbSelectModule,
    NbInputModule,
    NbDatepickerModule,
    NbCalendarModule,
    NbAccordionModule,
    NbButtonModule,
    NbButtonGroupModule,
    NbBadgeModule,
    NbSpinnerModule,
    NbProgressBarModule,
    NbRadioModule,
    NbStepperModule,
    FormsModule,
    NgxEchartsModule,
    MiscellaneousModule,
    Ng2SmartTableModule,
  ],
  declarations: [
    PagesComponent,
    AnalysisComponent,
    SettingComponent,
    DataComponent,
    ProductTrackerComponent,
  ],
})
export class PagesModule {
}
import { AnalysisComponent } from './analysis/analysis.component';
