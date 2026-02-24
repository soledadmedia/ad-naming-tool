import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import OpenAI from "openai";
import { Readable } from "stream";

// Increase function timeout to 60 seconds (requires Pro plan, otherwise 10s)
export const maxDuration = 60;

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
  // Clean up and get meaningful words
  const cleaned = transcript
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Take first few meaningful words, skip common filler
  const skipWords = new Set(["the", "a", "an", "is", "are", "this", "that", "and", "or", "but", "hey", "hi", "hello", "so", "um", "uh"]);
  const words = cleaned.split(" ").filter(w => w.length > 2 && !skipWords.has(w.toLowerCase()));
  
  // Take first 3-4 words and create description
  let description = words.slice(0, 4).map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join("");

  // Limit length
  description = description.slice(0, 25);

  return description || "Ad";
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized - no session" }, { status: 401 });
  }

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
      console.log("[Transcribe] No access token in session");
      return NextResponse.json({ error: "No access token - please sign out and sign in again" }, { status: 401 });
    }

    console.log("[Transcribe] Got access token, connecting to Drive...");
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Download video to memory
    console.log("[Transcribe] Downloading video...");
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
    console.log(`[Transcribe] Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Check file size (Whisper limit is 25MB)
    if (videoBuffer.length > 25 * 1024 * 1024) {
      return NextResponse.json({ 
        error: "Video too large for transcription (>25MB)",
        isTTSSafe: true,
        description: "Ad"
      });
    }

    // Send to Whisper (it accepts video files, extracts audio internally)
    console.log("[Transcribe] Sending to Whisper...");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const file = new File([videoBuffer], fileName || "video.mp4", { 
      type: "video/mp4" 
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });

    const transcript = transcription.text;
    console.log(`[Transcribe] Got transcript: "${transcript.slice(0, 100)}..."`);
    
    const ttsSafe = isTTSSafe(transcript);
    const description = extractDescription(transcript);

    console.log(`[Transcribe] Done! TTS Safe: ${ttsSafe}, Description: ${description}`);
    
    return NextResponse.json({
      transcript,
      isTTSSafe: ttsSafe,
      description,
    });

  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Transcription failed: ${errorMessage}`, isTTSSafe: true, description: "Ad", debug: errorMessage },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasNextAuth = !!process.env.NEXTAUTH_URL;
  return NextResponse.json({ 
    status: "ok",
    openaiConfigured: hasOpenAI,
    nextauthConfigured: hasNextAuth,
  });
}
