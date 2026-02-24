import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import OpenAI from "openai";
import { Readable } from "stream";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { fileId, fileName } = await request.json();

    // Get access token
    const tokenRes = await fetch(`${process.env.NEXTAUTH_URL}/api/auth/session`, {
      headers: { cookie: request.headers.get("cookie") || "" },
    });
    const sessionData = await tokenRes.json();
    const accessToken = sessionData?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "No access token" }, { status: 401 });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Download video to memory
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

    // Check file size (Whisper limit is 25MB)
    if (videoBuffer.length > 25 * 1024 * 1024) {
      return NextResponse.json({ 
        error: "Video too large for transcription (>25MB)",
        isTTSSafe: true,
        description: "Ad"
      });
    }

    // Send to Whisper (it accepts video files, extracts audio internally)
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const file = new File([videoBuffer], fileName || "video.mp4", { 
      type: "video/mp4" 
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });

    const transcript = transcription.text;
    const ttsSafe = isTTSSafe(transcript);
    const description = extractDescription(transcript);

    return NextResponse.json({
      transcript,
      isTTSSafe: ttsSafe,
      description,
    });

  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: "Transcription failed", isTTSSafe: true, description: "Ad" },
      { status: 500 }
    );
  }
}
