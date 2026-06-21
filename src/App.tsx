import { useState, useCallback, useRef, useEffect, useMemo, MouseEvent } from "react";
import { useDropzone } from "react-dropzone";
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  Trash2, 
  Loader2, 
  Monitor, 
  Table as TableIcon,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  History,
  Search,
  ExternalLink,
  Calendar,
  Layers,
  X,
  PieChart as PieChartIcon,
  BarChart3,
  TrendingUp,
  FileJson,
  FileCode,
  CheckCircle2,
  Copy,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { ExtractionResult, Row, HistoryItem, AnalysisResult } from "./types";

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [data, setData] = useState<ExtractionResult | null>(null);
  const [rawTextData, setRawTextData] = useState<{text: string, wordCount: number, charCount: number} | null>(null);
  const [extractionMode, setExtractionMode] = useState<"table" | "text">("table");
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  // Analysis States
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<"data" | "insights">("data");

  // History States
  const [activeTab, setActiveTab] = useState<"workbench" | "history">("workbench");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);

  // Load history on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem("sheetify_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Sync history to localStorage
  useEffect(() => {
    localStorage.setItem("sheetify_history", JSON.stringify(history));
  }, [history]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFiles(prev => [...prev, ...acceptedFiles]);
      setPreviewUrls(prev => [...prev, ...acceptedFiles.map(f => URL.createObjectURL(f))]);
      setData(null);
      setError(null);
    }
  }, []);

  const removeFile = (index: number) => {
    const newFiles = [...files];
    const newPreviewUrls = [...previewUrls];
    URL.revokeObjectURL(newPreviewUrls[index]);
    newFiles.splice(index, 1);
    newPreviewUrls.splice(index, 1);
    setFiles(newFiles);
    setPreviewUrls(newPreviewUrls);
    if (newFiles.length === 0) {
      setData(null);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  } as any);

  const saveToHistory = (extraction: ExtractionResult, fileName: string, fileType: string) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      filename: fileName,
      data: extraction,
      fileType: fileType
    };
    setHistory(prev => [newItem, ...prev].slice(0, 50)); // Keep last 50 items
  };

  const processFiles = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Convert files to base64 — required for Vercel serverless (no raw stream for multer)
      const filePayloads = await Promise.all(
        files.map(async (f) => {
          const buffer = await f.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return {
            data: btoa(binary),
            mimeType: f.type,
            name: f.name,
          };
        })
      );

      const endpoint = extractionMode === "table" ? "/api/process" : "/api/extract-text";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filePayloads }),
      });

      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to process documents");
        } else {
          const text = await response.text();
          console.error("Non-JSON error response:", text);
          throw new Error("Server error. Please check your API key is valid and try again.");
        }
      }

      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Server returned invalid response format. Please try again.");
      }

      const result = await response.json();
      if (extractionMode === "table") {
        setData(result);
        setRawTextData(null);
        saveToHistory(result, files.length > 1 ? `${files[0].name} + ${files.length - 1} more` : files[0].name, files[0].type);
        runAnalysis(result);
      } else {
        setRawTextData(result);
        setData(null);
        // Note: we skip history/analysis for plain text mode to keep it simple
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong while processing.");
    } finally {
      setIsProcessing(false);
    }
  };


  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    if (!data) return;
    const newRows = [...data.rows];
    newRows[rowIndex] = { ...newRows[rowIndex], [column]: value };
    setData({ ...data, rows: newRows });
  };

  const runAnalysis = async (extractionData: ExtractionResult) => {
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: extractionData }),
      });
      if (!response.ok) throw new Error("Analysis failed");
      const result = await response.json();
      setAnalysis(result);
    } catch (err) {
      console.error("Analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportToExcel = async (exportData?: ExtractionResult, exportFilename?: string) => {
    const targetData = exportData || data;
    const targetFilename = exportFilename || `Sheetify_${files[0]?.name.split('.')[0] || 'export'}.xlsx`;
    
    if (!targetData) return;
    setIsExporting(true);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: targetData,
          filename: targetFilename
        }),
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = targetFilename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert("Failed to export: " + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const exportToCSV = (exportData?: ExtractionResult, exportFilename?: string) => {
    const targetData = exportData || data;
    if (!targetData) return;

    const headers = targetData.columns.join(",");
    const rows = targetData.rows.map(row => 
      targetData.columns.map(col => `"${(row[col] || "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");

    const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", exportFilename || "export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = (exportData?: ExtractionResult, exportFilename?: string) => {
    const targetData = exportData || data;
    if (!targetData) return;

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(targetData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", exportFilename || "export.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const collateDocuments = () => {
    if (selectedHistoryIds.length === 0) return;
    
    const selectedItems = history.filter(item => selectedHistoryIds.includes(item.id));
    if (selectedItems.length === 0) return;

    // Merge columns (unique)
    const allColumns = Array.from(new Set(selectedItems.flatMap(item => item.data.columns))) as string[];
    const allRows = selectedItems.flatMap(item => item.data.rows);

    setData({ columns: allColumns, rows: allRows });
    setFiles([]);
    setPreviewUrls([]);
    setActiveTab("workbench");
    setWorkbenchTab("data");
    runAnalysis({ columns: allColumns, rows: allRows });
    setSelectedHistoryIds([]);
  };

  const restoreFromHistory = (item: HistoryItem) => {
    setData(item.data);
    setFiles([]);
    setPreviewUrls([]);
    setActiveTab("workbench");
    setWorkbenchTab("data");
    runAnalysis(item.data);
  };

  const removeFromHistory = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const filteredHistory = useMemo(() => {
    return history.filter(item => 
      item.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.data.columns.some(col => col.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [history, searchQuery]);

  const reset = () => {
    setFiles([]);
    setPreviewUrls([]);
    setData(null);
    setError(null);
    setAnalysis(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="border-b bg-white px-4 md:px-6 py-4 flex flex-col md:flex-row items-center justify-between sticky top-0 z-10 shadow-sm gap-4 md:gap-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <FileSpreadsheet className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Sheetify</h1>
          </div>

          <nav className="hidden md:flex items-center bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab("workbench")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'workbench' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Layers className="w-4 h-4" />
              Workbench
            </button>
            <button 
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <History className="w-4 h-4" />
              History
              {history.length > 0 && (
                <span className="bg-slate-200 text-slate-600 text-[10px] px-1.5 rounded-full">{history.length}</span>
              )}
            </button>
          </nav>
        </div>
        
        <div className="flex flex-wrap items-center justify-center gap-2 md:gap-3 w-full md:w-auto">
          {data && activeTab === "workbench" && (
            <>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl mr-2">
                <button 
                  onClick={() => setWorkbenchTab("data")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${workbenchTab === 'data' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <TableIcon className="w-3.5 h-3.5" />
                    Data Grid
                  </div>
                </button>
                <button 
                  onClick={() => setWorkbenchTab("insights")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${workbenchTab === 'insights' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Smart Insights
                  </div>
                </button>
              </div>

              <button
                onClick={reset}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>

              <div className="relative group/export">
                <button
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-full text-sm font-semibold transition-all shadow-md active:scale-95"
                >
                  {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Export Data
                </button>
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all z-50 overflow-hidden">
                  <button onClick={() => exportToExcel()} className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700">
                    <FileSpreadsheet className="w-4 h-4 text-green-600" />
                    Excel Workbook
                  </button>
                  <button onClick={() => exportToCSV()} className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700">
                    <FileCode className="w-4 h-4 text-blue-600" />
                    CSV Document
                  </button>
                  <button onClick={() => exportToJSON()} className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700">
                    <FileJson className="w-4 h-4 text-orange-600" />
                    JSON Format
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-2 md:p-6">
        <AnimatePresence mode="wait">
          {activeTab === "workbench" ? (
            <motion.div
              key="workbench"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {(!data && !rawTextData) ? (
                <motion.div
                  key="upload"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="max-w-3xl mx-auto"
                >
                  <div className="text-center mb-10">
                    <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Turn any document into a <span className="text-indigo-600">Spreadsheet</span></h2>
                    <p className="text-lg text-slate-600 max-w-xl mx-auto">Upload documents, invoices, or reports. Our high-performance extraction engine processes data with professional-grade precision.</p>
                  </div>

                  {files.length === 0 ? (
                    <div
                      {...getRootProps()}
                      className={`border-3 border-dashed rounded-3xl p-16 text-center transition-all cursor-pointer bg-white group
                        ${isDragActive ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50'}`}
                    >
                      <input {...getInputProps()} />
                      <div className="bg-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Upload className="text-indigo-600 w-10 h-10" />
                      </div>
                      <p className="text-xl font-semibold text-slate-900 mb-2">Drop your documents here</p>
                      <p className="text-slate-500 text-sm">Supports multi-page PDFs, JPG, PNG (Max 4MB total)</p>
                      <p className="mt-2 text-xs text-indigo-600 font-bold bg-indigo-50/50 py-1 px-3 rounded-full inline-block">Supports Multiple Files & Languages</p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 overflow-hidden">
                       <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className="bg-indigo-600 p-3 rounded-xl shadow-lg shadow-indigo-100">
                            <Layers className="w-6 h-6 text-white" />
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{files.length} Document{files.length > 1 ? 's' : ''} Selected</p>
                            <p className="text-xs text-slate-500">{(files.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(2)} MB total</p>
                          </div>
                        </div>
                        <button onClick={() => setFiles([])} className="text-slate-400 hover:text-red-500 transition-colors bg-slate-100 p-2 rounded-lg">
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                        {files.map((f, i) => (
                          <div key={i} className="relative group rounded-xl border border-slate-100 overflow-hidden aspect-video bg-slate-50 flex items-center justify-center shadow-sm">
                            {f.type.startsWith('image/') ? (
                              <img src={previewUrls[i]} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center gap-2">
                                <FileSpreadsheet className="w-8 h-8 text-slate-300" />
                                <p className="text-[10px] font-bold text-slate-400 truncate max-w-[100px]">{f.name}</p>
                              </div>
                            )}
                            <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                              <p className="text-white text-[10px] font-bold uppercase tracking-widest">{f.type === 'application/pdf' ? 'PDF Doc' : 'Image'}</p>
                              <button 
                                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full transform scale-90 hover:scale-100 transition-all shadow-lg"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div 
                          {...getRootProps()}
                          className="border-2 border-dashed border-slate-200 rounded-xl aspect-video flex flex-col items-center justify-center gap-2 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all cursor-pointer group"
                        >
                          <input {...getInputProps()} />
                          <div className="bg-slate-100 p-2 rounded-lg group-hover:bg-indigo-100 transition-colors">
                            <Upload className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" />
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 group-hover:text-indigo-600 uppercase tracking-widest">Add More</p>
                        </div>
                      </div>

                      <div className="flex bg-slate-100 p-1 rounded-xl mb-6">
                        <button
                          onClick={() => setExtractionMode("table")}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-all ${extractionMode === "table" ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          <TableIcon className="w-4 h-4" />
                          Tabular Data
                        </button>
                        <button
                          onClick={() => setExtractionMode("text")}
                          className={`flex-1 py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 font-medium ${extractionMode === 'text' ? 'bg-white text-indigo-600 shadow-[0_2px_10px_rgba(0,0,0,0.05)] ring-1 ring-gray-100/50' : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'}`}
                        >
                          <FileText className="w-4 h-4" />
                          Structured Text
                        </button>
                      </div>

                      <button
                        onClick={processFiles}
                        disabled={isProcessing}
                        className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white py-5 rounded-2xl font-bold text-lg transition-all shadow-lg shadow-indigo-200 active:scale-95"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Synthesizing {files.length} Page{files.length > 1 ? 's' : ''}...
                          </>
                        ) : (
                          <>
                            Extract & Analyze Documents
                            <ChevronRight className="w-6 h-6" />
                          </>
                        )}
                      </button>
                      
                      {error && (
                        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700">
                          <AlertCircle className="w-5 h-5 flex-shrink-0" />
                          <p className="text-sm font-medium">{error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="workspace"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col lg:flex-row gap-4 md:gap-6 min-h-[calc(100vh-140px)] lg:h-[calc(100vh-140px)]"
                >
                  {/* Left Panel: Preview */}
                  <div className="lg:w-1/3 bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-[300px]">
                    <div className="p-4 border-b bg-slate-50/50 flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Document Source{files.length > 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex-1 bg-slate-800 flex items-center justify-center overflow-auto p-4 flex-col gap-4">
                      {files.length > 0 ? (
                        files.map((f, i) => (
                           <div key={i} className="w-full max-w-sm rounded overflow-hidden shadow-2xl bg-white/10 p-2 border border-white/10">
                            {f.type.startsWith('image/') ? (
                              <img src={previewUrls[i]} alt={`Source ${i}`} className="w-full h-auto rounded" />
                            ) : (
                              <div className="flex flex-col items-center gap-4 py-8 text-white">
                                <FileSpreadsheet className="w-12 h-12 opacity-50" />
                                <a 
                                  href={previewUrls[i]} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-white hover:text-indigo-300 transition-colors flex items-center gap-2 font-bold"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                  View Page {i + 1} ({f.name})
                                </a>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center text-slate-500">
                          <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          <p>Source preview unavailable for history</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Panel: Interactive Table or AI Insights or Raw Text */}
                  <div className="lg:w-2/3 bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden flex flex-col min-h-[500px]">
                    {rawTextData ? (
                      <div className="flex-1 flex flex-col h-full bg-slate-50 relative">
                        <div className="p-4 border-b bg-white flex items-center justify-between z-10 shadow-sm">
                          <div className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-600" />
                            <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Transcribed Text</p>
                          </div>
                          <div className="flex items-center gap-6 text-xs font-bold text-slate-400 uppercase tracking-widest">
                            <span className="bg-slate-100 px-3 py-1 rounded-full">Words: {rawTextData.wordCount}</span>
                            <span className="bg-slate-100 px-3 py-1 rounded-full">Chars: {rawTextData.charCount}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(rawTextData.text);
                                alert("Copied to clipboard!");
                              }}
                              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                            >
                              <Copy className="w-4 h-4" /> Copy
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 p-6 overflow-auto">
                          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 min-h-full whitespace-pre-wrap font-mono text-[13px] leading-loose text-slate-800">
                            {rawTextData.text ? (
                              rawTextData.text
                            ) : (
                              <div className="flex flex-col items-center justify-center text-center h-full text-slate-400">
                                <FileText className="w-10 h-10 mb-2 opacity-50" />
                                <p className="font-bold">No readable text found</p>
                                <p className="text-xs max-w-[200px] mx-auto mt-1">The AI could not identify any text in the provided document.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : workbenchTab === 'data' && data ? (
                      <>
                        <div className="p-4 border-b bg-white flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TableIcon className="w-5 h-5 text-indigo-600" />
                            <p className="text-sm font-bold text-slate-700 uppercase tracking-wider">Smart Extraction Grid</p>
                          </div>
                          <p className="text-xs text-slate-400">Double click cells to edit</p>
                        </div>

                        {data.rows.length > 0 && (
                          <div className="flex-1 overflow-auto">
                            <table className="w-full border-collapse text-sm">
                              <thead className="sticky top-0 z-10 bg-slate-50 border-b">
                                <tr>
                                  {data.columns.map((column) => (
                                    <th key={column} className="px-4 py-3 text-left font-semibold text-slate-600 border-r last:border-r-0 min-w-[150px]">
                                      {column}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {data.rows.map((row, rowIndex) => (
                                  <tr key={rowIndex} className="border-b hover:bg-indigo-50/30 transition-colors group">
                                    {data.columns.map((column) => (
                                      <td key={column} className="px-4 py-3 border-r last:border-r-0 relative group">
                                        <input
                                          type="text"
                                          value={row[column] || ""}
                                          onChange={(e) => handleCellChange(rowIndex, column, e.target.value)}
                                          className="w-full bg-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 rounded px-1 transition-all"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex-1 overflow-auto p-8">
                        {isAnalyzing ? (
                          <div className="h-full flex flex-col items-center justify-center text-center">
                            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
                            <h3 className="text-xl font-bold text-slate-900">Analyzing Patterns...</h3>
                            <p className="text-slate-500">Processing transactional patterns and variance analytics.</p>
                          </div>
                        ) : analysis ? (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                            <div>
                              <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-widest mb-2">Executive Summary</h3>
                              <p className="text-lg text-slate-700 leading-relaxed font-medium">{analysis.summary}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              {analysis.metrics.map((metric, i) => (
                                <div key={i} className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{metric.label}</p>
                                  <p className="text-2xl font-extrabold text-slate-900 tracking-tight">{metric.value}</p>
                                  {metric.trend && <p className="text-[10px] font-bold text-green-600 mt-1 uppercase">↑ {metric.trend}</p>}
                                </div>
                              ))}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Categorical Distribution</h4>
                                <div className="h-64">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                      <Pie
                                        data={analysis.chartData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                      >
                                        {analysis.chartData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={[ '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6' ][index % 5]} />
                                        ))}
                                      </Pie>
                                      <Tooltip 
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                      />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>

                              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Value Variance Analysis</h4>
                                <div className="h-64">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysis.chartData}>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                      <YAxis hide />
                                      <Tooltip 
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                                      />
                                      <Bar dataKey="value" fill="#4F46E5" radius={[4, 4, 0, 0]} barSize={32} />
                                    </BarChart>
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-center">
                            <BarChart3 className="w-12 h-12 text-slate-200 mb-4" />
                            <h3 className="text-xl font-bold text-slate-900">No Insights Available</h3>
                            <p className="text-slate-500">Process a document to generate automated business analysis.</p>
                            <button onClick={() => runAnalysis(data!)} className="mt-4 text-indigo-600 font-bold hover:underline">Re-run Analysis</button>
                          </div>
                        )}
                      </div>
                    )}

                    {data?.rows.length === 0 && (
                       <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                        <div className="bg-slate-100 p-6 rounded-full mb-4">
                          <RefreshCw className="w-10 h-10 text-slate-300" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">No data extracted</h3>
                        <p className="text-slate-500 max-w-xs">We couldn't find a clear table. Try uploading a direct scan or photo.</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-5xl mx-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Document History</h2>
                  <p className="text-slate-500">View and manage your previously processed documents.</p>
                </div>
                
                <div className="flex items-center gap-4">
                  {selectedHistoryIds.length > 0 && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 pr-4 border-r">
                      <p className="text-sm font-bold text-indigo-600">{selectedHistoryIds.length} Selected</p>
                      <button 
                        onClick={collateDocuments}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        Collate Documents
                      </button>
                      <button onClick={() => setSelectedHistoryIds([])} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search documents..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-64 text-sm"
                    />
                  </div>
                </div>
              </div>

              {filteredHistory.length > 0 ? (
                <div className="grid gap-4">
                  {filteredHistory.map((item) => (
                    <motion.div
                      layout
                      key={item.id}
                      onClick={() => setSelectedHistoryIds(curr => curr.includes(item.id) ? curr.filter(id => id !== item.id) : [...curr, item.id])}
                      className={`bg-white rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all group flex items-center justify-between cursor-pointer
                        ${selectedHistoryIds.includes(item.id) ? 'border-indigo-600 ring-4 ring-indigo-500/5 bg-indigo-50/50' : 'border-slate-200'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl transition-colors ${selectedHistoryIds.includes(item.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {selectedHistoryIds.includes(item.id) ? <CheckCircle2 className="w-6 h-6" /> : <FileSpreadsheet className="w-6 h-6" />}
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{item.filename}</h3>
                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span>•</span>
                            <span>{item.data.rows.length} rows extracted</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => restoreFromHistory(item)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          title="Restore to workbench"
                        >
                          <ExternalLink className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => exportToExcel(item.data, `Sheetify_${item.filename.split('.')[0]}_re-export.xlsx`)}
                          className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                          title="Download Excel"
                        >
                          <Download className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={(e) => removeFromHistory(item.id, e)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
                  <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <History className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">No history found</h3>
                  <p className="text-slate-500">Processed documents will appear here automatically.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Branding */}
      <footer className="fixed bottom-6 right-6 pointer-events-none">
        <div className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 shadow-xl flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <p className="grow shrink-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Enterprise Processing Engine</p>
        </div>
      </footer>
    </div>
  );
}
