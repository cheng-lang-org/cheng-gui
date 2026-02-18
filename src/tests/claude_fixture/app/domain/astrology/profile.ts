import type { AstrologyRuleProfile } from './types';

export const WENMO_BASIC_PROFILE: AstrologyRuleProfile = {
    profileId: 'wenmo-basic-v1',
    useTrueSolarTime: false,
    lateZiBoundary: '00:00',
    monthBoundary: 'jieqi',
    dayunStartMode: 'exact-jieqi-diff',
    ziweiDaxianDirection: 'gender-year-yinyang',
};

export function mergeProfile(partial?: Partial<AstrologyRuleProfile>): AstrologyRuleProfile {
    return {
        ...WENMO_BASIC_PROFILE,
        ...partial,
        profileId: 'wenmo-basic-v1',
        monthBoundary: 'jieqi',
        dayunStartMode: 'exact-jieqi-diff',
        ziweiDaxianDirection: 'gender-year-yinyang',
    };
}
