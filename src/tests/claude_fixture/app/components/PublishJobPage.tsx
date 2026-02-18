import { useState } from 'react';
import { X, Briefcase, MapPin, Target, BookOpen, Clock, Banknote, Loader2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { publishDistributedContent } from '../data/distributedContent';
import { useLocale } from '../i18n/LocaleContext';
import { getPublishLocationErrorMessage } from '../utils/publishLocationError';
import { useHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';

interface PublishJobPageProps {
    onClose: () => void;
}

export default function PublishJobPage({ onClose }: PublishJobPageProps) {
    const { t } = useLocale();
    const [name, setName] = useState('');
    const [title, setTitle] = useState('');
    const [experience, setExperience] = useState('');
    const [education, setEducation] = useState('');
    const [salary, setSalary] = useState('');
    const [locationInput, setLocationInput] = useState('');
    const [skills, setSkills] = useState('');
    const [intro, setIntro] = useState('');
    const [jobType, setJobType] = useState('fulltime');
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');
    const { location, error: locationError, status: locationStatus, fetchLocation } = useHighAccuracyLocation();

    const handlePublish = async () => {
        if (isPublishing) {
            return;
        }
        setPublishError('');
        setIsPublishing(true);
        const summary = `${title} · ${name} · ${locationInput} · ${salary}`;
        try {
            await publishDistributedContent({
                publishCategory: 'job',
                type: 'text',
                content: summary,
                locationHint: {
                    city: locationInput.trim() || undefined,
                },
                extra: {
                    jobMeta: {
                        name, title, experience, education, salary, location: locationInput, skills: skills.split(',').map(s => s.trim()), intro, jobType
                    }
                }
            });
            onClose();
        } catch (error) {
            setPublishError(getPublishLocationErrorMessage(t, error));
        } finally {
            setIsPublishing(false);
        }
    };

    const canPublish = name && title && locationInput && salary;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24} /></button>
                <h1 className="font-semibold text-lg">{t.pubJob_title}</h1>
                <button onClick={handlePublish} disabled={!canPublish || isPublishing} className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish && !isPublishing ? 'bg-cyan-500 text-white hover:bg-cyan-600' : 'bg-gray-200 text-gray-400'}`}>{isPublishing ? t.common_loading : t.pub_publish}</button>
            </header>
            {publishError && (
                <div className="px-4 py-2 text-sm text-red-600 bg-red-50 border-b border-red-100">
                    {publishError}
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <div className="p-4 bg-cyan-50 rounded-xl mb-4">
                    <h3 className="font-semibold text-cyan-800 mb-2">{t.pubJob_jobType}</h3>
                    <div className="flex gap-2">
                        <button onClick={() => setJobType('fulltime')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${jobType === 'fulltime' ? 'bg-cyan-500 text-white shadow-sm' : 'bg-white text-cyan-600 border border-cyan-200'}`}>{t.pubJob_fullTime}</button>
                        <button onClick={() => setJobType('parttime')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${jobType === 'parttime' ? 'bg-cyan-500 text-white shadow-sm' : 'bg-white text-cyan-600 border border-cyan-200'}`}>{t.pubJob_partTime}</button>
                        <button onClick={() => setJobType('intern')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${jobType === 'intern' ? 'bg-cyan-500 text-white shadow-sm' : 'bg-white text-cyan-600 border border-cyan-200'}`}>{t.pubJob_intern}</button>
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Target size={16} />{t.pubJob_desiredPosition}</h3>
                        <input type="text" placeholder={t.pubJob_positionPh} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Briefcase size={16} />{t.pubJob_yourName}</h3>
                        <input type="text" placeholder={t.pubJob_yourName} value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Banknote size={16} />{t.pubJob_expectedSalary}</h3>
                        <input type="text" placeholder={t.pubJob_salaryPh} value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><Clock size={16} />{t.pubJob_experience}</h3>
                            <input type="text" placeholder={t.pubJob_experiencePh} value={experience} onChange={(e) => setExperience(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        </div>
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2"><BookOpen size={16} />{t.pubJob_education}</h3>
                            <input type="text" placeholder={t.pubJob_selectEducation} value={education} onChange={(e) => setEducation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        </div>
                    </div>

                    {/* Location */}
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2"><MapPin size={16} />{t.pub_location}</h3>
                        <input
                            type="text"
                            value={locationInput}
                            onChange={(e) => setLocationInput(e.target.value)}
                            placeholder={t.pubJob_cityPh}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                        <p className="mt-1 text-xs text-gray-400">{t.publish_location_required_hint}</p>

                        {/* Location Status */}
                        <div className="mt-2 flex items-center gap-2 text-sm">
                            {locationStatus === 'loading' && (
                                <span className="flex items-center gap-1.5 text-gray-500">
                                    <Loader2 size={14} className="animate-spin" />
                                    {t.publish_location_collecting}
                                </span>
                            )}
                            {locationStatus === 'success' && (
                                <span className="flex items-center gap-1.5 text-green-600 bg-green-50 px-2 py-1 rounded-md">
                                    <CheckCircle2 size={14} />
                                    {t.publish_location_success}
                                </span>
                            )}
                            {locationStatus === 'error' && (
                                <div className="flex items-center gap-2">
                                    <span className="flex items-center gap-1.5 text-red-500 bg-red-50 px-2 py-1 rounded-md">
                                        <AlertCircle size={14} />
                                        {t.publish_location_failed}
                                    </span>
                                    <button
                                        onClick={fetchLocation}
                                        className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                                        title={t.publish_location_retry}
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubJob_skills}</h3>
                        <textarea placeholder={t.pubJob_addSkill} value={skills} onChange={(e) => setSkills(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">{t.pubJob_intro}</h3>
                        <textarea placeholder={t.pubJob_introPh} value={intro} onChange={(e) => setIntro(e.target.value)} className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                    </div>
                </div>
            </div>
        </div>
    );
}
