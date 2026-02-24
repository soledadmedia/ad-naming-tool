import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import OpenAI from "openai";
import { Readable } from "stream";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Payment-related phrases that make content NOT TikTok safe
const PAYMENT_PHRASES = [
  "$12.95",
  "$12",
  "12.95",
  "every dollar equals entries",
  "dollar equals entries",
  "dollars equal entries",
  "entry per dollar",
  "entries per dollar",
  "cost",
  "price",
  "payment",
  "pay",
  "charge",
  "purchase",
  "buy",
  "credit card",
  "debit card",
];

// Multiplier detection patterns
const MULTIPLIER_PATTERNS = [
  { pattern: /5x\s*entr/i, multiplier: "5000" },
  { pattern: /five\s*times?\s*entr/i, multiplier: "5000" },
  { pattern: /quintuple/i, multiplier: "5000" },
  { pattern: /4x\s*entr/i, multiplier: "4000" },
  { pattern: /four\s*times?\s*entr/i, multiplier: "4000" },
  { pattern: /quadruple/i, multiplier: "4000" },
  { pattern: /3x\s*entr/i, multiplier: "3000" },
  { pattern: /three\s*times?\s*entr/i, multiplier: "3000" },
  { pattern: /triple/i, multiplier: "3000" },
  { pattern: /2x\s*entr/i, multiplier: "2000" },
  { pattern: /two\s*times?\s*entr/i, multiplier: "2000" },
  { pattern: /double/i, multiplier: "2000" },
  { pattern: /end\s*of\s*sweeps/i, multiplier: "0001" },
  { pattern: /last\s*chance/i, multiplier: "0001" },
  { pattern: /final\s*days?/i, multiplier: "0001" },
  { pattern: /ending\s*soon/i, multiplier: "0001" },
];

function detectMultiplier(transcript: string): string {
  for (const { pattern, multiplier } of MULTIPLIER_PATTERNS) {
    if (pattern.test(transcript)) {
      return multiplier;
    }
  }
  return "1000"; // Default: evergreen (1X or no mention)
}

function isTTSSafe(transcript: string): boolean {
  const lowerTranscript = transcript.toLowerCase();
  return !PAYMENT_PHRASES.some((phrase) =>
    lowerTranscript.includes(phrase.toLowerCase())
  );
}

function extractDescription(transcript: string): string {
  // Get first ~30 characters or first sentence, clean it up
  const cleaned = transcript
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Take first few words
  const words = cleaned.split(" ").slice(0, 5);
  let description = words.join("_");

  // Limit length and clean up
  description = description.slice(0, 30).replace(/_+$/, "");

  return description || "Ad";
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { fileId, creatorCode, folderId, sequenceStart } =
      await request.json();

    // Get access token
    const tokenRes = await fetch(
      `${process.env.NEXTAUTH_URL}/api/auth/session`,
      {
        headers: {
          cookie: request.headers.get("cookie") || "",
        },
      }
    );
    const sessionData = await tokenRes.json();
    const accessToken = sessionData?.accessToken;

    if (!accessToken) {
      return NextResponse.json({ error: "No access token" }, { status: 401 });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Download the video file
    const tmpPath = join(tmpdir(), `video-${fileId}-${Date.now()}.mp4`);
    const audioPath = join(tmpdir(), `audio-${fileId}-${Date.now()}.mp3`);

    try {
      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );

      // Save to temp file
      const dest = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        (response.data as Readable)
          .on("data", (chunk: Buffer) => chunks.push(chunk))
          .on("end", async () => {
            await writeFile(tmpPath, Buffer.concat(chunks));
            resolve(tmpPath);
          })
          .on("error", reject);
      });

      // Get video duration using ffprobe
      let duration = 0;
      try {
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${dest}"`
        );
        duration = Math.round(parseFloat(stdout.trim()));
      } catch (e) {
        console.error("Error getting duration:", e);
        duration = 0;
      }

      // Extract audio for transcription
      let transcript = "";
      try {
        await execAsync(
          `ffmpeg -i "${dest}" -vn -acodec mp3 -y "${audioPath}" 2>/dev/null`
        );

        // Transcribe with Whisper
        const audioFile = await readFile(audioPath);
        const transcription = await getOpenAI().audio.transcriptions.create({
          file: new File([audioFile], "audio.mp3", { type: "audio/mpeg" }),
          model: "whisper-1",
        });
        transcript = transcription.text;
      } catch (e) {
        console.error("Error transcribing:", e);
        transcript = "";
      }

      // Analyze transcript
      const multiplier = detectMultiplier(transcript);
      const ttsSafe = isTTSSafe(transcript);
      const description = extractDescription(transcript);

      // Get existing files to determine sequence number
      let sequence = sequenceStart || 1;
      try {
        const existingFiles = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "files(name)",
          pageSize: 1000,
        });

        // Find highest existing sequence for this multiplier
        const pattern = new RegExp(`^${multiplier}(\\d+)`);
        for (const file of existingFiles.data.files || []) {
          const match = file.name?.match(pattern);
          if (match) {
            const existingSeq = parseInt(match[1], 10);
            if (existingSeq >= sequence) {
              sequence = existingSeq + 1;
            }
          }
        }
      } catch (e) {
        console.error("Error checking existing files:", e);
      }

      // Format sequence as 2 digits
      const seqStr = sequence.toString().padStart(2, "0");

      // Build filename
      const ttsLabel = ttsSafe ? ".TTS" : "";
      const suggestedName = `${multiplier}${seqStr}${ttsLabel}.${creatorCode}.${description}.${duration}sec.mp4`;

      // Cleanup temp files
      try {
        await unlink(tmpPath);
        await unlink(audioPath);
      } catch {}

      return NextResponse.json({
        suggestedName,
        duration,
        transcript,
        multiplier,
        isTTSSafe: ttsSafe,
        description,
      });
    } catch (downloadError) {
      console.error("Error downloading video:", downloadError);

      // Cleanup on error
      try {
        await unlink(tmpPath);
        await unlink(audioPath);
      } catch {}

      return NextResponse.json(
        { error: "Failed to download video" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error processing video:", error);
    return NextResponse.json(
      { error: "Failed to process video" },
      { status: 500 }
    );
  }
}
