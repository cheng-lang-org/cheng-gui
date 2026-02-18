import { useState } from 'react';
import { X, Building2, MapPin, DollarSign, Users, Clock, GraduationCap } from 'lucide-react';
import { publishDistributedContent } from '../data/distributedContent';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';

interface PublishHirePageProps {
    onClose: () => void;
}

export default function PublishHirePage({ onClose }: PublishHirePageProps) {
    const { t } = useLocale();
    const [companyName, setCompanyName] = useState('');
    const [jobTitle, setJobTitle] = useState('');
    const [salaryMin, setSalaryMin] = useState('');
    const [salaryMax, setSalaryMax] = useState('');
    const [location, setLocation] = useState('');
    const [headcount, setHeadcount] = useState('1');
    const [experience, setExperience] = useState('');
    const [education, setEducation] = useState('');
    const [jobType, setJobType] = useState(t.pubJob_fullTime);
    const [description, setDescription] = useState('');
    const [requirements, setRequirements] = useState('');
    const [benefits, setBenefits] = useState<string[]>([]);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');

    const educations = [t.pubHire_noLimit, t.pubJob_highSchool, t.pubJob_associate, t.pubJob_bachelor, t.pubJob_master, t.pubJob_phd];
    const experiences = [t.pubHire_noLimit, t.pubHire_freshman, t.pubHire_exp1_3, t.pubHire_exp3_5, t.pubHire_exp5_10, t.pubHire_exp10Plus];
    const jobTypes = [t.pubJob_fullTime, t.pubJob_partTime, t.pubJob_intern, t.pubJob_remote];
    const benefitOptions = [t.hire_insurance, t.hire_paidLeave, t.hire_flexWork, t.hire_freeMeals, t.hire_teamBuilding, t.hire_stockOptions, t.hire_training, t.hire_yearEndBonus];

    const toggleBenefit = (benefit: string) => {
        setBenefits(prev => prev.includes(benefit) ? prev.filter(b => b !== benefit) : [...prev, benefit]);
    };

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const salaryLabel = salaryMin && salaryMax ? `${salaryMin}-${salaryMax}K` : t.pubHire_salaryNegotiable;
        const summary = `${companyName} ${t.pubHire_jobTitle} ${jobTitle} · ${location} · ${salaryLabel}`;
        try {
            console.log('Publishing hiring:', { companyName, jobTitle, salaryMin, salaryMax, location, headcount, experience, education, jobType, description, requirements, benefits });
            await publishDistributedContent({
                publishCategory: 'hire',
                type: 'text',
                content: summary,
                locationHint: {
                    city: location.trim() || undefined,
                },
            });
            onClose();
        } catch (error) {
            setPublishError(getPublishLocationErrorMessage(t, error));
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = companyName && jobTitle && location;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">{t.pubHire_title}</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish || isPublishing}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing ? 'bg-pink-500 text-white hover:bg-pink-600' : 'bg-gray-200 text-gray-400'}`}
                >
                    {isPublishing ? t.common_loading : t.pub_publish}
                </button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Building2 size={14} />{t.pubHire_companyName}</h3>
                    <input type="text" placeholder={t.pubHire_companyNamePh} value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <input type="text" placeholder={t.pubHire_jobTitle} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                {/* 工作类型 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} />{t.pubHire_jobType}</h3>
                    <div className="flex flex-wrap gap-2">
                        {jobTypes.map(type => (
                            <button key={type} onClick={() => setJobType(type)} className={`px-4 py-2 rounded-full text-sm ${jobType === type ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><DollarSign size={14} />{t.pubHire_salary}</h3>
                        <div className="flex items-center gap-2">
                            <input type="number" placeholder={t.pubHire_salaryPh} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                            <span>-</span>
                            <input type="number" placeholder={t.pubHire_salaryPh} value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Users size={14} />{t.pubHire_headcount}</h3>
                        <input type="number" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" min="1" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubHire_experience}</h3>
                        <select value={experience} onChange={(e) => setExperience(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            {experiences.map(exp => <option key={exp} value={exp}>{exp}</option>)}
                        </select>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><GraduationCap size={14} />{t.pubHire_education}</h3>
                        <select value={education} onChange={(e) => setEducation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            {educations.map(edu => <option key={edu} value={edu}>{edu}</option>)}
                        </select>
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} />{t.pubHire_location}</h3>
                    <input type="text" placeholder={t.pubHire_locationPh} value={location} onChange={(e) => setLocation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    <p className="mt-1 text-xs text-gray-400">{t.publish_location_required_hint}</p>
                </div>

                {/* 福利待遇 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubHire_benefits}</h3>
                    <div className="flex flex-wrap gap-2">
                        {benefitOptions.map(benefit => (
                            <button key={benefit} onClick={() => toggleBenefit(benefit)} className={`px-3 py-1.5 rounded-full text-sm ${benefits.includes(benefit) ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                {benefit}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubHire_jobDesc}</h3>
                    <textarea placeholder={t.pubHire_jobDescPh} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubHire_requirements}</h3>
                    <textarea placeholder={t.pubHire_requirementsPh} value={requirements} onChange={(e) => setRequirements(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>
            </div>
        </div>
    );
}
