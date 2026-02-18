import { useState } from 'react';
import { X, Briefcase, MapPin, DollarSign, GraduationCap, Clock } from 'lucide-react';

interface PublishJobPageProps {
    onClose: () => void;
}

export default function PublishJobPage({ onClose }: PublishJobPageProps) {
    const [name, setName] = useState('');
    const [title, setTitle] = useState('');
    const [experience, setExperience] = useState('');
    const [education, setEducation] = useState('');
    const [expectedSalary, setExpectedSalary] = useState('');
    const [location, setLocation] = useState('');
    const [skills, setSkills] = useState<string[]>([]);
    const [newSkill, setNewSkill] = useState('');
    const [intro, setIntro] = useState('');
    const [jobType, setJobType] = useState('全职');

    const educations = ['高中', '大专', '本科', '硕士', '博士'];
    const jobTypes = ['全职', '兼职', '实习', '远程'];

    const addSkill = () => {
        if (newSkill.trim() && !skills.includes(newSkill.trim())) {
            setSkills([...skills, newSkill.trim()]);
            setNewSkill('');
        }
    };

    const handlePublish = () => {
        console.log('Publishing job seeking:', { name, title, experience, education, expectedSalary, location, skills, intro, jobType });
        onClose();
    };

    const canPublish = name && title && location;

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
            <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                    <X size={24} />
                </button>
                <h1 className="font-semibold text-lg">发布求职</h1>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-5 py-2 rounded-full font-medium transition-colors ${canPublish ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-gray-200 text-gray-400'}`}
                >
                    发布
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <input type="text" placeholder="您的姓名" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Briefcase size={14} />期望职位</h3>
                    <input type="text" placeholder="如：前端工程师" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                </div>

                {/* 工作类型 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Clock size={14} />工作类型</h3>
                    <div className="flex flex-wrap gap-2">
                        {jobTypes.map(type => (
                            <button key={type} onClick={() => setJobType(type)} className={`px-4 py-2 rounded-full text-sm ${jobType === type ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                                {type}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">工作经验</h3>
                        <input type="text" placeholder="如：3年" value={experience} onChange={(e) => setExperience(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><GraduationCap size={14} />学历</h3>
                        <select value={education} onChange={(e) => setEducation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl">
                            <option value="">选择学历</option>
                            {educations.map(edu => <option key={edu} value={edu}>{edu}</option>)}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><DollarSign size={14} />期望薪资</h3>
                        <input type="text" placeholder="如：15-20K" value={expectedSalary} onChange={(e) => setExpectedSalary(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><MapPin size={14} />期望城市</h3>
                        <input type="text" placeholder="如：北京" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                    </div>
                </div>

                {/* 技能 */}
                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">技能标签</h3>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {skills.map((skill, idx) => (
                            <span key={idx} className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm flex items-center gap-1">
                                {skill}
                                <button onClick={() => setSkills(skills.filter((_, i) => i !== idx))} className="text-indigo-500 hover:text-indigo-700">×</button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input type="text" placeholder="添加技能" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && addSkill()} className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl" />
                        <button onClick={addSkill} className="px-4 py-2 bg-indigo-500 text-white rounded-xl">添加</button>
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-2">个人介绍</h3>
                    <textarea placeholder="简单介绍自己的工作经历和优势..." value={intro} onChange={(e) => setIntro(e.target.value)} className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl resize-none" />
                </div>
            </div>
        </div>
    );
}
