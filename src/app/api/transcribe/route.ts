import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { AssemblyAI } from "assemblyai";
import { Readable } from "stream";

// Increase function timeout (Pro plan: 60s, free: 10s)
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

  try {
    const { fileId, fileName } = await request.json();
    console.log(`[Transcribe] Starting for ${fileName} (${fileId})`);

    // Check for AssemblyAI key
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return NextResponse.json({ 
        error: "AssemblyAI API key not configured", 
        isTTSSafe: true, 
        description: "Ad" 
      });
    }

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

    // Download video to buffer
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
    console.log(`[Transcribe] Downloaded ${sizeMB}MB`);

    // AssemblyAI handles large files (up to 5GB)
    console.log("[Transcribe] Uploading to AssemblyAI...");
    const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
    
    // Upload the file
    const uploadUrl = await client.files.upload(videoBuffer);
    console.log("[Transcribe] File uploaded, starting transcription...");

    // Transcribe
    const transcript = await client.transcripts.transcribe({
      audio_url: uploadUrl,
    });

    if (transcript.status === "error") {
      throw new Error(transcript.error || "Transcription failed");
    }

    const text = transcript.text || "";
    console.log(`[Transcribe] Got transcript: "${text.slice(0, 100)}..."`);
    
    const ttsSafe = isTTSSafe(text);
    const description = extractDescription(text);

    console.log(`[Transcribe] Done! TTS Safe: ${ttsSafe}, Description: ${description}`);
    
    return NextResponse.json({
      transcript: text,
      isTTSSafe: ttsSafe,
      description,
    });

  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Transcription failed: ${errorMessage}`, isTTSSafe: true, description: "Ad" },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  const hasAssemblyAI = !!process.env.ASSEMBLYAI_API_KEY;
  const hasNextAuth = !!process.env.NEXTAUTH_URL;
  return NextResponse.json({ 
    status: "ok",
    assemblyaiConfigured: hasAssemblyAI,
    nextauthConfigured: hasNextAuth,
  });
}
