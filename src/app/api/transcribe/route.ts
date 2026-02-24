import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { Readable } from "stream";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

// Increase function timeout
export const maxDuration = 300; // 5 minutes for local processing

// Payment-related phrases that make content NOT TikTok safe
const PAYMENT_PHRASES = [
  "12.95",
  "$12",
  "twelve ninety-five",
  "twelve dollars",
  "every dollar equals entries",
  "dollar equals entries",
  "dollars equal entries",
  "entry per dollar",
  "entries per dollar",
  "cost",
  "price",
  "payment",
  "pay ",
  "charge",
  "purchase",
  "buy now",
  "credit card",
  "debit card",
];

function isTTSSafe(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  return !PAYMENT_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()));
}

function extractDescription(transcript: string): string {
  const cleaned = transcript
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const skipWords = new Set(["the", "a", "an", "is", "are", "this", "that", "and", "or", "but", "hey", "hi", "hello", "so", "um", "uh", "you", "your", "we", "our", "can", "will", "just", "like", "get", "got"]);
  const words = cleaned.split(" ").filter(w => w.length > 2 && !skipWords.has(w.toLowerCase()));
  
  let description = words.slice(0, 4).map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join("");

  description = description.slice(0, 25);
  return description || "Ad";
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized - no session" }, { status: 401 });
  }

  const uuid = randomUUID();
  const videoPath = join(tmpdir(), `video-${uuid}.mp4`);
  const audioPath = join(tmpdir(), `audio-${uuid}.mp3`);
  const transcriptPath = join(tmpdir(), `transcript-${uuid}.txt`);

  try {
    const { fileId, fileName } = await request.json();
    console.log(`[Transcribe] Starting for ${fileName} (${fileId})`);

    // Get access token
    const tokenRes = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/session`, {
      headers: { cookie: request.headers.get("cookie") || "" },
    });
    const sessionData = await tokenRes.json();
    const accessToken = sessionData?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "No access token - please sign out and sign in again" }, { status: 401 });
    }

    console.log("[Transcribe] Downloading video from Drive...");
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Download video to temp file
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (response.data as Readable)
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .on("end", () => resolve())
        .on("error", reject);
    });

    const videoBuffer = Buffer.concat(chunks);
    const sizeMB = (videoBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`[Transcribe] Downloaded ${sizeMB}MB, saving to ${videoPath}`);

    // Save video to temp file
    await writeFile(videoPath, videoBuffer);

    // Extract audio with FFmpeg
    console.log("[Transcribe] Extracting audio with FFmpeg...");
    try {
      await execAsync(`ffmpeg -i "${videoPath}" -vn -acodec mp3 -ar 16000 -ac 1 -y "${audioPath}" 2>/dev/null`);
    } catch (e) {
      console.error("FFmpeg error:", e);
      throw new Error("Failed to extract audio from video");
    }

    // Transcribe with Whisper
    console.log("[Transcribe] Running Whisper transcription...");
    try {
      // Use whisper CLI with base model (faster, good enough for short clips)
      await execAsync(`whisper "${audioPath}" --model base --output_format txt --output_dir "${tmpdir()}" --fp16 False 2>/dev/null`);
      
      // Read the transcript - whisper outputs to audio-{uuid}.txt
      const whisperOutput = join(tmpdir(), `audio-${uuid}.txt`);
      const text = await readFile(whisperOutput, "utf-8");
      
      console.log(`[Transcribe] Got transcript: "${text.slice(0, 100)}..."`);
      
      const ttsSafe = isTTSSafe(text);
      const description = extractDescription(text);

      console.log(`[Transcribe] Done! TTS Safe: ${ttsSafe}, Description: ${description}`);

      // Cleanup
      await cleanup(videoPath, audioPath, whisperOutput);
      
      return NextResponse.json({
        transcript: text.trim(),
        isTTSSafe: ttsSafe,
        description,
      });
    } catch (e) {
      console.error("Whisper error:", e);
      throw new Error("Whisper transcription failed");
    }

  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Cleanup on error
    await cleanup(videoPath, audioPath, transcriptPath);
    
    return NextResponse.json(
      { error: `Transcription failed: ${errorMessage}`, isTTSSafe: true, description: "Ad" },
      { status: 500 }
    );
  }
}

async function cleanup(...paths: string[]) {
  for (const p of paths) {
    try {
      await unlink(p);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Health check endpoint
export async function GET() {
  let whisperAvailable = false;
  let ffmpegAvailable = false;
  
  try {
    await execAsync("which whisper");
    whisperAvailable = true;
  } catch {}
  
  try {
    await execAsync("which ffmpeg");
    ffmpegAvailable = true;
  } catch {}
  
  return NextResponse.json({ 
    status: "ok",
    whisperAvailable,
    ffmpegAvailable,
    nextauthConfigured: !!process.env.NEXTAUTH_URL,
  });
}
