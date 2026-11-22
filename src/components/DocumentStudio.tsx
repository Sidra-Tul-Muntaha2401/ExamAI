import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  Difficulty,
  DocumentRecord,
  QuestionType,
  QuizQuestion,
  UserRole,
} from '../types/index';

interface DocumentStudioProps {
  role: UserRole;
  onSaved?: () => void;
}

export function DocumentStudio({ role, onSaved }: DocumentStudioProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const [questionType, setQuestionType] = useState<QuestionType | 'mixed'>('mcq');
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [count, setCount] = useState<number>(5);
  const [topic, setTopic] = useState<string>('');

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [aiStatus, setAiStatus] = useState<{ loaded: boolean; aiConfigured: boolean }>({
    loaded: false,
    aiConfigured: true,
  });

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [quizTitle, setQuizTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || null;

  const loadDocuments = async () => {
    setLoadingDocs(true);
    try {
      const data = await api.get<{ documents: DocumentRecord[] }>('/api/documents');
      setDocuments(data.documents);
      if (data.documents.length > 0 && !selectedDocId) {
        setSelectedDocId(data.documents[0].id);
        setQuizTitle(`${data.documents[0].title} — Practice Set`);
      }
    } catch {
      // Handled silently on initial load
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
    void api
      .get<{ aiConfigured?: boolean; groqConfigured?: boolean }>('/api/health')
      .then((h) => {
        setAiStatus({
          loaded: true,
          aiConfigured: Boolean(h.aiConfigured ?? h.groqConfigured),
        });
      })
      .catch(() => {
        setAiStatus((prev) => ({ ...prev, loaded: true }));
      });
  }, []);

  const generateForDocument = async (doc: DocumentRecord) => {
    setGenError(null);
    setSaveMessage(null);
    setGenerating(true);

    try {
      const data = await api.post<{ questions: QuizQuestion[] }>('/api/ai/generate-questions', {
        documentId: doc.id,
        questionType,
        difficulty,
        count,
        topic: topic || doc.title,
      });
      setQuestions(data.questions);
      if (!quizTitle.trim()) {
        setQuizTitle(`${doc.title} — ${difficulty} Quiz`);
      }
      setSaveMessage(
        `Generated ${data.questions.length} ${questionType.replace('_', ' ')} question(s) from "${doc.title}". Review and save below.`
      );
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate questions.');
    } finally {
      setGenerating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadSuccess(null);
    setGenError(null);
    setSaveMessage(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (uploadTitle.trim()) {
        formData.append('title', uploadTitle.trim());
      }

      const data = await api.post<{ document: DocumentRecord }>('/api/documents/upload', formData);
      setDocuments((prev) => [data.document, ...prev]);
      setSelectedDocId(data.document.id);
      setQuizTitle(`${data.document.title} — Practice Set`);
      setUploadTitle('');
      setUploadSuccess(
        `Extracted ${data.document.wordCount.toLocaleString()} words from ${data.document.originalFilename}.`
      );
      onSaved?.();
      setUploading(false);

      if (autoGenerate) {
        await generateForDocument(data.document);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    try {
      await api.delete(`/api/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (selectedDocId === docId) {
        const next = documents.find((d) => d.id !== docId);
        setSelectedDocId(next ? next.id : '');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unable to delete document.');
    }
  };

  const handleGenerate = async () => {
    if (!selectedDoc) {
      setGenError('Upload or select a document first.');
      return;
    }
    await generateForDocument(selectedDoc);
  };

  const handleAddManualQuestion = () => {
    const type: QuestionType = questionType === 'mixed' ? 'mcq' : questionType;
    const newQ: QuizQuestion =
      type === 'mcq'
        ? {
            id: `manual_${Date.now()}`,
            questionType: 'mcq',
            difficulty,
            topic: topic || selectedDoc?.title || 'General',
            prompt: 'Enter your multiple-choice question prompt here...',
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctAnswer: 'Option A',
            explanation: 'Explain why Option A is correct.',
            marks: 2,
          }
        : type === 'true_false'
          ? {
              id: `manual_${Date.now()}`,
              questionType: 'true_false',
              difficulty,
              topic: topic || selectedDoc?.title || 'General',
              prompt: 'Enter your True/False statement here...',
              options: ['True', 'False'],
              correctAnswer: 'True',
              explanation: 'Provide justification from the material.',
              marks: 1,
            }
          : {
              id: `manual_${Date.now()}`,
              questionType: type,
              difficulty,
              topic: topic || selectedDoc?.title || 'General',
              prompt: 'Enter your descriptive question here...',
              options: [],
              suggestedAnswer: 'Model answer outline...',
              markingGuidance: 'Rubric points for awarding marks...',
              marks: type === 'long_answer' ? 10 : 5,
            };

    setQuestions((prev) => [...prev, newQ]);
  };

  const updateQuestion = (idx: number, patch: Partial<QuizQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  const updateOption = (qIdx: number, optIdx: number, value: string) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        const oldVal = q.options[optIdx];
        const nextOptions = q.options.map((o, oi) => (oi === optIdx ? value : o));
        const nextCorrect = q.correctAnswer === oldVal ? value : q.correctAnswer;
        return { ...q, options: nextOptions, correctAnswer: nextCorrect };
      })
    );
  };

  const removeQuestion = (idx: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (questions.length === 0) return;
    setSaving(true);
    setSaveMessage(null);
    setGenError(null);

    try {
      if (role === 'student') {
        const finalTitle = quizTitle.trim() || `${selectedDoc?.title || 'Study'} Practice Quiz`;
        await api.post('/api/practice-quizzes', {
          title: finalTitle,
          topic: topic.trim() || selectedDoc?.title || 'Study Material',
          difficulty,
          questionType,
          documentId: selectedDocId || null,
          questions,
        });
        setSaveMessage(`Saved "${finalTitle}" to My Practice Quizzes.`);
      } else {
        await api.post('/api/teacher/question-bank', {
          documentId: selectedDocId || null,
          questions,
        });
        setSaveMessage(`Saved ${questions.length} question(s) to your Teacher Question Bank.`);
      }
      onSaved?.();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Unable to save questions.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Step 1: Upload & Document Selection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-[#252525]">
              01. Upload {role === 'teacher' ? 'Teaching' : 'Study'} Material
            </h3>
            <p className="text-sm text-[#77736C] mt-1">
              Upload text-based PDF or DOCX files up to 10 MB. Text is extracted on the server and previewed before AI generation.
            </p>
          </div>

          <div className="space-y-3">
            <label htmlFor="doc-title-input" className="block text-xs font-semibold text-[#252525]">
              Document Title (optional)
            </label>
            <input
              id="doc-title-input"
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g., Organic Chemistry Chapter 4"
              className="w-full px-3.5 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
            />
          </div>

          <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#C9A45C]/70 bg-[#EFEBE2]/65 hover:bg-[#EFEBE2] transition-colors rounded-xl p-6 cursor-pointer text-center">
            {uploading ? (
              <Loader2 className="w-7 h-7 text-[#66543A] animate-spin mb-2" />
            ) : (
              <Upload className="w-7 h-7 text-[#66543A] mb-2" />
            )}
            <span className="text-sm font-semibold text-[#252525]">
              {uploading ? 'Extracting document text...' : 'Choose PDF or DOCX file'}
            </span>
            <span className="text-xs text-[#77736C] mt-1">
              Supported: .pdf (text-based), .docx · Max 10 MB (4.5 MB on Vercel)
            </span>
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileUpload}
              disabled={uploading || generating}
              className="sr-only"
            />
          </label>

          <label className="flex items-center gap-2.5 text-xs font-medium text-[#252525] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="accent-[#66543A] w-4 h-4 rounded"
            />
            <span>Auto-generate questions immediately after PDF/DOCX upload</span>
          </label>

          {uploadError && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C64B4B]" />
              <span>{uploadError}</span>
            </div>
          )}

          {uploadSuccess && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#25845D]/10 border border-[#25845D]/30 text-sm text-[#19593E]">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#25845D]" />
              <span>{uploadSuccess}</span>
            </div>
          )}

          <div className="pt-2 border-t border-[#E3DED3]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[#77736C]">My Uploaded Documents ({documents.length})</span>
            </div>
            {loadingDocs ? (
              <div className="text-sm text-[#77736C] py-3">Loading documents...</div>
            ) : documents.length === 0 ? (
              <div className="text-sm text-[#77736C] py-3">No documents uploaded yet.</div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {documents.map((doc) => {
                  const active = doc.id === selectedDocId;
                  return (
                    <div
                      key={doc.id}
                      className={`flex items-center justify-between gap-2 p-3 rounded-lg border transition-colors ${
                        active
                          ? 'bg-[#EFEBE2] border-[#C9A45C]'
                          : 'bg-[#F5F1E8]/60 border-[#E3DED3] hover:border-[#C9A45C]/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDocId(doc.id);
                          setQuizTitle(`${doc.title} — Practice Set`);
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#252525] truncate">
                          <FileText className="w-4 h-4 text-[#66543A] shrink-0" />
                          <span className="truncate">{doc.title}</span>
                        </div>
                        <div className="text-xs text-[#77736C] mt-0.5 tabular-nums">
                          {doc.fileType.toUpperCase()} · {doc.wordCount.toLocaleString()} words ·{' '}
                          {Math.max(1, Math.round(doc.fileSize / 1024))} KB
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc.id)}
                        aria-label={`Delete document ${doc.title}`}
                        className="p-1.5 text-[#77736C] hover:text-[#C64B4B] rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Extracted Text Preview + Groq Generator Controls */}
        <div className="lg:col-span-7 bg-white border border-[#E3DED3] rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-lg font-semibold text-[#252525]">
              02. Extracted Text Preview &amp; Question Generation
            </h3>
            <p className="text-sm text-[#77736C] mt-1">
              Review the extracted source text and configure question parameters. ExamAI samples across your full document and generates grounded questions.
            </p>
          </div>

          {aiStatus.loaded && !aiStatus.aiConfigured && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#B77B25]/10 border border-[#B77B25]/35 text-xs text-[#66543A]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#B77B25]" />
              <span>
                No AI API key is configured on this server yet (<code className="font-mono">GROQ_API_KEY</code> or{' '}
                <code className="font-mono">GEMINI_API_KEY</code>). Text extraction works normally, and you can add questions manually or add an API key in your environment settings to enable AI question generation.
              </span>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-[#252525]">
                Extracted Source Text {selectedDoc ? `— ${selectedDoc.title}` : ''}
              </label>
              {selectedDoc && (
                <span className="text-xs text-[#77736C] tabular-nums">
                  {selectedDoc.wordCount.toLocaleString()} words extracted
                </span>
              )}
            </div>
            <div className="h-44 overflow-y-auto p-4 bg-[#F5F1E8]/70 border border-[#E3DED3] rounded-lg text-sm text-[#252525] leading-relaxed whitespace-pre-wrap font-sans">
              {selectedDoc ? (
                selectedDoc.extractedText
              ) : (
                <span className="text-[#77736C]">
                  Select or upload a PDF/DOCX document on the left to inspect its extracted text.
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="gen-type" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Question Type
              </label>
              <select
                id="gen-type"
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value as QuestionType | 'mixed')}
                className="w-full px-3 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
              >
                <option value="mcq">Multiple Choice (MCQ)</option>
                <option value="true_false">True / False</option>
                <option value="short_answer">Short Answer</option>
                <option value="long_answer">Long Answer</option>
                <option value="mixed">Mixed Format</option>
              </select>
            </div>

            <div>
              <label htmlFor="gen-diff" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Difficulty
              </label>
              <select
                id="gen-diff"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="w-full px-3 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>

            <div>
              <label htmlFor="gen-count" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Number of Questions
              </label>
              <input
                id="gen-count"
                type="number"
                min={1}
                max={15}
                value={count}
                onChange={(e) => setCount(Math.min(15, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="gen-topic" className="block text-xs font-semibold text-[#252525] mb-1.5">
                Topic / Chapter (optional)
              </label>
              <input
                id="gen-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., ATP Synthase"
                className="w-full px-3 py-2.5 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !selectedDocId}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#C9A45C] hover:bg-[#DFC58E] disabled:opacity-50 text-[#171717] text-sm font-semibold transition-colors whitespace-nowrap"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {generating ? 'Generating Questions...' : 'Generate Questions with AI'}
            </button>

            <button
              type="button"
              onClick={handleAddManualQuestion}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#E3DED3] bg-white hover:bg-[#EFEBE2] text-[#252525] text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-[#4476A8]" />
              Add Manual Question
            </button>
          </div>

          {genError && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#C64B4B]/10 border border-[#C64B4B]/35 text-sm text-[#982E2E]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C64B4B]" />
              <span>{genError}</span>
            </div>
          )}

          {saveMessage && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#25845D]/10 border border-[#25845D]/30 text-sm text-[#19593E]">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#25845D]" />
              <span>{saveMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* Step 3: Edit, Delete, Regenerate & Save Generated Questions */}
      {questions.length > 0 && (
        <div className="bg-white border border-[#E3DED3] rounded-xl p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#E3DED3]">
            <div>
              <h3 className="text-lg font-semibold text-[#252525]">
                03. Review, Edit & Save Questions ({questions.length})
              </h3>
              <p className="text-sm text-[#77736C] mt-1">
                Refine prompts, answer keys, explanations, or marking rubrics before saving.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {role === 'student' && (
                <input
                  type="text"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                  placeholder="Practice Quiz Title"
                  aria-label="Practice Quiz Title"
                  className="px-3.5 py-2 text-sm bg-[#F5F1E8]/60 border border-[#E3DED3] rounded-lg focus:bg-white focus:border-[#C9A45C] outline-none min-w-[240px]"
                />
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !selectedDocId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E3DED3] bg-white hover:bg-[#EFEBE2] text-[#252525] text-sm font-semibold transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[#171717] hover:bg-[#303030] disabled:opacity-50 text-white text-sm font-semibold transition-colors whitespace-nowrap"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {role === 'student' ? 'Save Practice Quiz' : 'Save to Question Bank'}
              </button>
            </div>
          </div>

          <div className="space-y-5">
            {questions.map((q, idx) => (
              <div key={q.id} className="p-5 rounded-xl bg-[#F5F1E8]/70 border border-[#E3DED3] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#77736C]">
                    <span className="font-mono font-semibold text-[#252525]">Q{idx + 1}</span>
                    <span aria-hidden="true">·</span>
                    <span>{q.questionType.replace('_', ' ').toUpperCase()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{q.difficulty}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-[#77736C]">
                      Marks:
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={q.marks}
                        onChange={(e) => updateQuestion(idx, { marks: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-16 px-2 py-1 text-xs bg-white border border-[#E3DED3] rounded-md tabular-nums"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeQuestion(idx)}
                      aria-label={`Delete question ${idx + 1}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#C64B4B] hover:underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#252525] mb-1">Question Prompt</label>
                  <textarea
                    rows={2}
                    value={q.prompt}
                    onChange={(e) => updateQuestion(idx, { prompt: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg focus:border-[#C9A45C] outline-none"
                  />
                </div>

                {(q.questionType === 'mcq' || q.questionType === 'true_false') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {q.options.map((opt, optIdx) => (
                      <div key={optIdx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${q.id}`}
                          checked={q.correctAnswer === opt}
                          onChange={() => updateQuestion(idx, { correctAnswer: opt })}
                          aria-label={`Mark option ${optIdx + 1} as correct for question ${idx + 1}`}
                          className="accent-[#66543A] w-4 h-4 shrink-0"
                        />
                        <input
                          type="text"
                          value={opt}
                          disabled={q.questionType === 'true_false'}
                          onChange={(e) => updateOption(idx, optIdx, e.target.value)}
                          className="flex-1 px-3 py-1.5 text-sm bg-white border border-[#E3DED3] rounded-lg disabled:bg-[#EFEBE2]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {q.questionType === 'mcq' || q.questionType === 'true_false' ? (
                  <div>
                    <label className="block text-xs font-semibold text-[#252525] mb-1">Explanation</label>
                    <input
                      type="text"
                      value={q.explanation || ''}
                      onChange={(e) => updateQuestion(idx, { explanation: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#252525] mb-1">Suggested Answer</label>
                      <textarea
                        rows={3}
                        value={q.suggestedAnswer || ''}
                        onChange={(e) => updateQuestion(idx, { suggestedAnswer: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#252525] mb-1">Marking Guidance</label>
                      <textarea
                        rows={3}
                        value={q.markingGuidance || ''}
                        onChange={(e) => updateQuestion(idx, { markingGuidance: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm bg-white border border-[#E3DED3] rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
