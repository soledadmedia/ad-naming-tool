"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";

interface VideoFile {
  id: string;
  name: string;
  mimeType: string;
  suggestedName: string;
  duration: number;
  transcript: string;
  multiplier: string;
  isTTSSafe: boolean;
  description: string;
  isEditing: boolean;
  processing: boolean;
  error?: string;
}

const CREATOR_OPTIONS = [
  { code: "0", initials: "CH", label: "Chris Hedgecock" },
  { code: "0", initials: "CC", label: "Chris Carter" },
  { code: "6", initials: "LAZ", label: "LAZ" },
  { code: "9", initials: "LN", label: "Lindsay" },
  { code: "9", initials: "AX", label: "Alex" },
  { code: "5", initials: "", label: "Outside Creator (custom initials)" },
];

const MULTIPLIER_OPTIONS = [
  { value: "5", label: "5X Entries" },
  { value: "4", label: "4X Entries" },
  { value: "3", label: "3X Entries" },
  { value: "2", label: "2X Entries" },
  { value: "1", label: "1X / Evergreen" },
  { value: "0", label: "End of Sweeps" },
];

function extractFolderId(url: string): string | null {
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(url.trim())) return url.trim();
  return null;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [folderUrl, setFolderUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [creatorSelection, setCreatorSelection] = useState(CREATOR_OPTIONS[0]);
  const [customInitials, setCustomInitials] = useState("");
  const [startingSequence, setStartingSequence] = useState(1);
  const [defaultMultiplier, setDefaultMultiplier] = useState("1");
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [urlError, setUrlError] = useState("");

  const getInitials = () => {
    if (creatorSelection.code === "5" && customInitials) {
      return customInitials.toUpperCase();
    }
    return creatorSelection.initials;
  };

  const handleFolderUrlChange = (url: string) => {
    setFolderUrl(url);
    setUrlError("");
    const id = extractFolderId(url);
    if (url && !id) {
      setUrlError("Invalid Google Drive folder URL");
      setFolderId(null);
    } else {
      setFolderId(id);
    }
    setVideos([]);
  };

  const handleCreatorChange = (index: number) => {
    setCreatorSelection(CREATOR_OPTIONS[index]);
    if (CREATOR_OPTIONS[index].code !== "5") {
      setCustomInitials("");
    }
  };

  const generateFileName = (
    index: number,
    multiplier: string,
    isTTSSafe: boolean,
    description: string,
    duration: number
  ) => {
    const sequence = (startingSequence + index).toString().padStart(4, "0");
    const initials = getInitials();
    const ttsLabel = isTTSSafe ? "TTS" : "NTTS";
    const desc = description || "Ad";
    const dur = duration || 0;
    
    // Format: [MULTIPLIER][CREATOR_CODE][SEQUENCE].[TTS].[INITIALS].[DESCRIPTION].[LENGTH]sec.mp4
    return `${multiplier}${creatorSelection.code}${sequence}.${ttsLabel}.${initials}.${desc}.${dur}sec.mp4`;
  };

  const processVideos = async () => {
    if (!folderId) return;
    if (!getInitials()) {
      alert("Please enter creator initials");
      return;
    }
    setProcessing(true);

    try {
      const res = await fetch(`/api/drive/videos?folderId=${folderId}`);
      const data = await res.json();

      if (data.videos) {
        // Create initial video list with duration from Drive metadata
        const initialVideos: VideoFile[] = data.videos.map((v: { id: string; name: string; mimeType: string; duration: number }, idx: number) => ({
          id: v.id,
          name: v.name,
          mimeType: v.mimeType,
          suggestedName: generateFileName(idx, defaultMultiplier, true, "Ad", v.duration || 0),
          duration: v.duration || 0,
          transcript: "",
          multiplier: defaultMultiplier,
          isTTSSafe: true,
          description: "Ad",
          isEditing: false,
          processing: false,
        }));
        setVideos(initialVideos);
      }
    } catch (error) {
      console.error("Error fetching videos:", error);
    }
    setProcessing(false);
  };

  const updateVideo = (index: number, updates: Partial<VideoFile>) => {
    setVideos((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v;
        const updated = { ...v, ...updates };
        // Regenerate filename if relevant fields changed
        if ('multiplier' in updates || 'isTTSSafe' in updates || 'description' in updates || 'duration' in updates) {
          updated.suggestedName = generateFileName(
            i,
            updated.multiplier,
            updated.isTTSSafe,
            updated.description,
            updated.duration
          );
        }
        return updated;
      })
    );
  };

  const updateSuggestedName = (index: number, newName: string) => {
    setVideos((prev) =>
      prev.map((v, i) => (i === index ? { ...v, suggestedName: newName } : v))
    );
  };

  const toggleEdit = (index: number) => {
    setVideos((prev) =>
      prev.map((v, i) => (i === index ? { ...v, isEditing: !v.isEditing } : v))
    );
  };

  const renameAll = async () => {
    setRenaming(true);
    try {
      const renames = videos
        .filter((v) => v.suggestedName && !v.error)
        .map((v) => ({
          fileId: v.id,
          newName: v.suggestedName,
        }));

      const res = await fetch("/api/drive/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renames }),
      });

      const data = await res.json();
      if (data.success) {
        alert(`Successfully renamed ${data.renamed} files!`);
        setVideos((prev) =>
          prev.map((v) => ({
            ...v,
            name: v.suggestedName || v.name,
          }))
        );
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Error renaming files:", error);
      alert("Failed to rename files");
    }
    setRenaming(false);
  };

  // Regenerate all filenames when settings change
  const regenerateAllNames = () => {
    setVideos((prev) =>
      prev.map((v, idx) => ({
        ...v,
        suggestedName: generateFileName(idx, v.multiplier, v.isTTSSafe, v.description, v.duration),
      }))
    );
  };

  // Transcribe all videos to detect TTS safety and extract descriptions
  const transcribeAll = async () => {
    setTranscribing(true);
    
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      
      // Mark as processing
      setVideos(prev => prev.map((v, idx) => 
        idx === i ? { ...v, processing: true } : v
      ));

      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: video.id, fileName: video.name }),
        });
        
        const data = await res.json();
        
        setVideos(prev => prev.map((v, idx) => {
          if (idx !== i) return v;
          const updated = {
            ...v,
            processing: false,
            transcript: data.transcript || "",
            isTTSSafe: data.isTTSSafe ?? true,
            description: data.description || "Ad",
          };
          updated.suggestedName = generateFileName(
            idx, updated.multiplier, updated.isTTSSafe, updated.description, updated.duration
          );
          return updated;
        }));
      } catch {
        setVideos(prev => prev.map((v, idx) =>
          idx === i ? { ...v, processing: false, error: "Transcription failed" } : v
        ));
      }
    }
    
    setTranscribing(false);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
        <h1 className="text-3xl font-bold mb-8">Ad Naming Tool</h1>
        <p className="mb-4 text-gray-400">Connect your Google Drive to get started</p>
        <button
          onClick={() => signIn("google")}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">Ad Naming Tool</h1>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            Sign Out
          </button>
        </div>

        {/* Settings Panel */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Settings</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Folder URL */}
            <div className="lg:col-span-2">
              <label className="block text-sm text-gray-400 mb-1">Google Drive Folder URL</label>
              <input
                type="text"
                value={folderUrl}
                onChange={(e) => handleFolderUrlChange(e.target.value)}
                placeholder="Paste Google Drive folder URL..."
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              />
              {urlError && <p className="text-red-400 text-sm mt-1">{urlError}</p>}
            </div>

            {/* Starting Sequence */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Starting Sequence #</label>
              <input
                type="number"
                min="1"
                value={startingSequence}
                onChange={(e) => setStartingSequence(parseInt(e.target.value) || 1)}
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Default Multiplier */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Default Multiplier</label>
              <select
                value={defaultMultiplier}
                onChange={(e) => setDefaultMultiplier(e.target.value)}
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                {MULTIPLIER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Creator Selection */}
            <div className="lg:col-span-2">
              <label className="block text-sm text-gray-400 mb-1">Creator</label>
              <select
                value={CREATOR_OPTIONS.findIndex(c => c === creatorSelection)}
                onChange={(e) => handleCreatorChange(parseInt(e.target.value))}
                className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              >
                {CREATOR_OPTIONS.map((opt, idx) => (
                  <option key={idx} value={idx}>
                    [{opt.code}] {opt.label} {opt.initials && `(${opt.initials})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Custom Initials (for outside creators) */}
            {creatorSelection.code === "5" && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">Custom Initials</label>
                <input
                  type="text"
                  value={customInitials}
                  onChange={(e) => setCustomInitials(e.target.value.toUpperCase().slice(0, 3))}
                  placeholder="e.g. JD"
                  maxLength={3}
                  className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-4">
            <button
              onClick={processVideos}
              disabled={!folderId || processing}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
            >
              {processing ? "Loading..." : "Load Videos"}
            </button>
            {videos.length > 0 && (
              <>
                <button
                  onClick={transcribeAll}
                  disabled={transcribing}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded font-medium transition"
                >
                  {transcribing ? "Transcribing..." : "🎤 Transcribe All (TTS Detection)"}
                </button>
                <button
                  onClick={regenerateAllNames}
                  className="px-6 py-2 bg-gray-600 hover:bg-gray-500 rounded font-medium transition"
                >
                  Regenerate Names
                </button>
              </>
            )}
          </div>
        </div>

        {/* Preview Text */}
        {folderId && (
          <div className="mb-4 text-sm text-gray-400">
            <span className="font-medium">Preview format:</span>{" "}
            <code className="bg-gray-800 px-2 py-1 rounded">
              {generateFileName(0, defaultMultiplier, true, "Description", 15)}
            </code>
          </div>
        )}

        {/* Video List */}
        {videos.length > 0 && (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">Original Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Suggested Name</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-32">Description</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-20">Dur</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-16">TTS</th>
                  <th className="px-4 py-3 text-left text-sm font-medium w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {videos.map((video, idx) => (
                  <tr key={video.id} className={`hover:bg-gray-750 ${video.processing ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3 text-sm">
                      {video.processing && <span className="animate-pulse mr-2">⏳</span>}
                      {video.name}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {video.isEditing ? (
                        <input
                          type="text"
                          value={video.suggestedName}
                          onChange={(e) => updateSuggestedName(idx, e.target.value)}
                          onBlur={() => toggleEdit(idx)}
                          onKeyDown={(e) => e.key === "Enter" && toggleEdit(idx)}
                          autoFocus
                          className="w-full px-2 py-1 bg-gray-700 rounded border border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <span className="text-green-400">{video.suggestedName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <input
                        type="text"
                        value={video.description}
                        onChange={(e) => updateVideo(idx, { description: e.target.value.replace(/[^a-zA-Z0-9]/g, "") })}
                        className="w-28 px-2 py-1 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-xs"
                        placeholder="Description"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <input
                        type="number"
                        min="0"
                        value={video.duration}
                        onChange={(e) => updateVideo(idx, { duration: parseInt(e.target.value) || 0 })}
                        className="w-14 px-2 py-1 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-center text-xs"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => updateVideo(idx, { isTTSSafe: !video.isTTSSafe })}
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          video.isTTSSafe
                            ? "bg-green-600 text-white"
                            : "bg-red-600 text-white"
                        }`}
                      >
                        {video.isTTSSafe ? "✓" : "✗"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleEdit(idx)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="p-4 bg-gray-700 flex justify-between items-center">
              <span className="text-sm text-gray-400">{videos.length} videos ready</span>
              <button
                onClick={renameAll}
                disabled={renaming}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded font-medium transition"
              >
                {renaming ? "Renaming..." : "Rename All Files"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
