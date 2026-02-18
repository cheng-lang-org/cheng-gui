export type Gender = '男' | '女';
export type CalendarType = 'solar' | 'lunar';

export type LateZiBoundary = '23:00' | '00:00';

export interface BirthInput {
    calendar: CalendarType;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    timezone: string;
    longitude?: number;
    gender: Gender;
}

export interface AstrologyRuleProfile {
    profileId: 'wenmo-basic-v1';
    useTrueSolarTime: boolean;
    lateZiBoundary: LateZiBoundary;
    monthBoundary: 'jieqi';
    dayunStartMode: 'exact-jieqi-diff';
    ziweiDaxianDirection: 'gender-year-yinyang';
}

export interface InterpretationResult {
    summary: string;
    sections: Array<{ key: string; title: string; content: string }>;
    qaHints: string[];
}

export interface AstrologyRecord<TChart = unknown> {
    id: string;
    type: 'bazi' | 'ziwei';
    createdAt: number;
    updatedAt: number;
    title: string;
    input: BirthInput;
    profile: AstrologyRuleProfile;
    chart: TChart;
    interpretation?: InterpretationResult;
}
