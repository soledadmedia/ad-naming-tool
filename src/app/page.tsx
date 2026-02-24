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

const CREATOR_CODES = [
  { code: "0", label: "0 - Chris Carter [FORGED] or Chris Hedgecock [RM]" },
  { code: "6", label: "6 - LAZ" },
  { code: "9", label: "9 - Lindsay or Alex" },
  { code: "5", label: "5 - Outside social media creator" },
];

// Extract folder ID from various Google Drive URL formats
function extractFolderId(url: string): string | null {
  // Format: https://drive.google.com/drive/folders/FOLDER_ID
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  
  // Format: https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const folderMatch2 = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch2) return folderMatch2[1];
  
  // If it's just the ID itself (no URL)
  if (/^[a-zA-Z0-9_-]+$/.test(url.trim())) {
    return url.trim();
  }
  
  return null;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [folderUrl, setFolderUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [creatorCode, setCreatorCode] = useState("0");
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [urlError, setUrlError] = useState("");

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

  const processVideos = async () => {
    if (!folderId) return;
    setProcessing(true);

    try {
      // First, fetch video files from the folder
      const res = await fetch(`/api/drive/videos?folderId=${folderId}`);
      const data = await res.json();

      if (data.videos) {
        // Initialize videos with processing state
        const initialVideos: VideoFile[] = data.videos.map((v: { id: string; name: string; mimeType: string }) => ({
          id: v.id,
          name: v.name,
          mimeType: v.mimeType,
          suggestedName: "",
          duration: 0,
          transcript: "",
          multiplier: "1000",
          isTTSSafe: true,
          description: "",
          isEditing: false,
          processing: true,
        }));
        setVideos(initialVideos);

        // Process each video
        for (let i = 0; i < initialVideos.length; i++) {
          try {
            const processRes = await fetch("/api/process-video", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileId: initialVideos[i].id,
                fileName: initialVideos[i].name,
                creatorCode,
                folderId: folderId,
                sequenceStart: i + 1,
              }),
            });
            const processData = await processRes.json();

            setVideos((prev) =>
              prev.map((v, idx) =>
                idx === i
                  ? {
                      ...v,
                      ...processData,
                      processing: false,
                    }
                  : v
              )
            );
          } catch {
            setVideos((prev) =>
              prev.map((v, idx) =>
                idx === i
                  ? {
                      ...v,
                      processing: false,
                      error: "Failed to process",
                    }
                  : v
              )
            );
          }
        }
      }
    } catch (error) {
      console.error("Error processing videos:", error);
    }
    setProcessing(false);
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
        // Update the original names
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

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <h1 className="text-4xl font-bold">Ad Naming Tool</h1>
        <p className="text-gray-400">RestoMods Video Renaming System</p>
        <button
          onClick={() => signIn("google")}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg flex items-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Ad Naming Tool</h1>
            <p className="text-gray-400">RestoMods Video Renaming System</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{session.user?.email}</span>
            <button
              onClick={() => signOut()}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Folder URL Input */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Google Drive Folder URL
              </label>
              <input
                type="text"
                value={folderUrl}
                onChange={(e) => handleFolderUrlChange(e.target.value)}
                placeholder="Paste Google Drive folder link..."
                className="w-full bg-gray-700 px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {urlError && (
                <p className="text-red-400 text-sm mt-1">{urlError}</p>
              )}
              {folderId && !urlError && (
                <p className="text-green-400 text-sm mt-1">✓ Folder ID: {folderId.slice(0, 20)}...</p>
              )}
            </div>

            {/* Creator Code */}
            <div>
              <label className="block text-sm font-medium mb-2">Creator</label>
              <select
                value={creatorCode}
                onChange={(e) => setCreatorCode(e.target.value)}
                className="w-full bg-gray-700 px-4 py-2 rounded-lg"
              >
                {CREATOR_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Process Button */}
            <div className="flex items-end">
              <button
                onClick={processVideos}
                disabled={!folderId || processing || !!urlError}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-2 px-4 rounded-lg font-semibold"
              >
                {processing ? "Processing..." : "Process Videos"}
              </button>
            </div>
          </div>
        </div>

        {/* Results Table */}
        {videos.length > 0 && (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left">Original Name</th>
                    <th className="px-4 py-3 text-left">Suggested Name</th>
                    <th className="px-4 py-3 text-left w-24">Duration</th>
                    <th className="px-4 py-3 text-left w-20">TTS</th>
                    <th className="px-4 py-3 text-center w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {videos.map((video, index) => (
                    <tr key={video.id} className="hover:bg-gray-750">
                      <td className="px-4 py-3 text-sm">{video.name}</td>
                      <td className="px-4 py-3">
                        {video.processing ? (
                          <div className="flex items-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-blue-500"></div>
                            <span className="text-gray-400">Processing...</span>
                          </div>
                        ) : video.error ? (
                          <span className="text-red-400">{video.error}</span>
                        ) : video.isEditing ? (
                          <input
                            type="text"
                            value={video.suggestedName}
                            onChange={(e) =>
                              updateSuggestedName(index, e.target.value)
                            }
                            className="w-full bg-gray-700 px-2 py-1 rounded text-sm"
                          />
                        ) : (
                          <span className="text-sm font-mono">
                            {video.suggestedName}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {video.duration ? `${video.duration}s` : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {video.isTTSSafe ? (
                          <span className="text-green-400">✓</span>
                        ) : (
                          <span className="text-red-400">✕</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!video.processing && !video.error && (
                          <button
                            onClick={() => toggleEdit(index)}
                            className="text-blue-400 hover:text-blue-300 text-sm"
                          >
                            {video.isEditing ? "Done" : "Edit"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Rename All Button */}
            <div className="p-4 bg-gray-750 border-t border-gray-700">
              <button
                onClick={renameAll}
                disabled={renaming || videos.every((v) => v.processing || v.error)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed py-3 rounded-lg font-semibold"
              >
                {renaming ? "Renaming..." : "Rename All Files"}
              </button>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4">Naming Convention</h2>
          <p className="text-gray-300 mb-4 font-mono text-sm">
            [MULTIPLIER][SEQUENCE].[TTS].[CREATOR].[DESCRIPTION].[LENGTH]sec.mp4
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">Multiplier Codes:</h3>
              <ul className="text-gray-400 space-y-1">
                <li>5000 = 5X Entries</li>
                <li>4000 = 4X Entries</li>
                <li>3000 = 3X Entries</li>
                <li>2000 = 2X Entries</li>
                <li>1000 = 1X or No Mention (evergreen)</li>
                <li>0001 = END OF SWEEPS/LASTCHANCE</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">TTS Safe:</h3>
              <p className="text-gray-400">
                &quot;TTS&quot; is added if the ad is TikTok safe (no payment mentions
                like &quot;$12.95&quot;, &quot;every dollar equals entries&quot;)
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
