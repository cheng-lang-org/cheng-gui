import { useState } from 'react';
import { X, Building2, MapPin, DollarSign, Users, Clock, GraduationCap } from 'lucide-react';

interface PublishHirePageProps {
    onClose: () => void;
}

export default function PublishHirePage({ onClose }: PublishHirePageProps) {
    const [companyName, setCompanyName] = useState('');
    const [jobTitle, setJobTitle] = useState('');
    const [salaryMin, setSalaryMin] = useState('');
    const [salaryMax, setSalaryMax] = useState('');
    const [location, setLocation] = useState('');
    const [headcount, setHeadcount] = useState('1');
    const [experience, setExperience] = useState('');
    const [education, setEducation] = useState('');
    const [jobType, setJobType] = useState('全职');
    const [description, setDescription] = useState('');
    const [requirements, setRequirements] = useState('');
    const [benefits, setBenefits] = useState<string[]>([]);

    const educations = ['不限', '高中', '大专', '本科', '硕士', '博士'];
    const experiences = ['不限', '应届生', '1-3年', '3-5年', '5-10年', '10年以上'];
    const jobTypes = ['全职', '兼职', '实习', '远程'];
    const benefitOptions = ['五险一金', '带薪年假', '弹性工作', '免费餐饮', '团建活动', '股票期权', '培训机会', '年终奖'];

    const toggleBenefit = (benefit: string) => {
        setBenefits(prev => prev.includes(benefit) ? prev.filter(b => b !== benefit) : [...prev, benefit]);
    };

    const handlePublish = () => {
        console.log('Publishing hiring:', { companyName, jobTitle, salaryMin, salaryMax, location, headcount, experience, education, jobType, description, requirements, benefits });
        onClose();
    };

    const canPublish = companyName && jobTitle && location;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布招聘</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-pink-500 text-white hover:bg-pink-600' : 'bg-gray-200 text-gray-400'}`}
                >
                    发布
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Building2 size={14} />公司名称</h3>
                    <input type="text" placeholder="您的公司名称" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                <input type="text" placeholder="招聘职位" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                {/* 工作类型 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} />工作类型</h3>
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
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><DollarSign size={14} />薪资范围 (K)</h3>
                        <div className="flex items-center gap-2">
                            <input type="number" placeholder="最低" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                            <span>-</span>
                            <input type="number" placeholder="最高" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        </div>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Users size={14} />招聘人数</h3>
                        <input type="number" value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" min="1" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">经验要求</h3>
                        <select value={experience} onChange={(e) => setExperience(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            {experiences.map(exp => <option key={exp} value={exp}>{exp}</option>)}
                        </select>
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><GraduationCap size={14} />学历要求</h3>
                        <select value={education} onChange={(e) => setEducation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            {educations.map(edu => <option key={edu} value={edu}>{edu}</option>)}
                        </select>
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} />工作地点</h3>
                    <input type="text" placeholder="如：北京市海淀区" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                {/* 福利待遇 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">福利待遇</h3>
                    <div className="flex flex-wrap gap-2">
                        {benefitOptions.map(benefit => (
                            <button key={benefit} onClick={() => toggleBenefit(benefit)} className={`px-3 py-1.5 rounded-full text-sm ${benefits.includes(benefit) ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                {benefit}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">职位描述</h3>
                    <textarea placeholder="描述工作内容和职责..." value={description} onChange={(e) => setDescription(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">任职要求</h3>
                    <textarea placeholder="列出任职要求..." value={requirements} onChange={(e) => setRequirements(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>
            </div>
        </div>
    );
}
